# UpDown HTTP API (summary)

Base URL: `http://localhost:3001` in development (override with your deployment).

## Rate limiting

- **Global REST** (excluding `GET /health`): ~400 requests / minute / IP (see `backend/src/middleware/rateLimit.ts`).
- **Order writes** (`POST /orders`, `DELETE /orders/:id`): ~90 / minute / IP.

Responses use **429 Too Many Requests** with JSON `{ "error": "…" }` when limited.

## Markets

- `GET /markets` — optional `timeframe` (`300` | `900` | `3600`), optional `pair` (`BTC-USD` | `ETH-USD`).
- `GET /markets/:address` — detail + `orderBook`, `timeRemainingSeconds`, `pairSymbol`, `chartSymbol`.
- `POST /markets/:address/claim` — relayer-only: header `x-updown-admin-key` must match `CLAIM_ADMIN_API_KEY` if set, otherwise JSON body `{ "signature": "0x..." }` must be an EIP-191 signature from the relayer over `updown:claim:<address>:<chainId>`.

## Orders

- `POST /orders` — EIP-712 signed order body (see frontend `postOrder` types).
- `DELETE /orders/:id` — signed cancel.

## Other

- `GET /config` — chain, USDT, relayer, EIP-712 domain, fee bps.
- `GET /orderbook/:marketId`
- `GET /balance/:wallet`
- `GET /positions/:wallet`
- `GET /trades/:wallet`
- `GET /prices/history/:symbol` — proxied chart data (`BTC`, `ETH`, …)
- `GET /health` — not rate limited

## WebSocket

`GET` upgrade to `/stream` — see [bots README](./bots/README.md).
