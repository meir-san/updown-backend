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
exports.TradeModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const TradeSchema = new mongoose_1.Schema({
    tradeId: { type: String, required: true, unique: true, index: true },
    market: { type: String, required: true, lowercase: true, index: true },
    option: { type: Number, required: true, enum: [1, 2] },
    buyOrderId: { type: String, required: true, index: true },
    sellOrderId: { type: String, required: true, index: true },
    buyer: { type: String, required: true, lowercase: true, index: true },
    seller: { type: String, required: true, lowercase: true, index: true },
    price: { type: Number, required: true },
    amount: { type: String, required: true },
    platformFee: { type: String, required: true, default: '0' },
    makerFee: { type: String, required: true, default: '0' },
    settlementTxHash: { type: String, default: null },
    settlementStatus: {
        type: String,
        enum: ['PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED'],
        default: 'PENDING',
    },
    settlementRetryCount: { type: Number, default: 0 },
    settlementNextRetryAt: { type: Date, default: null },
}, { timestamps: true });
TradeSchema.index({ market: 1, buyer: 1 });
TradeSchema.index({ market: 1, seller: 1 });
TradeSchema.index({ settlementStatus: 1 });
exports.TradeModel = mongoose_1.default.model('Trade', TradeSchema);
//# sourceMappingURL=Trade.js.map