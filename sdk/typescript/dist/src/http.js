"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpDownHttpClient = void 0;
exports.wsUrlFromHttpBase = wsUrlFromHttpBase;
function buildUrl(base, path, query) {
    const b = base.replace(/\/$/, "");
    const p = path.startsWith("/") ? path : `/${path}`;
    const u = new URL(`${b}${p}`);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== "")
                u.searchParams.set(k, String(v));
        }
    }
    return u.toString();
}
async function parseJson(res) {
    const text = await res.text();
    if (!res.ok) {
        let msg = text;
        try {
            const j = JSON.parse(text);
            if (j.error)
                msg = j.error;
        }
        catch {
            /* ignore */
        }
        throw new Error(msg || res.statusText);
    }
    if (!text)
        return undefined;
    return JSON.parse(text);
}
class UpDownHttpClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    async getConfig() {
        const res = await fetch(buildUrl(this.baseUrl, "/config"));
        return parseJson(res);
    }
    async getMarkets(opts) {
        const res = await fetch(buildUrl(this.baseUrl, "/markets", {
            timeframe: opts?.timeframe,
            pair: opts?.pair,
        }));
        return parseJson(res);
    }
    async getMarket(address) {
        const res = await fetch(buildUrl(this.baseUrl, `/markets/${address}`));
        return parseJson(res);
    }
    async getOrderbook(marketId) {
        const res = await fetch(buildUrl(this.baseUrl, `/orderbook/${marketId}`));
        return parseJson(res);
    }
    async getBalance(wallet) {
        const res = await fetch(buildUrl(this.baseUrl, `/balance/${wallet}`));
        return parseJson(res);
    }
    async getPositions(wallet) {
        const res = await fetch(buildUrl(this.baseUrl, `/positions/${wallet}`));
        return parseJson(res);
    }
    async postOrder(body) {
        const res = await fetch(buildUrl(this.baseUrl, "/orders"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return parseJson(res);
    }
}
exports.UpDownHttpClient = UpDownHttpClient;
function wsUrlFromHttpBase(httpBase) {
    const u = new URL(httpBase);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/stream";
    u.search = "";
    u.hash = "";
    return u.toString();
}
