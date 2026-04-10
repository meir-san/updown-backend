"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpDownWsClient = void 0;
/**
 * Minimal WebSocket helper with auto-reconnect (browser or Node 18+).
 */
class UpDownWsClient {
    url;
    onMessage;
    ws = null;
    reconnect = 0;
    timer = null;
    closed = false;
    constructor(url, onMessage) {
        this.url = url;
        this.onMessage = onMessage;
    }
    connect(subscribe) {
        this.closed = false;
        const run = () => {
            if (this.closed)
                return;
            const ws = new WebSocket(this.url);
            this.ws = ws;
            ws.onopen = () => {
                this.reconnect = 0;
                ws.send(JSON.stringify(subscribe));
            };
            ws.onmessage = (ev) => {
                try {
                    this.onMessage(JSON.parse(String(ev.data)));
                }
                catch {
                    /* ignore */
                }
            };
            ws.onclose = () => {
                if (this.closed)
                    return;
                const attempt = this.reconnect++;
                const delay = attempt > 12 ? 30_000 : Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
                this.timer = setTimeout(run, delay);
            };
            ws.onerror = () => ws.close();
        };
        run();
    }
    disconnect() {
        this.closed = true;
        if (this.timer)
            clearTimeout(this.timer);
        this.ws?.close();
        this.ws = null;
    }
}
exports.UpDownWsClient = UpDownWsClient;
