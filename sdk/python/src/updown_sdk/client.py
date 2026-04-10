from __future__ import annotations

import json
from typing import Any, Optional
from urllib.parse import urlencode, urlparse, urlunparse

import httpx


def ws_url_from_http_base(http_base: str) -> str:
    p = urlparse(http_base)
    scheme = "wss" if p.scheme == "https" else "ws"
    return urlunparse((scheme, p.netloc, "/stream", "", "", ""))


class UpDownHttpClient:
    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")
        self._client = httpx.Client(base_url=self._base, timeout=30.0)

    def close(self) -> None:
        self._client.close()

    def _url(self, path: str, query: Optional[dict[str, Any]] = None) -> str:
        path = path if path.startswith("/") else f"/{path}"
        if not query:
            return path
        q = {k: v for k, v in query.items() if v is not None and v != ""}
        if not q:
            return path
        return f"{path}?{urlencode(q)}"

    def _json(self, res: httpx.Response) -> Any:
        res.raise_for_status()
        if not res.content:
            return None
        return res.json()

    def get_config(self) -> dict[str, Any]:
        return self._json(self._client.get(self._url("/config")))

    def get_markets(
        self,
        *,
        timeframe: Optional[int] = None,
        pair: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        return self._json(
            self._client.get(self._url("/markets", {"timeframe": timeframe, "pair": pair}))
        )

    def get_market(self, address: str) -> dict[str, Any]:
        return self._json(self._client.get(self._url(f"/markets/{address}")))

    def get_orderbook(self, market_id: str) -> dict[str, Any]:
        return self._json(self._client.get(self._url(f"/orderbook/{market_id}")))

    def get_balance(self, wallet: str) -> dict[str, Any]:
        return self._json(self._client.get(self._url(f"/balance/{wallet}")))

    def post_order(self, body: dict[str, Any]) -> dict[str, Any]:
        r = self._client.post(
            self._url("/orders"),
            content=json.dumps(body),
            headers={"Content-Type": "application/json"},
        )
        return self._json(r)
