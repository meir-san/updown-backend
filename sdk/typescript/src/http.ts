import type { ApiConfig, MarketListItem, PostOrderBody, PairSymbol } from "./types.js";

function buildUrl(base: string, path: string, query?: Record<string, string | number | undefined>): string {
  const b = base.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const u = new URL(`${b}${p}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg || res.statusText);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export class UpDownHttpClient {
  constructor(private readonly baseUrl: string) {}

  async getConfig(): Promise<ApiConfig> {
    const res = await fetch(buildUrl(this.baseUrl, "/config"));
    return parseJson<ApiConfig>(res);
  }

  async getMarkets(opts?: { timeframe?: 300 | 900 | 3600; pair?: PairSymbol }): Promise<MarketListItem[]> {
    const res = await fetch(
      buildUrl(this.baseUrl, "/markets", {
        timeframe: opts?.timeframe,
        pair: opts?.pair,
      })
    );
    return parseJson<MarketListItem[]>(res);
  }

  async getMarket(address: string): Promise<MarketListItem & Record<string, unknown>> {
    const res = await fetch(buildUrl(this.baseUrl, `/markets/${address}`));
    return parseJson(res);
  }

  async getOrderbook(marketId: string): Promise<unknown> {
    const res = await fetch(buildUrl(this.baseUrl, `/orderbook/${marketId}`));
    return parseJson(res);
  }

  async getBalance(wallet: string): Promise<unknown> {
    const res = await fetch(buildUrl(this.baseUrl, `/balance/${wallet}`));
    return parseJson(res);
  }

  async getPositions(wallet: string): Promise<unknown> {
    const res = await fetch(buildUrl(this.baseUrl, `/positions/${wallet}`));
    return parseJson(res);
  }

  async postOrder(body: PostOrderBody): Promise<unknown> {
    const res = await fetch(buildUrl(this.baseUrl, "/orders"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseJson(res);
  }
}

export function wsUrlFromHttpBase(httpBase: string): string {
  const u = new URL(httpBase);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/stream";
  u.search = "";
  u.hash = "";
  return u.toString();
}
