"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConfigRouter = createConfigRouter;
const express_1 = require("express");
const config_1 = require("../config");
/**
 * Public client config: fees, chain, token addresses for EIP-712 and UI.
 */
function createConfigRouter(relayerAddress) {
    const router = (0, express_1.Router)();
    router.get('/', (_req, res) => {
        res.json({
            chainId: config_1.config.chainId,
            usdtAddress: config_1.config.usdtAddress,
            relayerAddress: relayerAddress.toLowerCase(),
            platformFeeBps: config_1.config.platformFeeBps,
            makerFeeBps: config_1.config.makerFeeBps,
            usdtDecimals: 6,
            eip712: {
                domain: {
                    name: config_1.EIP712_DOMAIN.name,
                    version: config_1.EIP712_DOMAIN.version,
                    chainId: config_1.EIP712_DOMAIN.chainId,
                    verifyingContract: config_1.EIP712_DOMAIN.verifyingContract,
                },
            },
        });
    });
    return router;
}
//# sourceMappingURL=config.js.map