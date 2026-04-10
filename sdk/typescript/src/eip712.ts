import type { ApiConfig } from "./types.js";

export const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "market", type: "address" },
    { name: "option", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "type", type: "uint8" },
    { name: "price", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export type OrderSignMessage = {
  maker: `0x${string}`;
  market: `0x${string}`;
  option: bigint;
  side: number;
  type: number;
  price: bigint;
  amount: bigint;
  nonce: bigint;
  expiry: bigint;
};

export function buildOrderTypedData(
  cfg: ApiConfig,
  msg: OrderSignMessage
): {
  domain: ApiConfig["eip712"]["domain"];
  types: typeof ORDER_TYPES;
  primaryType: "Order";
  message: OrderSignMessage;
} {
  return {
    domain: cfg.eip712.domain,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: msg,
  };
}
