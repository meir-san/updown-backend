export type PairSymbol = "BTC-USD" | "ETH-USD";

export type MarketListItem = {
  address: string;
  pairId: string;
  pairSymbol?: string;
  chartSymbol?: "BTC" | "ETH";
  startTime: number;
  endTime: number;
  duration: number;
  status: string;
  winner: number | null;
  upPrice: string;
  downPrice: string;
  strikePrice?: string;
  volume: string;
};

export type ApiConfig = {
  chainId: number;
  usdtAddress: string;
  relayerAddress: string;
  platformFeeBps: number;
  makerFeeBps: number;
  usdtDecimals: number;
  eip712: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
  };
};

export type PostOrderBody = {
  maker: string;
  market: string;
  option: number;
  side: number | "BUY" | "SELL";
  type: number | "LIMIT" | "MARKET";
  price?: number;
  amount: string;
  nonce: number;
  expiry: number;
  signature: string;
};
