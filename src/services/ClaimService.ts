import { ethers } from 'ethers';
import { config } from '../config';
import { MarketModel } from '../models/Market';
import { TradeModel } from '../models/Trade';
import { creditBalance } from '../models/Balance';
import { ClaimPayoutLogModel } from '../models/ClaimPayoutLog';
import TradePoolAbi from '../abis/TradePool.json';

/**
 * After a market is resolved (ChainlinkResolver called chooseWinner),
 * the relayer claims its USDT payout and distributes winnings
 * to users based on their off-chain positions in MongoDB.
 */
export class ClaimService {
  private provider: ethers.JsonRpcProvider;
  private relayer: ethers.Wallet;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    this.relayer = new ethers.Wallet(config.relayerPrivateKey, provider);
  }

  async processResolvedMarket(marketAddress: string): Promise<void> {
    const normalizedAddr = marketAddress.toLowerCase();
    const market = await MarketModel.findOne({ address: normalizedAddr });
    if (!market || market.claimDistributionComplete) return;

    const pool = new ethers.Contract(marketAddress, TradePoolAbi, this.relayer);

    const finalized: boolean = await pool.poolFinalized();
    if (!finalized) return;

    const winner: bigint = await pool.winner();
    const winningOption = Number(winner);
    if (winningOption === 0) return;

    if (!market.claimedByRelayer) {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let claimed = false;
      for (let attempt = 0; attempt < 3 && !claimed; attempt++) {
        try {
          const tx = await pool.claim();
          await tx.wait();
          console.log(`[Claim] Claimed from pool ${marketAddress} (tx: ${tx.hash})`);
          claimed = true;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('AlreadyClaimed')) {
            console.log(`[Claim] Already claimed from ${marketAddress}`);
            claimed = true;
            break;
          }
          console.error(`[Claim] Claim attempt ${attempt + 1}/3 failed for ${marketAddress}:`, err);
          if (attempt < 2) await sleep(1000 * 2 ** attempt);
        }
      }
      if (!claimed) return;

      await MarketModel.updateOne(
        { _id: market._id, claimedByRelayer: false },
        { $set: { claimedByRelayer: true } }
      );
    }

    const relayerWallet = this.relayer.address.toLowerCase();
    await this.distributeWinnings(normalizedAddr, winningOption, relayerWallet);

    await MarketModel.updateOne(
      { _id: market._id },
      {
        $set: {
          claimDistributionComplete: true,
          status: 'CLAIMED',
          winner: winningOption,
        },
      }
    );
  }

  private async distributeWinnings(
    marketAddress: string,
    winningOption: number,
    relayerWallet: string
  ): Promise<void> {
    const normalizedAddr = marketAddress.toLowerCase();

    const winningTrades = await TradeModel.find({
      market: normalizedAddr,
      option: winningOption,
    });

    const buyerPositions = new Map<string, bigint>();
    for (const trade of winningTrades) {
      const buyer = trade.buyer.toLowerCase();
      const amount = BigInt(trade.amount);
      const current = buyerPositions.get(buyer) ?? 0n;
      buyerPositions.set(buyer, current + amount);
    }

    let totalWinningBought = 0n;
    for (const amount of buyerPositions.values()) {
      totalWinningBought += amount;
    }

    if (totalWinningBought === 0n) {
      console.log(`[Claim] No winning positions for market ${marketAddress}`);
      return;
    }

    const losingTrades = await TradeModel.find({
      market: normalizedAddr,
      option: winningOption === 1 ? 2 : 1,
    });

    let totalLosingBought = 0n;
    for (const trade of losingTrades) {
      totalLosingBought += BigInt(trade.amount);
    }

    const totalPool = totalWinningBought + totalLosingBought;

    let totalDistributed = 0n;
    const priorLogs = await ClaimPayoutLogModel.find({ market: normalizedAddr });
    for (const l of priorLogs) {
      totalDistributed += BigInt(l.amount);
    }

    for (const [wallet, position] of buyerPositions) {
      const payout = (position * totalPool) / totalWinningBought;
      if (payout <= 0n) continue;

      const already = await ClaimPayoutLogModel.findOne({ market: normalizedAddr, wallet });
      if (already) continue;

      try {
        await ClaimPayoutLogModel.create({
          market: normalizedAddr,
          wallet,
          amount: payout.toString(),
        });
      } catch (e: any) {
        if (e.code === 11000) {
          continue;
        }
        throw e;
      }

      await creditBalance(wallet, payout);
      totalDistributed += payout;
      console.log(`[Claim] Credited ${payout.toString()} to ${wallet} for market ${marketAddress}`);
    }

    const dust = totalPool > totalDistributed ? totalPool - totalDistributed : 0n;
    if (dust > 0n) {
      const dustRes = await MarketModel.findOneAndUpdate(
        { address: normalizedAddr, claimDustApplied: { $ne: true } },
        { $set: { claimDustApplied: true } }
      );
      if (dustRes) {
        await creditBalance(relayerWallet, dust);
        console.log(`[Claim] Credited dust ${dust.toString()} to relayer for market ${marketAddress}`);
      }
    }
  }
}
