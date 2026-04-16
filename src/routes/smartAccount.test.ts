jest.mock('../config', () => ({
  config: {
    alchemyApiKey: 'test-key',
    usdtAddress: '0xCa4f77A38d8552Dd1D5E44e890173921B67725F4',
    settlementAddress: '0x2222222222222222222222222222222222222222',
    chainId: 42161,
  },
}));

jest.mock('../models/SmartAccount', () => ({
  SmartAccountModel: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
  },
}));

import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createSmartAccountRouter } from './smartAccount';
import { SmartAccountModel } from '../models/SmartAccount';

const ENTER_POSITION_SELECTOR = ethers.id('enterPosition(uint256,uint8,uint256)').slice(0, 10).toLowerCase();

const OWNER = '0xd6d85829708a17d360a12c921b19f4c4d5f6da88';
const SMART_ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678';
const SESSION_KEY = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const SETTLEMENT = '0x2222222222222222222222222222222222222222';
/** Even-length hex, long enough for MA v2 deferred-action layout. */
const PERMISSIONS_CONTEXT = `0x00${'12'.repeat(33)}`;

function futureExpiry(): number {
  return Math.floor(Date.now() / 1000) + 86_400;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    ownerAddress: OWNER,
    smartAccountAddress: SMART_ACCOUNT,
    sessionKey: SESSION_KEY,
    sessionExpiry: futureExpiry(),
    permissionsContext: PERMISSIONS_CONTEXT,
    sessionScope: {
      settlementAddress: SETTLEMENT,
      functionSelector: ENTER_POSITION_SELECTOR,
      usdtAllowance: '1000000',
    },
    ...overrides,
  };
}

describe('POST /register', () => {
  const executor = {
    getSmartAccountBalance: jest.fn().mockResolvedValue(5_000_000n),
  };

  function buildApp(exec: typeof executor | null = executor) {
    const app = express();
    app.use(express.json());
    app.use(createSmartAccountRouter({ executor: exec as never }));
    return app;
  }

  function mockFindOneLean(doc: unknown) {
    (SmartAccountModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue(doc),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOneLean(null);
    (SmartAccountModel.findOneAndUpdate as jest.Mock).mockResolvedValue({});
    executor.getSmartAccountBalance.mockResolvedValue(5_000_000n);
  });

  it('returns 400 when sessionScope.settlementAddress does not match configured settlement contract', async () => {
    const res = await request(buildApp())
      .post('/register')
      .send(
        validBody({
          sessionScope: {
            settlementAddress: '0x3333333333333333333333333333333333333333',
            functionSelector: ENTER_POSITION_SELECTOR,
            usdtAllowance: '1000000',
          },
        })
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sessionScope.settlementAddress does not match configured settlement contract');
  });

  it('returns 400 when sessionScope.functionSelector does not match enterPosition', async () => {
    const res = await request(buildApp())
      .post('/register')
      .send(
        validBody({
          sessionScope: {
            settlementAddress: SETTLEMENT,
            functionSelector: '0xdeadbeef',
            usdtAllowance: '1000000',
          },
        })
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sessionScope.functionSelector does not match enterPosition');
  });

  it('returns 400 when sessionExpiry is in the past', async () => {
    const res = await request(buildApp())
      .post('/register')
      .send(validBody({ sessionExpiry: Math.floor(Date.now() / 1000) - 60 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sessionExpiry must be a future unix timestamp');
  });

  it('returns 503 when executor is null', async () => {
    const res = await request(buildApp(null)).post('/register').send(validBody());
    expect(res.status).toBe(503);
    expect(res.body.error).toBe(
      'Smart accounts are not configured on this server. ALCHEMY_API_KEY is missing.'
    );
  });

  it('upsert-update preserves cachedBalance, inOrders, withdrawNonce (not in $set)', async () => {
    mockFindOneLean({
      ownerAddress: OWNER.toLowerCase(),
      smartAccountAddress: SMART_ACCOUNT.toLowerCase(),
      cachedBalance: '999999',
      inOrders: '111',
      withdrawNonce: 7,
    });

    const exp = futureExpiry();
    const res = await request(buildApp()).post('/register').send(validBody({ sessionExpiry: exp }));

    expect(res.status).toBe(200);
    expect(executor.getSmartAccountBalance).not.toHaveBeenCalled();

    expect(SmartAccountModel.findOneAndUpdate).toHaveBeenCalled();
    const [, update] = (SmartAccountModel.findOneAndUpdate as jest.Mock).mock.calls[0];
    expect(update.$set).toBeDefined();
    expect(update.$set).not.toHaveProperty('cachedBalance');
    expect(update.$set).not.toHaveProperty('inOrders');
    expect(update.$set).not.toHaveProperty('withdrawNonce');
    expect(update.$set).not.toHaveProperty('walletProvider');
    expect(update.$setOnInsert).toMatchObject({
      inOrders: '0',
      withdrawNonce: 0,
      walletProvider: 'alchemy-modular-account-v2',
    });
    expect(res.body).toEqual({
      ownerAddress: OWNER.toLowerCase(),
      smartAccountAddress: SMART_ACCOUNT.toLowerCase(),
      isNew: false,
      sessionExpiry: exp,
    });
    expect(res.body).not.toHaveProperty('sessionKey');
    expect(res.body).not.toHaveProperty('permissionsContext');
  });

  it('upsert-create populates cachedBalance from executor.getSmartAccountBalance', async () => {
    mockFindOneLean(null);
    executor.getSmartAccountBalance.mockResolvedValue(12_345n);

    const exp = futureExpiry();
    const res = await request(buildApp()).post('/register').send(validBody({ sessionExpiry: exp }));

    expect(res.status).toBe(200);
    expect(executor.getSmartAccountBalance).toHaveBeenCalledWith(
      SMART_ACCOUNT.toLowerCase(),
      '0xCa4f77A38d8552Dd1D5E44e890173921B67725F4'
    );

    const [, update] = (SmartAccountModel.findOneAndUpdate as jest.Mock).mock.calls[0];
    expect(update.$setOnInsert.cachedBalance).toBe('12345');
    expect(res.body.isNew).toBe(true);
    expect(res.body).not.toHaveProperty('sessionKey');
    expect(res.body).not.toHaveProperty('permissionsContext');
  });

  it('returns 502 and does not write Mongo when balance read throws on create', async () => {
    mockFindOneLean(null);
    executor.getSmartAccountBalance.mockRejectedValue(new Error('rpc down'));

    const res = await request(buildApp()).post('/register').send(validBody());

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Failed to read initial balance from chain; try again');
    expect(SmartAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
