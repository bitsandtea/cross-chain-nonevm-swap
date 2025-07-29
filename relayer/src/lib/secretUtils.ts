import { uint8ArrayToHex } from "@1inch/byte-utils";
import { HashLock } from "@1inch/cross-chain-sdk";
import { ethers } from "ethers";

/**
 * Secret management utilities for atomic swaps
 */

/**
 * Generate a cryptographically secure 256-bit secret using 1inch SDK patterns
 */
export function generateSecret(): string {
  return uint8ArrayToHex(ethers.randomBytes(32));
}

/**
 * Generate SHA256/Keccak256 hash of a secret using 1inch SDK
 */
export function hashSecret(secret: string): string {
  return HashLock.hashSecret(secret);
}

/**
 * Validate secret format (32 bytes hex)
 */
export function validateSecretFormat(secret: string): {
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
 * Verify that a secret matches the expected hash
 */
export function verifySecretHash(
  secret: string,
  expectedHash: string
): {
  valid: boolean;
  error?: string;
} {
  const formatValidation = validateSecretFormat(secret);
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
 * Generate multiple partial secrets from a master secret for partial fills
 */
export function generatePartialSecrets(
  masterSecret: string,
  count: number
): string[] {
  const formatValidation = validateSecretFormat(masterSecret);
  if (!formatValidation.valid) {
    throw new Error(`Invalid master secret format: ${formatValidation.error}`);
  }

  const partialSecrets: string[] = [];

  for (let i = 0; i < count; i++) {
    // Derive partial secret by combining master secret with index
    const indexBytes = new Uint8Array(4);
    const view = new DataView(indexBytes.buffer);
    view.setUint32(0, i, false); // big-endian

    const combined = ethers.concat([ethers.getBytes(masterSecret), indexBytes]);

    // Hash the combination to get a new 32-byte secret
    const partialSecret = ethers.keccak256(combined);
    partialSecrets.push(partialSecret);
  }

  return partialSecrets;
}

/**
 * Secret sharing placeholder for relayer communication
 * This is a basic implementation - in production, use proper secret sharing schemes
 */
export interface SecretShare {
  id: string;
  threshold: number;
  totalShares: number;
  shareIndex: number;
  encryptedShare: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Create encrypted secret shares for relayer coordination
 * Note: This is a placeholder implementation for the framework
 */
export function createSecretShares(
  secret: string,
  relayerPublicKeys: string[],
  threshold: number = 2
): SecretShare[] {
  // Validate inputs
  const formatValidation = validateSecretFormat(secret);
  if (!formatValidation.valid) {
    throw new Error(`Invalid secret format: ${formatValidation.error}`);
  }

  if (threshold > relayerPublicKeys.length) {
    throw new Error("Threshold cannot be greater than number of relayers");
  }

  const shareId = ethers.hexlify(ethers.randomBytes(16));
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 3600; // 1 hour expiration

  // Create shares (simplified version)
  const shares: SecretShare[] = relayerPublicKeys.map((publicKey, index) => ({
    id: shareId,
    threshold,
    totalShares: relayerPublicKeys.length,
    shareIndex: index + 1,
    encryptedShare: (() => {
      const indexBytes = new Uint8Array(4);
      const view = new DataView(indexBytes.buffer);
      view.setUint32(0, index, false); // big-endian

      return ethers.keccak256(
        ethers.concat([
          ethers.getBytes(secret),
          ethers.getBytes(publicKey),
          indexBytes,
        ])
      );
    })(), // Simplified encryption - use proper encryption in production
    createdAt: now,
    expiresAt: expiration,
  }));

  return shares;
}

/**
 * Reconstruct secret from shares (placeholder implementation)
 */
export function reconstructSecretFromShares(shares: SecretShare[]): {
  success: boolean;
  secret?: string;
  error?: string;
} {
  if (shares.length === 0) {
    return { success: false, error: "No shares provided" };
  }

  const firstShare = shares[0];
  if (shares.length < firstShare.threshold) {
    return {
      success: false,
      error: `Insufficient shares: need ${firstShare.threshold}, got ${shares.length}`,
    };
  }

  // Check share validity
  const now = Math.floor(Date.now() / 1000);
  for (const share of shares) {
    if (share.expiresAt < now) {
      return { success: false, error: "One or more shares have expired" };
    }
    if (share.id !== firstShare.id) {
      return { success: false, error: "Share IDs do not match" };
    }
  }

  // Placeholder reconstruction - implement proper secret sharing algorithm
  // For now, just return a derived secret based on share combination
  const combinedData = ethers.concat(
    shares
      .slice(0, firstShare.threshold)
      .map((share) => ethers.getBytes(share.encryptedShare))
  );

  const reconstructedSecret = ethers.keccak256(combinedData);

  return { success: true, secret: reconstructedSecret };
}

/**
 * Utility to store secrets client-side (for client applications)
 */
export interface ClientSecretStorage {
  intentId: string;
  secret: string;
  secretHash: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Create client-side secret storage object
 */
export function createClientSecretStorage(
  intentId: string,
  secret: string,
  expirationSeconds: number = 86400 // 24 hours default
): ClientSecretStorage {
  const formatValidation = validateSecretFormat(secret);
  if (!formatValidation.valid) {
    throw new Error(`Invalid secret format: ${formatValidation.error}`);
  }

  const now = Math.floor(Date.now() / 1000);

  return {
    intentId,
    secret,
    secretHash: hashSecret(secret),
    createdAt: now,
    expiresAt: now + expirationSeconds,
  };
}

/**
 * Validate client-side secret storage
 */
export function validateClientSecretStorage(storage: ClientSecretStorage): {
  valid: boolean;
  error?: string;
} {
  const now = Math.floor(Date.now() / 1000);

  if (storage.expiresAt < now) {
    return { valid: false, error: "Secret storage has expired" };
  }

  const hashValidation = verifySecretHash(storage.secret, storage.secretHash);
  if (!hashValidation.valid) {
    return { valid: false, error: "Secret hash validation failed" };
  }

  return { valid: true };
}
