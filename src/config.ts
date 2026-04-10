import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3001'), 10),
  mongoUri: optional('MONGODB_URI', 'mongodb://localhost:27017/updown'),

  arbitrumRpcUrl: required('ARBITRUM_RPC_URL'),
  relayerPrivateKey: required('RELAYER_PRIVATE_KEY'),
  chainId: parseInt(optional('CHAIN_ID', '42161'), 10),

  autocyclerAddress: optional('AUTOCYCLER_ADDRESS', ''),
  factoryAddress: optional('FACTORY_ADDRESS', '0x05b1fd504583B81bd14c368d59E8c3e354b6C1dc'),
  usdtAddress: optional('USDT_ADDRESS', '0xCa4f77A38d8552Dd1D5E44e890173921B67725F4'),

  /** Off-chain balance row that receives `platformFeeBps` from each fill (defaults to relayer in index.ts). */
  feeTreasuryAddress: optional('FEE_TREASURY_ADDRESS', '').toLowerCase(),

  /** If set, must be sent as `x-updown-admin-key` to POST /markets/:address/claim (or sign as relayer). */
  claimAdminApiKey: optional('CLAIM_ADMIN_API_KEY', ''),

  platformFeeBps: parseInt(optional('PLATFORM_FEE_BPS', '70'), 10),
  makerFeeBps: parseInt(optional('MAKER_FEE_BPS', '80'), 10),

  matchingIntervalMs: parseInt(optional('MATCHING_INTERVAL_MS', '100'), 10),
  settlementBatchIntervalMs: parseInt(optional('SETTLEMENT_BATCH_INTERVAL_MS', '30000'), 10),
  marketSyncIntervalMs: parseInt(optional('MARKET_SYNC_INTERVAL_MS', '15000'), 10),
  depositConfirmations: parseInt(optional('DEPOSIT_CONFIRMATIONS', '3'), 10),

  /** Base URL for rain-speed-markets price history API (proxied at GET /prices/history/:symbol). */
  speedMarketApiBaseUrl: optional(
    'SPEED_MARKET_API_BASE_URL',
    'https://rain-speed-markets-dev-api.quecko.org'
  ),
} as const;

export const USDT_DECIMALS = 6;
export const PRICE_DECIMALS = 18;
export const OPTION_UP = 1;
export const OPTION_DOWN = 2;
export const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

export const EIP712_DOMAIN = {
  name: 'UpDown Exchange',
  version: '1',
  chainId: config.chainId,
  verifyingContract: '0x0000000000000000000000000000000000000000' as `0x${string}`,
};

export const EIP712_ORDER_TYPES = {
  Order: [
    { name: 'maker', type: 'address' },
    { name: 'market', type: 'address' },
    { name: 'option', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'type', type: 'uint8' },
    { name: 'price', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
};

export const EIP712_CANCEL_TYPES = {
  Cancel: [
    { name: 'maker', type: 'address' },
    { name: 'orderId', type: 'string' },
  ],
};

export const EIP712_WITHDRAW_TYPES = {
  Withdraw: [
    { name: 'wallet', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};
