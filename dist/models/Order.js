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
exports.OrderModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const OrderSchema = new mongoose_1.Schema({
    orderId: { type: String, required: true, unique: true, index: true },
    maker: { type: String, required: true, lowercase: true, index: true },
    market: { type: String, required: true, lowercase: true, index: true },
    option: { type: Number, required: true, enum: [1, 2] },
    side: { type: Number, required: true, enum: [0, 1] },
    type: { type: Number, required: true, enum: [0, 1] },
    price: { type: Number, required: true },
    amount: { type: String, required: true },
    filledAmount: { type: String, required: true, default: '0' },
    nonce: { type: Number, required: true },
    expiry: { type: Number, required: true },
    signature: { type: String, required: true },
    status: {
        type: String,
        required: true,
        enum: ['OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'],
        default: 'OPEN',
        index: true,
    },
}, { timestamps: true });
OrderSchema.index({ market: 1, status: 1 });
OrderSchema.index({ maker: 1, nonce: 1 }, { unique: true });
exports.OrderModel = mongoose_1.default.model('Order', OrderSchema);
//# sourceMappingURL=Order.js.map