"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORDER_TYPES = void 0;
exports.buildOrderTypedData = buildOrderTypedData;
exports.ORDER_TYPES = {
    Order: [
        { name: "maker", type: "address" },
        { name: "market", type: "address" },
        { name: "option", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "type", type: "uint8" },
        { name: "price", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
    ],
};
function buildOrderTypedData(cfg, msg) {
    return {
        domain: cfg.eip712.domain,
        types: exports.ORDER_TYPES,
        primaryType: "Order",
        message: msg,
    };
}
