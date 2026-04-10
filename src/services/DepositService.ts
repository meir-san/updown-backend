import { ethers } from 'ethers';
import mongoose from 'mongoose';
import { config } from '../config';
import { creditBalance, getOrCreateBalance } from '../models/Balance';
import { ProcessedDepositTxModel } from '../models/ProcessedDepositTx';
import type { WsServer } from '../ws/WebSocketServer';
import ERC20Abi from '../abis/ERC20.json';

const USDT_LOWER = config.usdtAddress.toLowerCase();

type DepositApplyResult = 'credited' | 'duplicate' | 'failed';

/**
 * Monitors USDT Transfer events to the relayer address.
 * On confirmed deposit, credits the sender's balance in MongoDB.
 */
export class DepositService {
  private provider: ethers.JsonRpcProvider;
  private usdtContract: ethers.Contract;
  private relayerAddress: string;
  private ws: WsServer | null;
  private running = false;

  constructor(provider: ethers.JsonRpcProvider, relayerAddress: string, ws: WsServer | null = null) {
    this.provider = provider;
    this.relayerAddress = relayerAddress.toLowerCase();
    this.ws = ws;
    this.usdtContract = new ethers.Contract(config.usdtAddress, ERC20Abi, provider);
  }

  /**
   * Single MongoDB transaction: insert ProcessedDepositTx + creditBalance.
   * Duplicate txHash → whole txn aborts → 'duplicate' (idempotent).
   */
  private async applyDepositTx(wallet: string, value: bigint, txHash: string): Promise<DepositApplyResult> {
    const h = txHash.toLowerCase();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await ProcessedDepositTxModel.create([{ txHash: h }], { session });
        await creditBalance(wallet, value, 'totalDeposited', session);
      });
      return 'credited';
    } catch (e: unknown) {
      const code = (e as { code?: number })?.code;
      if (code === 11000) return 'duplicate';
      console.error('[Deposit] Atomic deposit transaction failed', { txHash: h, err: e });
      return 'failed';
    } finally {
      session.endSession();
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const filter = this.usdtContract.filters.Transfer(null, this.relayerAddress);

    this.usdtContract.on(filter, async (from: string, _to: string, value: bigint, event: ethers.EventLog) => {
      try {
        const rawAddr = (event as { address?: string }).address;
        const logAddr = rawAddr?.toLowerCase();
        if (logAddr !== USDT_LOWER) {
          console.warn('[Deposit] Ignoring transfer from non-USDT contract:', rawAddr ?? '(unknown)');
          return;
        }

        const receipt = await this.provider.waitForTransaction(
          event.transactionHash,
          config.depositConfirmations
        );
        if (!receipt || receipt.status !== 1) return;

        const result = await this.applyDepositTx(from, value, event.transactionHash);
        if (result === 'duplicate') return;
        if (result === 'failed') return;

        const wallet = from.toLowerCase();
        const bal = await getOrCreateBalance(wallet);
        this.ws?.broadcastBalanceUpdate(wallet, {
          available: bal.available,
          inOrders: bal.inOrders,
          totalDeposited: bal.totalDeposited,
          totalWithdrawn: bal.totalWithdrawn,
          withdrawNonce: bal.withdrawNonce,
        });

        console.log(
          `[Deposit] Credited ${value.toString()} USDT to ${from} (tx: ${event.transactionHash})`
        );
      } catch (err) {
        console.error('[Deposit] Error processing deposit:', err);
      }
    });

    console.log(`[Deposit] Listening for USDT transfers to ${this.relayerAddress}`);
  }

  stop(): void {
    this.running = false;
    this.usdtContract.removeAllListeners();
  }
}
