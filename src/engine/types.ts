export enum OrderSide {
  BUY = 0,
  SELL = 1,
}

export enum OrderType {
  LIMIT = 0,
  MARKET = 1,
}

export enum OrderStatus {
  OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
}

export enum MarketStatus {
  ACTIVE = 'ACTIVE',
  TRADING_ENDED = 'TRADING_ENDED',
  RESOLVED = 'RESOLVED',
  CLAIMED = 'CLAIMED',
}

export interface OrderParams {
  maker: string;
  market: string;
  option: number;
  side: OrderSide;
  type: OrderType;
  price: number;
  amount: string;
  nonce: number;
  expiry: number;
  signature: string;
}

export interface InternalOrder {
  id: string;
  maker: string;
  market: string;
  option: number;
  side: OrderSide;
  type: OrderType;
  /** Price as basis points 1-9999 (maps to 0.0001 – 0.9999 probability) */
  price: number;
  /** USDT amount in wei (6 decimals) */
  amount: bigint;
  filledAmount: bigint;
  nonce: number;
  expiry: number;
  signature: string;
  status: OrderStatus;
  createdAt: number;
}

export interface TradeResult {
  id: string;
  market: string;
  option: number;
  buyOrderId: string;
  sellOrderId: string;
  buyer: string;
  seller: string;
  price: number;
  amount: bigint;
  platformFee: bigint;
  makerFee: bigint;
  timestamp: number;
}

export interface PriceLevel {
  price: number;
  depth: string;
  count: number;
}

export interface OrderBookSnapshot {
  bids: PriceLevel[];
  asks: PriceLevel[];
}

export type WsEventType =
  | 'orderbook_update'
  | 'trade'
  | 'market_created'
  | 'market_resolved'
  | 'order_update'
  | 'balance_update';

export interface WsMessage {
  type: WsEventType;
  channel: string;
  data: unknown;
}
