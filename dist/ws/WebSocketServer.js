"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WsServer = void 0;
const ws_1 = __importStar(require("ws"));
/**
 * WebSocket server for real-time order book updates, trade events, and balance changes.
 *
 * Clients subscribe to channels:
 *   - "orderbook:<marketAddr>" -- order book updates for a market
 *   - "trades:<marketAddr>" -- trade events for a market
 *   - "markets" -- new market / resolution events
 *   - "orders:<wallet>" -- order status updates for a specific wallet
 */
class WsServer {
    wss;
    clients = new Set();
    constructor(server, engine) {
        this.wss = new ws_1.WebSocketServer({ server, path: '/stream' });
        this.wss.on('connection', (ws) => {
            const client = { ws, channels: new Set() };
            this.clients.add(client);
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this.handleMessage(client, msg);
                }
                catch {
                    ws.send(JSON.stringify({ error: 'Invalid message format' }));
                }
            });
            ws.on('close', () => {
                this.clients.delete(client);
            });
            ws.on('error', () => {
                this.clients.delete(client);
            });
            ws.send(JSON.stringify({ type: 'connected', message: 'UpDown WebSocket connected' }));
        });
        // Wire up engine events
        engine.on('trade', (trade) => {
            this.broadcast(`trades:${trade.market}`, {
                type: 'trade',
                channel: `trades:${trade.market}`,
                data: {
                    id: trade.id,
                    market: trade.market,
                    option: trade.option,
                    buyer: trade.buyer,
                    seller: trade.seller,
                    price: trade.price,
                    amount: trade.amount.toString(),
                    timestamp: trade.timestamp,
                },
            });
        });
        engine.on('orderbook_update', (update) => {
            this.broadcast(`orderbook:${update.market}`, {
                type: 'orderbook_update',
                channel: `orderbook:${update.market}`,
                data: {
                    option: update.option,
                    snapshot: update.snapshot,
                },
            });
        });
        engine.on('order_update', (order) => {
            this.broadcast(`orders:${order.maker}`, {
                type: 'order_update',
                channel: `orders:${order.maker}`,
                data: {
                    id: order.id,
                    market: order.market,
                    option: order.option,
                    side: order.side,
                    status: order.status,
                    filledAmount: order.filledAmount.toString(),
                },
            });
        });
        console.log('[WebSocket] Server attached at /stream');
    }
    broadcastMarketEvent(type, data) {
        this.broadcast('markets', {
            type,
            channel: 'markets',
            data,
        });
    }
    broadcastBalanceUpdate(wallet, data) {
        for (const client of this.clients) {
            if (client.wallet === wallet.toLowerCase() || client.channels.has(`balance:${wallet.toLowerCase()}`)) {
                this.send(client, {
                    type: 'balance_update',
                    channel: `balance:${wallet}`,
                    data,
                });
            }
        }
    }
    handleMessage(client, msg) {
        switch (msg.type) {
            case 'subscribe':
                if (Array.isArray(msg.channels)) {
                    for (const ch of msg.channels) {
                        client.channels.add(ch.toLowerCase());
                    }
                }
                if (msg.wallet) {
                    client.wallet = msg.wallet.toLowerCase();
                }
                client.ws.send(JSON.stringify({
                    type: 'subscribed',
                    channels: Array.from(client.channels),
                }));
                break;
            case 'unsubscribe':
                if (Array.isArray(msg.channels)) {
                    for (const ch of msg.channels) {
                        client.channels.delete(ch.toLowerCase());
                    }
                }
                client.ws.send(JSON.stringify({
                    type: 'unsubscribed',
                    channels: Array.from(client.channels),
                }));
                break;
            default:
                client.ws.send(JSON.stringify({ error: `Unknown message type: ${msg.type}` }));
        }
    }
    broadcast(channel, message) {
        const normalized = channel.toLowerCase();
        const payload = JSON.stringify(message);
        for (const client of this.clients) {
            if (client.channels.has(normalized) && client.ws.readyState === ws_1.default.OPEN) {
                client.ws.send(payload);
            }
        }
    }
    send(client, message) {
        if (client.ws.readyState === ws_1.default.OPEN) {
            client.ws.send(JSON.stringify(message));
        }
    }
}
exports.WsServer = WsServer;
//# sourceMappingURL=WebSocketServer.js.map