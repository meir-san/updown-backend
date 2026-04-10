"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyOrderSignature = verifyOrderSignature;
exports.verifyCancelSignature = verifyCancelSignature;
exports.verifyWithdrawSignature = verifyWithdrawSignature;
const ethers_1 = require("ethers");
const config_1 = require("../config");
function toDomain() {
    return {
        name: config_1.EIP712_DOMAIN.name,
        version: config_1.EIP712_DOMAIN.version,
        chainId: config_1.EIP712_DOMAIN.chainId,
        verifyingContract: config_1.EIP712_DOMAIN.verifyingContract,
    };
}
function verifyOrderSignature(params, signature) {
    const message = {
        maker: params.maker,
        market: params.market,
        option: BigInt(params.option),
        side: params.side,
        type: params.type,
        price: BigInt(params.price),
        amount: BigInt(params.amount),
        nonce: BigInt(params.nonce),
        expiry: BigInt(params.expiry),
    };
    try {
        const recovered = ethers_1.ethers.verifyTypedData(toDomain(), config_1.EIP712_ORDER_TYPES, message, signature);
        return recovered.toLowerCase() === params.maker.toLowerCase();
    }
    catch {
        return false;
    }
}
function verifyCancelSignature(maker, orderId, signature) {
    const message = { maker, orderId };
    try {
        const recovered = ethers_1.ethers.verifyTypedData(toDomain(), config_1.EIP712_CANCEL_TYPES, message, signature);
        return recovered.toLowerCase() === maker.toLowerCase();
    }
    catch {
        return false;
    }
}
function verifyWithdrawSignature(wallet, amount, nonce, signature) {
    const message = {
        wallet,
        amount: BigInt(amount),
        nonce: BigInt(nonce),
    };
    try {
        const recovered = ethers_1.ethers.verifyTypedData(toDomain(), config_1.EIP712_WITHDRAW_TYPES, message, signature);
        return recovered.toLowerCase() === wallet.toLowerCase();
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=SignatureService.js.map