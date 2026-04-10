/**
 * Reference maker flow (not a running bot — wire your own signer).
 *
 * 1. Fund the relayer with USDT on Arbitrum; poll GET /balance/:wallet.
 * 2. Fetch GET /config for EIP-712 domain + fee bps.
 * 3. Sign typed data (viem `signTypedData` or wallet) using buildOrderTypedData().
 * 4. POST /orders with the signature.
 * 5. Subscribe to orderbook:{market} over WebSocket to cancel/replace quotes.
 *
 * Run: UPND_API=http://localhost:3001 npx ts-node examples/maker_stub.ts
 */
import { UpDownHttpClient, wsUrlFromHttpBase, UpDownWsClient } from "../src/index.js";

const base = process.env.UPND_API ?? "http://localhost:3001";

async function main() {
  const http = new UpDownHttpClient(base);
  const cfg = await http.getConfig();
  console.log("Relayer (deposit USDT here):", cfg.relayerAddress);
  console.log("Maker fee bps:", cfg.makerFeeBps, "Platform fee bps:", cfg.platformFeeBps);

  const markets = await http.getMarkets({ timeframe: 300, pair: "BTC-USD" });
  console.log("Sample 5 min BTC markets:", markets.length);

  const wss = wsUrlFromHttpBase(base);
  const ws = new UpDownWsClient(wss, (msg) => {
    if (msg.type === "orderbook_update") console.log("book", msg.channel);
  });
  ws.connect({ type: "subscribe", channels: ["markets"] });
  setTimeout(() => ws.disconnect(), 5000);
}

main().catch(console.error);
