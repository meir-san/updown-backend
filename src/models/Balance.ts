import mongoose, { Schema, Document, ClientSession } from 'mongoose';

export interface IBalance extends Document {
  wallet: string;
  available: string;
  inOrders: string;
  totalDeposited: string;
  totalWithdrawn: string;
  withdrawNonce: number;
  updatedAt: Date;
}

const BalanceSchema = new Schema<IBalance>(
  {
    wallet: { type: String, required: true, unique: true, lowercase: true, index: true },
    available: { type: String, required: true, default: '0' },
    inOrders: { type: String, required: true, default: '0' },
    totalDeposited: { type: String, required: true, default: '0' },
    totalWithdrawn: { type: String, required: true, default: '0' },
    withdrawNonce: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

export const BalanceModel = mongoose.model<IBalance>('Balance', BalanceSchema);

const dec = (x: string) => ({ $toDecimal: { $ifNull: [x, '0'] } });

export async function getOrCreateBalance(wallet: string, session?: ClientSession): Promise<IBalance> {
  const normalized = wallet.toLowerCase();
  const doc = await BalanceModel.findOneAndUpdate(
    { wallet: normalized },
    {
      $setOnInsert: {
        wallet: normalized,
        available: '0',
        inOrders: '0',
        totalDeposited: '0',
        totalWithdrawn: '0',
        withdrawNonce: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );
  return doc!;
}

export async function creditBalance(
  wallet: string,
  amount: bigint,
  field: 'available' | 'totalDeposited' = 'available',
  session?: ClientSession
): Promise<void> {
  if (amount <= 0n) throw new Error('credit amount must be positive');
  const normalized = wallet.toLowerCase();
  const amtStr = amount.toString();
  await getOrCreateBalance(normalized, session);

  if (field === 'totalDeposited') {
    await BalanceModel.findOneAndUpdate(
      { wallet: normalized },
      [
        {
          $set: {
            available: {
              $toString: { $add: [dec('$available'), dec(amtStr)] },
            },
            totalDeposited: {
              $toString: { $add: [dec('$totalDeposited'), dec(amtStr)] },
            },
          },
        },
      ],
      { session }
    );
    return;
  }

  await BalanceModel.findOneAndUpdate(
    { wallet: normalized },
    [
      {
        $set: {
          available: { $toString: { $add: [dec('$available'), dec(amtStr)] } },
        },
      },
    ],
    { session }
  );
}

/** Atomic move from available → inOrders when balance is sufficient (MongoDB $expr + aggregation update). */
export async function debitAvailable(wallet: string, amount: bigint): Promise<boolean> {
  const normalized = wallet.toLowerCase();
  const amtStr = amount.toString();
  const doc = await BalanceModel.findOneAndUpdate(
    {
      wallet: normalized,
      $expr: {
        $gte: [{ $toDecimal: '$available' }, { $toDecimal: amtStr }],
      },
    },
    [
      {
        $set: {
          available: {
            $toString: {
              $subtract: [{ $toDecimal: '$available' }, { $toDecimal: amtStr }],
            },
          },
          inOrders: {
            $toString: {
              $add: [{ $toDecimal: '$inOrders' }, { $toDecimal: amtStr }],
            },
          },
        },
      },
    ],
    { new: true }
  );
  return doc !== null;
}

/**
 * After an on-chain USDT transfer succeeds, atomically debit available, bump withdraw nonce,
 * and increase totalWithdrawn.
 */
export async function applyWithdrawalAccounting(wallet: string, amount: bigint): Promise<boolean> {
  const normalized = wallet.toLowerCase();
  const amtStr = amount.toString();
  const doc = await BalanceModel.findOneAndUpdate(
    {
      wallet: normalized,
      $expr: {
        $gte: [{ $toDecimal: '$available' }, { $toDecimal: amtStr }],
      },
    },
    [
      {
        $set: {
          available: {
            $toString: {
              $subtract: [{ $toDecimal: '$available' }, { $toDecimal: amtStr }],
            },
          },
          totalWithdrawn: {
            $toString: {
              $add: [{ $toDecimal: '$totalWithdrawn' }, { $toDecimal: amtStr }],
            },
          },
          withdrawNonce: { $add: ['$withdrawNonce', 1] },
        },
      },
    ],
    { new: true }
  );
  return doc !== null;
}

/** Atomically reduce inOrders only (filled trade — collateral leaves the buyer's locked balance). */
export async function consumeFromOrders(wallet: string, amount: bigint, session?: ClientSession): Promise<boolean> {
  if (amount <= 0n) return false;
  const normalized = wallet.toLowerCase();
  const amtStr = amount.toString();
  const doc = await BalanceModel.findOneAndUpdate(
    {
      wallet: normalized,
      $expr: {
        $gte: [{ $toDecimal: '$inOrders' }, { $toDecimal: amtStr }],
      },
    },
    [
      {
        $set: {
          inOrders: {
            $toString: {
              $subtract: [{ $toDecimal: '$inOrders' }, { $toDecimal: amtStr }],
            },
          },
        },
      },
    ],
    { new: true, session }
  );
  return doc !== null;
}

/** Atomically move amount from inOrders → available (requires sufficient inOrders). */
export async function releaseFromOrders(wallet: string, amount: bigint, session?: ClientSession): Promise<boolean> {
  if (amount <= 0n) return false;
  const normalized = wallet.toLowerCase();
  const amtStr = amount.toString();
  const doc = await BalanceModel.findOneAndUpdate(
    {
      wallet: normalized,
      $expr: {
        $gte: [{ $toDecimal: '$inOrders' }, { $toDecimal: amtStr }],
      },
    },
    [
      {
        $set: {
          inOrders: {
            $toString: {
              $subtract: [{ $toDecimal: '$inOrders' }, { $toDecimal: amtStr }],
            },
          },
          available: {
            $toString: {
              $add: [{ $toDecimal: '$available' }, { $toDecimal: amtStr }],
            },
          },
        },
      },
    ],
    { new: true, session }
  );
  return doc !== null;
}

async function addToAvailable(wallet: string, amount: bigint, session?: ClientSession): Promise<void> {
  const normalized = wallet.toLowerCase();
  const amtStr = amount.toString();
  await getOrCreateBalance(normalized, session);
  await BalanceModel.findOneAndUpdate(
    { wallet: normalized },
    [
      {
        $set: {
          available: { $toString: { $add: [dec('$available'), dec(amtStr)] } },
        },
      },
    ],
    { session }
  );
}

/**
 * Release fillAmount from buyer's inOrders; credit seller (sellerReceives + makerFee); credit treasury platformFee.
 * Uses a MongoDB transaction when supported; otherwise sequential atomic updates.
 */
export async function settleFillBalances(
  buyer: string,
  seller: string,
  treasury: string,
  fillAmount: bigint,
  platformFee: bigint,
  sellerReceives: bigint,
  makerFee: bigint
): Promise<boolean> {
  const b = buyer.toLowerCase();
  const s = seller.toLowerCase();
  const t = treasury.toLowerCase();
  const sellerCredit = sellerReceives + makerFee;

  const run = async (session: ClientSession | undefined) => {
    const okConsume = await consumeFromOrders(b, fillAmount, session);
    if (!okConsume) return false;
    await addToAvailable(s, sellerCredit, session);
    if (platformFee > 0n) {
      await addToAvailable(t, platformFee, session);
    }
    return true;
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const ok = await run(session);
      if (!ok) throw new Error('settleFillBalances: buyer consume or credit failed');
    });
    return true;
  } catch (e) {
    console.warn('[Balance] settleFillBalances transaction failed, trying non-transactional:', e);
    try {
      return await run(undefined);
    } catch (e2) {
      console.error('[Balance] settleFillBalances sequential failed:', e2);
      return false;
    }
  } finally {
    session.endSession();
  }
}

/**
 * Undo settleFillBalances when on-chain settlement permanently fails.
 * Buyer regains full notional; seller and treasury lose what they received from the fill.
 */
export async function reverseSettledFill(
  buyer: string,
  seller: string,
  treasury: string,
  amount: bigint,
  platformFee: bigint,
  _makerFee: bigint
): Promise<boolean> {
  const b = buyer.toLowerCase();
  const s = seller.toLowerCase();
  const t = treasury.toLowerCase();
  const sellerTaken = amount - platformFee;

  const run = async (session: ClientSession | undefined) => {
    await getOrCreateBalance(b, session);
    const amtStr = amount.toString();
    await BalanceModel.findOneAndUpdate(
      { wallet: b },
      [{ $set: { available: { $toString: { $add: [dec('$available'), dec(amtStr)] } } } }],
      { session }
    );

    const sellerDebit = sellerTaken.toString();
    const sellerDoc = await BalanceModel.findOneAndUpdate(
      {
        wallet: s,
        $expr: { $gte: [{ $toDecimal: '$available' }, { $toDecimal: sellerDebit }] },
      },
      [
        {
          $set: {
            available: {
              $toString: {
                $subtract: [{ $toDecimal: '$available' }, { $toDecimal: sellerDebit }],
              },
            },
          },
        },
      ],
      { new: true, session }
    );
    if (!sellerDoc) return false;

    if (platformFee > 0n) {
      const pf = platformFee.toString();
      const treasDoc = await BalanceModel.findOneAndUpdate(
        {
          wallet: t,
          $expr: { $gte: [{ $toDecimal: '$available' }, { $toDecimal: pf }] },
        },
        [
          {
            $set: {
              available: {
                $toString: {
                  $subtract: [{ $toDecimal: '$available' }, { $toDecimal: pf }],
                },
              },
            },
          },
        ],
        { new: true, session }
      );
      if (!treasDoc) return false;
    }

    return true;
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const ok = await run(session);
      if (!ok) throw new Error('reverseSettledFill: insufficient seller/treasury balance or buyer update failed');
    });
    return true;
  } catch (e) {
    console.error(
      '[Balance] reverseSettledFill failed — requires MongoDB transactions (replica set). Do not retry blindly; manual reconciliation may be required.',
      {
        buyer: b,
        seller: s,
        treasury: t,
        amount: amount.toString(),
        platformFee: platformFee.toString(),
        err: e,
      }
    );
    return false;
  } finally {
    session.endSession();
  }
}
