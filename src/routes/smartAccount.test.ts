jest.mock('../config', () => ({
  config: {
    alchemyApiKey: 'test-key',
    usdtAddress: '0xCa4f77A38d8552Dd1D5E44e890173921B67725F4',
    chainId: 42161,
  },
}));

jest.mock('../models/SmartAccount', () => ({
  SmartAccountModel: {
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  },
}));

import express from 'express';
import request from 'supertest';
import { createSmartAccountRouter } from './smartAccount';
import { SmartAccountModel } from '../models/SmartAccount';

describe('POST /get-or-create', () => {
  const executor = {
    getSmartAccountAddress: jest.fn().mockResolvedValue('0x' + 'aa'.repeat(20)),
    getSmartAccountBalance: jest.fn().mockResolvedValue(0n),
  };

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(createSmartAccountRouter({ executor: executor as never }));
    return app;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for invalid ownerAddress', async () => {
    const res = await request(buildApp()).post('/get-or-create').send({ ownerAddress: 'bad' });
    expect(res.status).toBe(400);
  });

  it('returns existing account and never exposes sessionKey', async () => {
    (SmartAccountModel.findOne as jest.Mock).mockResolvedValue({
      smartAccountAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    const res = await request(buildApp())
      .post('/get-or-create')
      .send({ ownerAddress: '0x1234567890123456789012345678901234567890' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ownerAddress: '0x1234567890123456789012345678901234567890',
      smartAccountAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      isNew: false,
    });
  });

  it('creates a new smart account', async () => {
    (SmartAccountModel.findOne as jest.Mock).mockResolvedValue(null);
    (SmartAccountModel.create as jest.Mock).mockResolvedValue({});
    const res = await request(buildApp())
      .post('/get-or-create')
      .send({ ownerAddress: '0x1234567890123456789012345678901234567890' });
    expect(res.status).toBe(200);
    expect(res.body.isNew).toBe(true);
    expect(res.body.sessionKey).toBeUndefined();
    expect(executor.getSmartAccountAddress).toHaveBeenCalled();
    expect(SmartAccountModel.create).toHaveBeenCalled();
  });
});
