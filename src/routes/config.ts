import { Router, Request, Response } from 'express';
import { config, EIP712_DOMAIN } from '../config';

/**
 * Public client config: fees, chain, token addresses for EIP-712 and UI.
 */
export function createConfigRouter(relayerAddress: string): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json({
      chainId: config.chainId,
      usdtAddress: config.usdtAddress,
      relayerAddress: relayerAddress.toLowerCase(),
      platformFeeBps: config.platformFeeBps,
      makerFeeBps: config.makerFeeBps,
      usdtDecimals: 6,
      eip712: {
        domain: {
          name: EIP712_DOMAIN.name,
          version: EIP712_DOMAIN.version,
          chainId: EIP712_DOMAIN.chainId,
          verifyingContract: EIP712_DOMAIN.verifyingContract,
        },
      },
    });
  });

  return router;
}
