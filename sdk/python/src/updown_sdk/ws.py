from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable, List, Optional

import websockets


async def subscribe_loop(
    ws_url: str,
    channels: List[str],
    *,
    wallet: Optional[str] = None,
    on_message: Optional[Callable[[dict[str, Any]], Awaitable[None] | None]] = None,
    reconnect_base: float = 1.0,
    reconnect_max: float = 30.0,
) -> None:
    """Connect, subscribe, process messages; reconnect with exponential backoff."""
    attempt = 0
    while True:
        try:
            async with websockets.connect(ws_url) as ws:
                attempt = 0
                payload = {"type": "subscribe", "channels": channels}
                if wallet:
                    payload["wallet"] = wallet
                await ws.send(json.dumps(payload))
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                        if on_message:
                            r = on_message(msg)
                            if asyncio.iscoroutine(r):
                                await r
                    except json.JSONDecodeError:
                        continue
        except Exception:
            delay = min(reconnect_max, reconnect_base * (2 ** min(attempt, 5)))
            if attempt > 12:
                delay = reconnect_max
            attempt += 1
            await asyncio.sleep(delay)
