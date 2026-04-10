#!/usr/bin/env python3
"""Reference: HTTP poll + optional WS (set UPND_API). Not a production arb bot."""
import os
import asyncio

from updown_sdk import UpDownHttpClient, ws_url_from_http_base, subscribe_loop


def main() -> None:
    base = os.environ.get("UPND_API", "http://localhost:3001")
    c = UpDownHttpClient(base)
    cfg = c.get_config()
    print("Relayer (deposit USDT):", cfg.get("relayerAddress"))
    m = c.get_markets(timeframe=300, pair="BTC-USD")
    print("5 min BTC-USD markets:", len(m))
    c.close()


if __name__ == "__main__":
    main()
    # asyncio.run(subscribe_loop(ws_url_from_http_base(os.environ["UPND_API"]), ["markets"], on_message=print))
