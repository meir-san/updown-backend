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
exports.BalanceModel = void 0;
exports.getOrCreateBalance = getOrCreateBalance;
exports.creditBalance = creditBalance;
exports.debitAvailable = debitAvailable;
exports.applyWithdrawalAccounting = applyWithdrawalAccounting;
exports.releaseFromOrders = releaseFromOrders;
exports.settleTrade = settleTrade;
const mongoose_1 = __importStar(require("mongoose"));
const BalanceSchema = new mongoose_1.Schema({
    wallet: { type: String, required: true, unique: true, lowercase: true, index: true },
    available: { type: String, required: true, default: '0' },
    inOrders: { type: String, required: true, default: '0' },
    totalDeposited: { type: String, required: true, default: '0' },
    totalWithdrawn: { type: String, required: true, default: '0' },
    withdrawNonce: { type: Number, required: true, default: 0 },
}, { timestamps: true });
exports.BalanceModel = mongoose_1.default.model('Balance', BalanceSchema);
async function getOrCreateBalance(wallet) {
    const normalized = wallet.toLowerCase();
    let balance = await exports.BalanceModel.findOne({ wallet: normalized });
    if (!balance) {
        balance = await exports.BalanceModel.create({ wallet: normalized });
    }
    return balance;
}
async function creditBalance(wallet, amount, field = 'available') {
    const normalized = wallet.toLowerCase();
    const bal = await getOrCreateBalance(normalized);
    const current = BigInt(bal[field]);
    bal[field] = (current + amount).toString();
    if (field === 'totalDeposited') {
        const avail = BigInt(bal.available);
        bal.available = (avail + amount).toString();
    }
    await bal.save();
}
/** Atomic move from available → inOrders when balance is sufficient (MongoDB $expr + aggregation update). */
async function debitAvailable(wallet, amount) {
    const normalized = wallet.toLowerCase();
    const amtStr = amount.toString();
    const doc = await exports.BalanceModel.findOneAndUpdate({
        wallet: normalized,
        $expr: {
            $gte: [{ $toDecimal: '$available' }, { $toDecimal: amtStr }],
        },
    }, [
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
    ], { new: true });
    return doc !== null;
}
/**
 * After an on-chain USDT transfer succeeds, atomically debit available, bump withdraw nonce,
 * and increase totalWithdrawn.
 */
async function applyWithdrawalAccounting(wallet, amount) {
    const normalized = wallet.toLowerCase();
    const amtStr = amount.toString();
    const doc = await exports.BalanceModel.findOneAndUpdate({
        wallet: normalized,
        $expr: {
            $gte: [{ $toDecimal: '$available' }, { $toDecimal: amtStr }],
        },
    }, [
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
    ], { new: true });
    return doc !== null;
}
async function releaseFromOrders(wallet, amount) {
    const normalized = wallet.toLowerCase();
    const bal = await getOrCreateBalance(normalized);
    const inOrd = BigInt(bal.inOrders);
    bal.inOrders = (inOrd >= amount ? inOrd - amount : 0n).toString();
    bal.available = (BigInt(bal.available) + amount).toString();
    await bal.save();
}
async function settleTrade(buyer, seller, amount, makerFee) {
    const buyerBal = await getOrCreateBalance(buyer.toLowerCase());
    const buyerInOrders = BigInt(buyerBal.inOrders);
    buyerBal.inOrders = (buyerInOrders >= amount ? buyerInOrders - amount : 0n).toString();
    await buyerBal.save();
    const sellerBal = await getOrCreateBalance(seller.toLowerCase());
    sellerBal.available = (BigInt(sellerBal.available) + amount + makerFee).toString();
    await sellerBal.save();
}
//# sourceMappingURL=Balance.js.map