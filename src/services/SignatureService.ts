import { ethers } from 'ethers';
import { EIP712_DOMAIN, EIP712_ORDER_TYPES, EIP712_CANCEL_TYPES } from '../config';
import { OrderSide, OrderType } from '../engine/types';

export interface OrderMessage {
  maker: string;
  market: bigint;
  option: bigint;
  side: number;
  type: number;
  price: bigint;
  amount: bigint;
  nonce: bigint;
  expiry: bigint;
}

export interface CancelMessage {
  maker: string;
  orderId: string;
}

function toDomain(): ethers.TypedDataDomain {
  return {
    name: EIP712_DOMAIN.name,
    version: EIP712_DOMAIN.version,
    chainId: EIP712_DOMAIN.chainId,
    verifyingContract: EIP712_DOMAIN.verifyingContract,
  };
}

export function verifyOrderSignature(
  params: {
    maker: string;
    marketId: bigint | number | string;
    option: number;
    side: OrderSide;
    type: OrderType;
    price: number;
    amount: string;
    nonce: number;
    expiry: number;
  },
  signature: string
): boolean {
  const message: OrderMessage = {
    maker: params.maker,
    market: BigInt(params.marketId),
    option: BigInt(params.option),
    side: params.side,
    type: params.type,
    price: BigInt(params.price),
    amount: BigInt(params.amount),
    nonce: BigInt(params.nonce),
    expiry: BigInt(params.expiry),
  };

  try {
    const recovered = ethers.verifyTypedData(
      toDomain(),
      EIP712_ORDER_TYPES,
      message,
      signature
    );
    return recovered.toLowerCase() === params.maker.toLowerCase();
  } catch {
    return false;
  }
}

export function verifyCancelSignature(
  maker: string,
  orderId: string,
  signature: string
): boolean {
  const message: CancelMessage = { maker, orderId };
  try {
    const recovered = ethers.verifyTypedData(
      toDomain(),
      EIP712_CANCEL_TYPES,
      message,
      signature
    );
    return recovered.toLowerCase() === maker.toLowerCase();
  } catch {
    return false;
  }
}

