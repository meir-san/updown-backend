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
exports.MarketModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const MarketSchema = new mongoose_1.Schema({
    address: { type: String, required: true, unique: true, lowercase: true, index: true },
    pairId: { type: String, required: true },
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    duration: { type: Number, required: true },
    status: {
        type: String,
        required: true,
        enum: ['ACTIVE', 'TRADING_ENDED', 'RESOLVED', 'CLAIMED'],
        default: 'ACTIVE',
        index: true,
    },
    winner: { type: Number, default: null },
    upPrice: { type: String, default: '0' },
    downPrice: { type: String, default: '0' },
    strikePrice: { type: String, default: '' },
    volume: { type: String, default: '0' },
    claimedByRelayer: { type: Boolean, default: false },
    claimDistributionComplete: { type: Boolean, default: false },
    claimDustApplied: { type: Boolean, default: false },
}, { timestamps: true });
exports.MarketModel = mongoose_1.default.model('Market', MarketSchema);
//# sourceMappingURL=Market.js.map