/**
 * Utility functions for the resolver
 * Simplified implementation for hackathon without external SDKs
 */
import { ethers } from "ethers";
/**
 * Generate a secret for atomic swaps
 */
export declare function generateSecret(): string;
/**
 * Hash a secret using keccak256
 */
export declare function hashSecret(secret: string): string;
/**
 * Validate secret format
 */
export declare function validateSecret(secret: string): {
    valid: boolean;
    error?: string;
};
/**
 * Verify secret against hash
 */
export declare function verifySecret(secret: string, expectedHash: string): {
    valid: boolean;
    error?: string;
};
/**
 * Format ETH amounts for display
 */
export declare function formatEthAmount(amount: string, decimals?: number): string;
/**
 * Parse ETH amounts from user input
 */
export declare function parseEthAmount(amount: string, decimals?: number): bigint;
/**
 * Sleep utility for async operations
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Retry utility for network operations
 */
export declare function retryAsync<T>(operation: () => Promise<T>, maxRetries?: number, delayMs?: number): Promise<T>;
/**
 * Calculate percentage difference between two values
 */
export declare function calculatePercentageDifference(value1: string, value2: string): number;
/**
 * Check if a value is within a percentage threshold of another
 */
export declare function isWithinThreshold(actual: string, expected: string, thresholdPercent: number): boolean;
/**
 * Convert between different chain address formats
 */
export declare function normalizeAddress(address: string, targetChain: "evm" | "aptos"): string;
/**
 * Generate a unique order hash for tracking
 */
export declare function generateOrderHash(maker: string, makerAsset: string, takerAsset: string, makingAmount: string, takingAmount: string, salt: string): string;
/**
 * Estimate gas for a transaction
 */
export declare function estimateGas(provider: ethers.Provider, transaction: ethers.TransactionRequest): Promise<bigint>;
/**
 * Get current gas price with buffer
 */
export declare function getGasPriceWithBuffer(provider: ethers.Provider, bufferMultiplier?: number): Promise<bigint>;
/**
 * Check if a transaction hash is valid
 */
export declare function isValidTxHash(hash: string): boolean;
/**
 * Extract error message from various error types
 */
export declare function extractErrorMessage(error: unknown): string;
/**
 * Create a timeout promise
 */
export declare function createTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T>;
/**
 * Convert timestamp to human readable format
 */
export declare function formatTimestamp(timestamp: number): string;
/**
 * Check if a timestamp is expired
 */
export declare function isExpired(timestamp: number): boolean;
//# sourceMappingURL=utils.d.ts.map