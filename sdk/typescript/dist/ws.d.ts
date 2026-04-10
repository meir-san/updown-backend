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
export declare class UpDownWsClient {
    private readonly url;
    private readonly onMessage;
    private ws;
    private reconnect;
    private timer;
    private closed;
    constructor(url: string, onMessage: (msg: UpDownWsMessage) => void);
    connect(subscribe: SubscribePayload): void;
    disconnect(): void;
}
