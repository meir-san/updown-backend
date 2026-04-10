# Bots and market makers on UpDown

UpDown is a **pure central limit order book** (CLOB). There is no passive AMM pool—liquidity comes from resting limit orders, similar in spirit to Polymarket-style books.

## Funding (official)

Collateral is **USDT on Arbitrum**. Send USDT to the **relayer address** returned by `GET /config` (`relayerAddress`). The indexer credits your internal balance after confirmations. There is **no Aqua or cross-chain deposit** in this product.

Bots use the same path: deposit on-chain, then poll `GET /balance/:wallet`.

## Fees

Configured per deployment. Defaults in the backend:

- **Platform fee** (`platformFeeBps`, e.g. 70 = 0.7%)
- **Maker fee** (`makerFeeBps`, e.g. 80 = 0.8% on the maker side of a fill)

Read live values from `GET /config`.

## REST and WebSocket

- **REST base**: same host as the web app’s `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:3001`).
- **WebSocket**: `/stream` on the same host (use `wss:` when the API is HTTPS).

Subscribe with:

```json
{ "type": "subscribe", "channels": ["markets", "orderbook:0x…", "orders:0xYourWallet"], "wallet": "0x…" }
```

Channels:

| Channel | Purpose |
|--------|---------|
| `orderbook:0xMarket` | Full book snapshot for one side after each relevant change |
| `trades:0xMarket` | Trade prints |
| `markets` | New / resolved market signals |
| `orders:0xWallet` | Your order status updates |

## Rate limits

The API applies **per-IP** limits (see [API reference](../api.md)). Expect **429** when exceeded; back off exponentially.

## Cancel / replace

Use `DELETE /orders/:id` with a signed cancel payload. The matching engine applies maker rules in receive order; for quote refresh, **cancel then repost** is the supported pattern.

## SDKs

- **TypeScript**: [`sdk/typescript`](../sdk/typescript/) (`UpDownHttpClient`, `UpDownWsClient`, EIP-712 helpers).
- **Python**: [`sdk/python`](../sdk/python/) (`UpDownHttpClient`, async `subscribe_loop`).

Examples are **stubs**—plug in your own wallet / signing (viem, ethers, hardware wallet, etc.).

## External price feeds

For maker/taker examples that compare to Binance/Coinbase, pull spot from your feed of choice **outside** the core SDK to keep dependencies small and latency predictable.
