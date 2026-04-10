import { Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer as WSServer } from 'ws';
import { MatchingEngine } from '../engine/MatchingEngine';
import { InternalOrder, TradeResult, WsMessage } from '../engine/types';

interface ClientState {
  ws: WebSocket;
  channels: Set<string>;
  wallet?: string;
}

/**
 * WebSocket server for real-time order book updates, trade events, and balance changes.
 *
 * Clients subscribe to channels:
 *   - "orderbook:<marketAddr>" -- order book updates for a market
 *   - "trades:<marketAddr>" -- trade events for a market
 *   - "markets" -- new market / resolution events
 *   - "orders:<wallet>" -- order status updates for a specific wallet
 */
export class WsServer {
  private wss: WSServer;
  private clients: Set<ClientState> = new Set();

  constructor(server: HttpServer, engine: MatchingEngine) {
    this.wss = new WSServer({ server, path: '/stream' });

    this.wss.on('connection', (ws) => {
      const client: ClientState = { ws, channels: new Set() };
      this.clients.add(client);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(client, msg);
        } catch {
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
    engine.on('trade', (trade: TradeResult) => {
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

    engine.on('orderbook_update', (update: { market: string; option: number; snapshot: any }) => {
      this.broadcast(`orderbook:${update.market}`, {
        type: 'orderbook_update',
        channel: `orderbook:${update.market}`,
        data: {
          option: update.option,
          snapshot: update.snapshot,
        },
      });
    });

    engine.on('order_update', (order: InternalOrder) => {
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

    const pingMs = 25_000;
    setInterval(() => {
      for (const client of this.clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.ping();
          } catch {
            /* ignore */
          }
        }
      }
    }, pingMs).unref?.();
  }

  broadcastMarketEvent(type: 'market_created' | 'market_resolved', data: any): void {
    this.broadcast('markets', {
      type,
      channel: 'markets',
      data,
    });
  }

  broadcastBalanceUpdate(wallet: string, data: any): void {
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

  private handleMessage(client: ClientState, msg: any): void {
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
        client.ws.send(
          JSON.stringify({
            type: 'subscribed',
            channels: Array.from(client.channels),
          })
        );
        break;

      case 'unsubscribe':
        if (Array.isArray(msg.channels)) {
          for (const ch of msg.channels) {
            client.channels.delete(ch.toLowerCase());
          }
        }
        client.ws.send(
          JSON.stringify({
            type: 'unsubscribed',
            channels: Array.from(client.channels),
          })
        );
        break;

      default:
        client.ws.send(JSON.stringify({ error: `Unknown message type: ${msg.type}` }));
    }
  }

  private broadcast(channel: string, message: WsMessage): void {
    const normalized = channel.toLowerCase();
    const payload = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.channels.has(normalized) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  private send(client: ClientState, message: WsMessage): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }
}
