import { config } from '../config';
import type { Abi, Address, Hex } from 'viem';
import UpDownSettlementAbi from '../abis/UpDownSettlement.json';

type SessionKeyHex = Hex;

export type SettlementSession = {
  smartAccountAddress: string;
  sessionPermissionsContext: string;
};

/**
 * Alchemy Account Kit: Modular Account V2 + user-granted session (`deferredAction` from grantPermissions `context`).
 */
export class SmartAccountExecutor {
  constructor(
    private readonly apiKey: string,
    private readonly policyId?: string
  ) {}

  private async alchemyChain() {
    const { arbitrum, arbitrumSepolia } = await import('@account-kit/infra');
    if (config.chainId === 421614) return arbitrumSepolia;
    return arbitrum;
  }

  private normalizeSessionKey(sessionKey: string): SessionKeyHex {
    const s = sessionKey.startsWith('0x') ? sessionKey : `0x${sessionKey}`;
    return s as Hex;
  }

  private normalizeDeferredAction(hex: string): Hex {
    const s = hex.startsWith('0x') ? hex : `0x${hex}`;
    return s as Hex;
  }

  /**
   * `sessionPermissionsContext` is the hex `context` from `grantPermissions`; the MA v2 SDK consumes it as `deferredAction`
   * (see `CreateModularAccountV2Params.deferredAction` in `@account-kit/smart-contracts` / `parseDeferredAction` in ma-v2 utils).
   */
  private async createModularClient(sessionKey: string, settlementSession: SettlementSession) {
    const { createModularAccountV2Client } = await import('@account-kit/smart-contracts');
    const { alchemy } = await import('@account-kit/infra');
    const { LocalAccountSigner } = await import('@aa-sdk/core');
    const { privateKeyToAccount } = await import('viem/accounts');

    const chain = await this.alchemyChain();
    const pk = this.normalizeSessionKey(sessionKey);
    const signer = new LocalAccountSigner(privateKeyToAccount(pk));
    const deferredAction = this.normalizeDeferredAction(settlementSession.sessionPermissionsContext);
    return createModularAccountV2Client({
      chain,
      transport: alchemy({ apiKey: this.apiKey }),
      signer,
      accountAddress: settlementSession.smartAccountAddress as Address,
      deferredAction,
      ...(this.policyId ? { policyId: this.policyId } : {}),
    });
  }

  async getSmartAccountBalance(smartAccountAddress: Address, usdtAddress: Address): Promise<bigint> {
    const { createPublicClient, http, erc20Abi } = await import('viem');
    const chain = await this.alchemyChain();
    const pc = createPublicClient({
      chain,
      transport: http(config.arbitrumRpcUrl),
    });
    return pc.readContract({
      address: usdtAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [smartAccountAddress],
    });
  }

  private async executeContractCall(
    sessionKey: string,
    settlementSession: SettlementSession,
    call: { to: Address; abi: Abi; functionName: string; args?: readonly unknown[] }
  ): Promise<Hex> {
    const { encodeFunctionData } = await import('viem');
    const client = await this.createModularClient(sessionKey, settlementSession);
    const data = encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName as never,
      args: (call.args ?? []) as never,
    });
    // TODO(non-custodial-redeem): if UserOp signing fails at runtime, confirm whether `sendUserOperation` needs a typed
    // `context` argument beyond `deferredAction` on account creation — `SendUserOperationParameters` uses `UserOperationContext = Record<string, any>` in @aa-sdk/core.
    const { hash } = await client.sendUserOperation({
      uo: { target: call.to, data },
    });
    const txHash = await client.waitForUserOperationTransaction({ hash });
    return txHash;
  }

  async enterPosition(
    sessionKey: string,
    marketId: bigint,
    option: number,
    amount: bigint,
    settlementSession: SettlementSession
  ): Promise<Hex> {
    const settlement = config.settlementAddress as Address;
    return this.executeContractCall(sessionKey, settlementSession, {
      to: settlement,
      abi: UpDownSettlementAbi as unknown as Abi,
      functionName: 'enterPosition',
      args: [marketId, BigInt(option), amount],
    });
  }
}
