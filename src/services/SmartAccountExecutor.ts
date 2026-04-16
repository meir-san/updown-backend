import { config, MAX_UINT256 } from '../config';
import type { Abi, Address, Hex } from 'viem';
import UpDownSettlementAbi from '../abis/UpDownSettlement.json';

type SessionKeyHex = Hex;

/**
 * Alchemy Account Kit + viem: Light Account per backend session key (owner EOA is not the signer).
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

  async createClientFromSession(sessionKey: string) {
    const { createLightAccountAlchemyClient } = await import('@account-kit/smart-contracts');
    const { alchemy } = await import('@account-kit/infra');
    const { LocalAccountSigner } = await import('@aa-sdk/core');
    const { privateKeyToAccount } = await import('viem/accounts');

    const chain = await this.alchemyChain();
    const pk = this.normalizeSessionKey(sessionKey);
    const signer = new LocalAccountSigner(privateKeyToAccount(pk));
    const client = await createLightAccountAlchemyClient({
      chain,
      transport: alchemy({ apiKey: this.apiKey }),
      signer,
      ...(this.policyId ? { policyId: this.policyId } : {}),
    });
    return client;
  }

  async getSmartAccountAddress(sessionKey: string): Promise<Address> {
    const client = await this.createClientFromSession(sessionKey);
    return client.account.address;
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

  async executeContractCall(
    sessionKey: string,
    call: { to: Address; abi: Abi; functionName: string; args?: readonly unknown[] }
  ): Promise<Hex> {
    const { encodeFunctionData } = await import('viem');
    const client = await this.createClientFromSession(sessionKey);
    const data = encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName as never,
      args: (call.args ?? []) as never,
    });
    const { hash } = await client.sendUserOperation({
      uo: { target: call.to, data },
    });
    const txHash = await client.waitForUserOperationTransaction({ hash });
    return txHash;
  }

  async ensureUsdtApproval(sessionKey: string, spender: Address, minAllowance: bigint): Promise<void> {
    const { encodeFunctionData, erc20Abi, createPublicClient, http } = await import('viem');
    const usdt = config.usdtAddress as Address;
    const chain = await this.alchemyChain();
    const pc = createPublicClient({ chain, transport: http(config.arbitrumRpcUrl) });
    const client = await this.createClientFromSession(sessionKey);
    const sa = client.account.address;
    const allowance = await pc.readContract({
      address: usdt,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [sa, spender],
    });
    if (allowance >= minAllowance) return;

    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, MAX_UINT256],
    });
    const { hash } = await client.sendUserOperation({
      uo: { target: usdt, data },
    });
    await client.waitForUserOperationTransaction({ hash });
  }

  async withdrawFromSmartAccount(sessionKey: string, to: Address, amount: bigint): Promise<Hex> {
    const { erc20Abi } = await import('viem');
    const usdt = config.usdtAddress as Address;
    return this.executeContractCall(sessionKey, {
      to: usdt,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, amount],
    });
  }

  async enterPosition(
    sessionKey: string,
    marketId: bigint,
    option: number,
    amount: bigint
  ): Promise<Hex> {
    const settlement = config.settlementAddress as Address;
    return this.executeContractCall(sessionKey, {
      to: settlement,
      abi: UpDownSettlementAbi as unknown as Abi,
      functionName: 'enterPosition',
      args: [marketId, BigInt(option), amount],
    });
  }
}
