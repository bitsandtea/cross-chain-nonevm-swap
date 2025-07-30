/**
 * Utility functions for the resolver
 * Simplified implementation for hackathon without external SDKs
 */

import { ethers } from "ethers";

/**
 * Generate a secret for atomic swaps
 */
export function generateSecret(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

/**
 * Hash a secret using keccak256
 */
export function hashSecret(secret: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(secret));
}

/**
 * Validate secret format
 */
export function validateSecret(secret: string): {
  valid: boolean;
  error?: string;
} {
  if (!secret.startsWith("0x") || secret.length !== 66) {
    return {
      valid: false,
      error:
        "Secret must be a 32-byte hex string (0x followed by 64 hex chars)",
    };
  }

  try {
    ethers.getBytes(secret);
  } catch {
    return { valid: false, error: "Secret contains invalid hex characters" };
  }

  return { valid: true };
}

/**
 * Verify secret against hash
 */
export function verifySecret(
  secret: string,
  expectedHash: string
): { valid: boolean; error?: string } {
  const formatValidation = validateSecret(secret);
  if (!formatValidation.valid) {
    return formatValidation;
  }

  try {
    const computedHash = hashSecret(secret);
    if (computedHash !== expectedHash) {
      return { valid: false, error: "Secret does not match the expected hash" };
    }
  } catch (error) {
    return { valid: false, error: "Failed to compute secret hash" };
  }

  return { valid: true };
}

/**
 * Format ETH amounts for display
 */
export function formatEthAmount(amount: string, decimals: number = 18): string {
  try {
    return ethers.formatUnits(amount, decimals);
  } catch {
    return "0";
  }
}

/**
 * Parse ETH amounts from user input
 */
export function parseEthAmount(amount: string, decimals: number = 18): bigint {
  try {
    return ethers.parseUnits(amount, decimals);
  } catch {
    return BigInt(0);
  }
}

/**
 * Sleep utility for async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry utility for network operations
 */
export async function retryAsync<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (i === maxRetries) {
        throw lastError;
      }

      await sleep(delayMs * (i + 1)); // Exponential backoff
    }
  }

  throw lastError!;
}

/**
 * Calculate percentage difference between two values
 */
export function calculatePercentageDifference(
  value1: string,
  value2: string
): number {
  const v1 = parseFloat(value1);
  const v2 = parseFloat(value2);

  if (v1 === 0) return v2 === 0 ? 0 : 100;

  return Math.abs((v2 - v1) / v1) * 100;
}

/**
 * Check if a value is within a percentage threshold of another
 */
export function isWithinThreshold(
  actual: string,
  expected: string,
  thresholdPercent: number
): boolean {
  const diff = calculatePercentageDifference(actual, expected);
  return diff <= thresholdPercent;
}

/**
 * Convert between different chain address formats
 */
export function normalizeAddress(
  address: string,
  targetChain: "evm" | "aptos"
): string {
  if (targetChain === "evm") {
    return ethers.getAddress(address); // Checksummed Ethereum address
  } else {
    // Aptos address normalization
    if (address.startsWith("0x")) {
      return address.toLowerCase();
    }
    return `0x${address.toLowerCase()}`;
  }
}

/**
 * Generate a unique order hash for tracking
 */
export function generateOrderHash(
  maker: string,
  makerAsset: string,
  takerAsset: string,
  makingAmount: string,
  takingAmount: string,
  salt: string
): string {
  const data = ethers.solidityPacked(
    ["address", "address", "address", "uint256", "uint256", "bytes32"],
    [maker, makerAsset, takerAsset, makingAmount, takingAmount, salt]
  );
  return ethers.keccak256(data);
}

/**
 * Estimate gas for a transaction
 */
export async function estimateGas(
  provider: ethers.Provider,
  transaction: ethers.TransactionRequest
): Promise<bigint> {
  try {
    return await provider.estimateGas(transaction);
  } catch (error) {
    // Fallback to a default gas limit if estimation fails
    console.warn("Gas estimation failed, using default:", error);
    return BigInt(200000); // 200k gas as fallback
  }
}

/**
 * Get current gas price with buffer
 */
export async function getGasPriceWithBuffer(
  provider: ethers.Provider,
  bufferMultiplier: number = 1.2
): Promise<bigint> {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || BigInt(0);

  return BigInt(Math.floor(Number(gasPrice) * bufferMultiplier));
}

/**
 * Check if a transaction hash is valid
 */
export function isValidTxHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

/**
 * Extract error message from various error types
 */
export function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    if ("message" in error) {
      return String(error.message);
    }

    if ("reason" in error) {
      return String(error.reason);
    }
  }

  return "Unknown error";
}

/**
 * Create a timeout promise
 */
export function createTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Convert timestamp to human readable format
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Check if a timestamp is expired
 */
export function isExpired(timestamp: number): boolean {
  return timestamp < Math.floor(Date.now() / 1000);
}
