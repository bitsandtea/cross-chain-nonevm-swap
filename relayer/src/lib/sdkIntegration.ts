/**
 * 1inch SDK Integration for FusionPlus Orders
 * Uses the official 1inch Cross-Chain SDK patterns from resolver.example.ts
 */

import { uint8ArrayToHex, UINT_40_MAX } from "@1inch/byte-utils";
import { HashLock, randBigInt } from "@1inch/cross-chain-sdk";
import { ethers, randomBytes } from "ethers";
import { FusionPlusOrder } from "./types";

/**
 * Generate secrets using 1inch SDK patterns (from resolver example)
 */
export function generateSDKSecret(): string {
  return uint8ArrayToHex(ethers.randomBytes(32));
}

/**
 * Hash secret using 1inch SDK (from resolver example)
 */
export function hashSDKSecret(secret: string): string {
  return HashLock.hashSecret(secret);
}

/**
 * Generate random BigInt using SDK (compatible with resolver example)
 */
export function generateRandomBigInt(max: bigint = UINT_40_MAX): bigint {
  return randBigInt(max);
}

/**
 * Generate multiple secrets for partial fills (like resolver example with 11 secrets)
 * Using simple approach without complex Merkle operations
 */
export function generateMultipleSecrets(count: number = 11): {
  secrets: string[];
  secretHashes: string[];
} {
  const secrets = Array.from({ length: count }).map(() =>
    uint8ArrayToHex(ethers.randomBytes(32))
  );
  const secretHashes = secrets.map((s) => HashLock.hashSecret(s));

  return {
    secrets,
    secretHashes,
  };
}

/**
 * Calculate secret index for partial fills (from resolver example)
 * Example usage: const idx = calculatePartialFillIndex(fillAmount, order.makingAmount, secrets.length)
 */
export function calculatePartialFillIndex(
  fillAmount: bigint,
  totalAmount: bigint,
  secretCount: number
): number {
  if (fillAmount >= totalAmount) {
    return secretCount - 1; // Use last secret for 100% fill
  }

  // From resolver example: Number((BigInt(secrets.length - 1) * (fillAmount - 1n)) / order.makingAmount)
  const index = Number(
    (BigInt(secretCount - 1) * (fillAmount - BigInt(1))) / totalAmount
  );
  return Math.max(0, Math.min(index, secretCount - 1));
}

/**
 * Create a simple FusionPlusOrder using basic SDK utilities
 */
export function createSimpleFusionOrder(params: {
  maker: string;
  makingAmount: string;
  takingAmount: string;
  makerAsset: string;
  takerAsset: string;
  srcChainId: number;
  dstChainId: number;
  allowPartialFills?: boolean;
  auctionDuration?: number;
}): {
  fusionOrder: FusionPlusOrder;
  secret: string;
  secrets?: string[];
} {
  const isPartialFill = params.allowPartialFills || false;
  let secret: string;
  let secrets: string[] | undefined;
  let secretHash: string;

  if (isPartialFill) {
    // Multiple fills pattern - use simple hashing approach
    const multiSecrets = generateMultipleSecrets(11);
    secrets = multiSecrets.secrets;
    secret = secrets[secrets.length - 1]; // Use last secret as master
    // For partial fills, we'll use the hash of the first secret as the main hash
    // This is a simplified approach - in production you'd use proper Merkle trees
    secretHash = HashLock.hashSecret(secret);
  } else {
    // Single fill pattern
    secret = generateSDKSecret();
    secretHash = HashLock.hashSecret(secret);
  }

  const fusionOrder: FusionPlusOrder = {
    makerAsset: params.makerAsset,
    takerAsset: params.takerAsset,
    makingAmount: params.makingAmount,
    takingAmount: params.takingAmount,
    maker: params.maker,
    srcChain: params.srcChainId,
    dstChain: params.dstChainId,
    auctionStartTime: Math.floor(Date.now() / 1000),
    auctionDuration: params.auctionDuration || 120,
    startRate: "0",
    endRate: "0",
    secretHash,
    srcEscrowTarget: params.maker,
    dstEscrowTarget: params.maker,
    srcTimelock: 120,
    dstTimelock: 100,
    finalityLock: 10,
    srcSafetyDeposit: ethers.parseEther("0.001").toString(),
    dstSafetyDeposit: ethers.parseEther("0.001").toString(),
    fillThresholds: isPartialFill ? [25, 50, 75, 100] : [100],
    secretTree: isPartialFill ? secretHash : undefined,
    salt: ethers.toBeHex(generateRandomBigInt(BigInt(1000)), 32),
    expiration:
      Math.floor(Date.now() / 1000) + (params.auctionDuration || 120) + 3600,
  };

  return {
    fusionOrder,
    secret,
    secrets,
  };
}

