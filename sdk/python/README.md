# updown-sdk (Python)

```bash
pip install -e ".[dev]"
UPND_API=http://localhost:3001 python examples/taker_stub.py
```

Use `UpDownHttpClient` for REST. For WebSocket, run `subscribe_loop` in asyncio (see `updown_sdk/ws.py`).
