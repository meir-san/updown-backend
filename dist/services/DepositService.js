"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DepositService = void 0;
const ethers_1 = require("ethers");
const config_1 = require("../config");
const Balance_1 = require("../models/Balance");
const ProcessedDepositTx_1 = require("../models/ProcessedDepositTx");
const ERC20_json_1 = __importDefault(require("../abis/ERC20.json"));
/**
 * Monitors USDT Transfer events to the relayer address.
 * On confirmed deposit, credits the sender's balance in MongoDB.
 */
class DepositService {
    provider;
    usdtContract;
    relayerAddress;
    ws;
    running = false;
    constructor(provider, relayerAddress, ws = null) {
        this.provider = provider;
        this.relayerAddress = relayerAddress.toLowerCase();
        this.ws = ws;
        this.usdtContract = new ethers_1.ethers.Contract(config_1.config.usdtAddress, ERC20_json_1.default, provider);
    }
    async start() {
        if (this.running)
            return;
        this.running = true;
        const filter = this.usdtContract.filters.Transfer(null, this.relayerAddress);
        this.usdtContract.on(filter, async (from, _to, value, event) => {
            try {
                const receipt = await this.provider.waitForTransaction(event.transactionHash, config_1.config.depositConfirmations);
                if (!receipt || receipt.status !== 1)
                    return;
                const txHash = event.transactionHash.toLowerCase();
                try {
                    await ProcessedDepositTx_1.ProcessedDepositTxModel.create({ txHash });
                }
                catch (e) {
                    if (e.code === 11000) {
                        return;
                    }
                    throw e;
                }
                try {
                    await (0, Balance_1.creditBalance)(from, value, 'totalDeposited');
                }
                catch (creditErr) {
                    await ProcessedDepositTx_1.ProcessedDepositTxModel.deleteOne({ txHash }).catch(() => { });
                    throw creditErr;
                }
                const wallet = from.toLowerCase();
                const bal = await (0, Balance_1.getOrCreateBalance)(wallet);
                this.ws?.broadcastBalanceUpdate(wallet, {
                    available: bal.available,
                    inOrders: bal.inOrders,
                    totalDeposited: bal.totalDeposited,
                    totalWithdrawn: bal.totalWithdrawn,
                    withdrawNonce: bal.withdrawNonce,
                });
                console.log(`[Deposit] Credited ${value.toString()} USDT to ${from} (tx: ${event.transactionHash})`);
            }
            catch (err) {
                console.error('[Deposit] Error processing deposit:', err);
            }
        });
        console.log(`[Deposit] Listening for USDT transfers to ${this.relayerAddress}`);
    }
    stop() {
        this.running = false;
        this.usdtContract.removeAllListeners();
    }
}
exports.DepositService = DepositService;
//# sourceMappingURL=DepositService.js.map