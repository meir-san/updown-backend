export type UpDownWsMessage = {
  type: string;
  channel?: string;
  data?: unknown;
};

export type SubscribePayload = {
  type: "subscribe";
  channels: string[];
  wallet?: string;
};

/**
 * Minimal WebSocket helper with auto-reconnect (browser or Node 18+).
 */
export class UpDownWsClient {
  private ws: WebSocket | null = null;
  private reconnect = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly onMessage: (msg: UpDownWsMessage) => void
  ) {}

  connect(subscribe: SubscribePayload): void {
    this.closed = false;
    const run = () => {
      if (this.closed) return;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.reconnect = 0;
        ws.send(JSON.stringify(subscribe));
      };
      ws.onmessage = (ev) => {
        try {
          this.onMessage(JSON.parse(String(ev.data)) as UpDownWsMessage);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (this.closed) return;
        const attempt = this.reconnect++;
        const delay = attempt > 12 ? 30_000 : Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        this.timer = setTimeout(run, delay);
      };
      ws.onerror = () => ws.close();
    };
    run();
  }

  disconnect(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }
}