/**
 * Convert existing FusionPlusOrder to use SDK-generated values
 */
export function enhanceOrderWithSDK(
  order: FusionPlusOrder,
  secret: string
): {
  enhancedOrder: FusionPlusOrder;
  sdkSecretHash: string;
} {
  const sdkSecretHash = HashLock.hashSecret(secret);

  const enhancedOrder: FusionPlusOrder = {
    ...order,
    secretHash: sdkSecretHash,
    salt: ethers.toBeHex(generateRandomBigInt(BigInt(1000)), 32),
  };

  return {
    enhancedOrder,
    sdkSecretHash,
  };
}

/**
 * Build Fusion+ order using simplified approach compatible with current SDK
 */
export function buildFusionPlusOrder(params: {
  maker: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: string;
  takingAmount: string;
  srcChain: number;
  dstChain: number;
  escrowFactory: string;
  secret?: string;
  allowPartialFills?: boolean;
  auctionDuration?: number;
  safetyDeposit?: string;
}): {
  order: FusionPlusOrder;
  secret: string;
  signature?: string;
} {
  // Generate secret if not provided
  const secret = params.secret || uint8ArrayToHex(randomBytes(32));
  const secretHash = HashLock.hashSecret(secret);

  // Create a simplified order structure compatible with our FusionPlusOrder type
  const order: FusionPlusOrder = {
    makerAsset: params.makerAsset,
    takerAsset: params.takerAsset,
    makingAmount: params.makingAmount,
    takingAmount: params.takingAmount,
    maker: params.maker,
    srcChain: params.srcChain,
    dstChain: params.dstChain,
    auctionStartTime: Math.floor(Date.now() / 1000),
    auctionDuration: params.auctionDuration || 120,
    startRate: "0",
    endRate: "0",
    secretHash,
    srcEscrowTarget: params.maker,
    dstEscrowTarget: params.maker,
    srcTimelock: 120,
    dstTimelock: 100,
    finalityLock: 10,
    srcSafetyDeposit:
      params.safetyDeposit || ethers.parseEther("0.001").toString(),
    dstSafetyDeposit:
      params.safetyDeposit || ethers.parseEther("0.001").toString(),
    fillThresholds: params.allowPartialFills ? [25, 50, 75, 100] : [100],
    secretTree: params.allowPartialFills ? secretHash : undefined,
    salt: ethers.toBeHex(generateRandomBigInt(BigInt(1000)), 32),
    expiration:
      Math.floor(Date.now() / 1000) + (params.auctionDuration || 120) + 3600,
  };

  return {
    order,
    secret,
  };
}

/**
 * Utility functions compatible with resolver example patterns
 */
export const SDKUtils = {
  generateSecret: generateSDKSecret,
  hashSecret: hashSDKSecret,
  generateRandomBigInt,
  generateMultipleSecrets,
  calculatePartialFillIndex,
  buildFusionPlusOrder,

  // Constants from resolver example
  UINT_40_MAX,

  // Helper to get a random salt like in resolver example
  generateSalt: () => ethers.toBeHex(generateRandomBigInt(BigInt(1000)), 32),
};
