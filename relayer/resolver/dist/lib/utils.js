"use strict";
/**
 * Utility functions for the resolver
 * Simplified implementation for hackathon without external SDKs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSecret = generateSecret;
exports.hashSecret = hashSecret;
exports.validateSecret = validateSecret;
exports.verifySecret = verifySecret;
exports.formatEthAmount = formatEthAmount;
exports.parseEthAmount = parseEthAmount;
exports.sleep = sleep;
exports.retryAsync = retryAsync;
exports.calculatePercentageDifference = calculatePercentageDifference;
exports.isWithinThreshold = isWithinThreshold;
exports.normalizeAddress = normalizeAddress;
exports.generateOrderHash = generateOrderHash;
exports.estimateGas = estimateGas;
exports.getGasPriceWithBuffer = getGasPriceWithBuffer;
exports.isValidTxHash = isValidTxHash;
exports.extractErrorMessage = extractErrorMessage;
exports.createTimeout = createTimeout;
exports.formatTimestamp = formatTimestamp;
exports.isExpired = isExpired;
const ethers_1 = require("ethers");
/**
 * Generate a secret for atomic swaps
 */
function generateSecret() {
    return ethers_1.ethers.hexlify(ethers_1.ethers.randomBytes(32));
}
/**
 * Hash a secret using keccak256
 */
function hashSecret(secret) {
    return ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(secret));
}
/**
 * Validate secret format
 */
function validateSecret(secret) {
    if (!secret.startsWith("0x") || secret.length !== 66) {
        return {
            valid: false,
            error: "Secret must be a 32-byte hex string (0x followed by 64 hex chars)",
        };
    }
    try {
        ethers_1.ethers.getBytes(secret);
    }
    catch {
        return { valid: false, error: "Secret contains invalid hex characters" };
    }
    return { valid: true };
}
/**
 * Verify secret against hash
 */
function verifySecret(secret, expectedHash) {
    const formatValidation = validateSecret(secret);
    if (!formatValidation.valid) {
        return formatValidation;
    }
    try {
        const computedHash = hashSecret(secret);
        if (computedHash !== expectedHash) {
            return { valid: false, error: "Secret does not match the expected hash" };
        }
    }
    catch (error) {
        return { valid: false, error: "Failed to compute secret hash" };
    }
    return { valid: true };
}
/**
 * Format ETH amounts for display
 */
function formatEthAmount(amount, decimals = 18) {
    try {
        return ethers_1.ethers.formatUnits(amount, decimals);
    }
    catch {
        return "0";
    }
}
/**
 * Parse ETH amounts from user input
 */
function parseEthAmount(amount, decimals = 18) {
    try {
        return ethers_1.ethers.parseUnits(amount, decimals);
    }
    catch {
        return BigInt(0);
    }
}
/**
 * Sleep utility for async operations
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Retry utility for network operations
 */
async function retryAsync(operation, maxRetries = 3, delayMs = 1000) {
    let lastError;
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            if (i === maxRetries) {
                throw lastError;
            }
            await sleep(delayMs * (i + 1)); // Exponential backoff
        }
    }
    throw lastError;
}
/**
 * Calculate percentage difference between two values
 */
function calculatePercentageDifference(value1, value2) {
    const v1 = parseFloat(value1);
    const v2 = parseFloat(value2);
    if (v1 === 0)
        return v2 === 0 ? 0 : 100;
    return Math.abs((v2 - v1) / v1) * 100;
}
/**
 * Check if a value is within a percentage threshold of another
 */
function isWithinThreshold(actual, expected, thresholdPercent) {
    const diff = calculatePercentageDifference(actual, expected);
    return diff <= thresholdPercent;
}
/**
 * Convert between different chain address formats
 */
function normalizeAddress(address, targetChain) {
    if (targetChain === "evm") {
        return ethers_1.ethers.getAddress(address); // Checksummed Ethereum address
    }
    else {
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
function generateOrderHash(maker, makerAsset, takerAsset, makingAmount, takingAmount, salt) {
    const data = ethers_1.ethers.solidityPacked(["address", "address", "address", "uint256", "uint256", "bytes32"], [maker, makerAsset, takerAsset, makingAmount, takingAmount, salt]);
    return ethers_1.ethers.keccak256(data);
}
/**
 * Estimate gas for a transaction
 */
async function estimateGas(provider, transaction) {
    try {
        return await provider.estimateGas(transaction);
    }
    catch (error) {
        // Fallback to a default gas limit if estimation fails
        console.warn("Gas estimation failed, using default:", error);
        return BigInt(200000); // 200k gas as fallback
    }
}
/**
 * Get current gas price with buffer
 */
async function getGasPriceWithBuffer(provider, bufferMultiplier = 1.2) {
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || BigInt(0);
    return BigInt(Math.floor(Number(gasPrice) * bufferMultiplier));
}
/**
 * Check if a transaction hash is valid
 */
function isValidTxHash(hash) {
    return /^0x[a-fA-F0-9]{64}$/.test(hash);
}
/**
 * Extract error message from various error types
 */
function extractErrorMessage(error) {
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
function createTimeout(promise, timeoutMs) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
}
/**
 * Convert timestamp to human readable format
 */
function formatTimestamp(timestamp) {
    return new Date(timestamp * 1000).toISOString();
}
/**
 * Check if a timestamp is expired
 */
function isExpired(timestamp) {
    return timestamp < Math.floor(Date.now() / 1000);
}
//# sourceMappingURL=utils.js.map