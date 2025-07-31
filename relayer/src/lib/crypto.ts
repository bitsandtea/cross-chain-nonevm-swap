import { randomBytes } from "crypto";
import { keccak256 } from "ethers";

/**
 * Generates a cryptographically secure 32-byte random secret and its keccak256 hash
 * @returns Object containing the secret and its hash
 */
export function generateSecret(): { secret: string; hash: string } {
  const S = "0x" + randomBytes(32).toString("hex");
  const H = keccak256(S as `0x${string}`);
  return { secret: S, hash: H };
}

/**
 * Generates multiple secrets for partial fills and creates Merkle tree
 * @param n Number of secrets to generate (default 4 for 25%, 50%, 75%, 100% fills)
 * @returns Object containing secrets, hashes, merkle root, and tree structure
 */
export function generateSecrets(n: number = 4): {
  secrets: string[];
  hashes: string[];
  merkleRoot: string;
  tree: { leaves: string[]; root: string };
} {
  const secrets: string[] = [];
  const hashes: string[] = [];

  // Generate the required number of secrets
  for (let i = 0; i < n; i++) {
    const { secret, hash } = generateSecret();
    secrets.push(secret);
    hashes.push(hash);
  }

  // Build simple Merkle tree from hashes
  const tree = buildMerkleTree(hashes);

  return {
    secrets,
    hashes,
    merkleRoot: tree.root,
    tree,
  };
}

/**
 * Simple Merkle tree implementation for partial fill secrets
 * @param leaves Array of hash values to build tree from
 * @returns Tree structure with leaves and root
 */
function buildMerkleTree(leaves: string[]): { leaves: string[]; root: string } {
  if (leaves.length === 0) return { leaves: [], root: "0x" };
  if (leaves.length === 1) return { leaves, root: leaves[0] };

  let currentLevel = [...leaves];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1] || left; // Duplicate if odd number
      const combined = keccak256(left + right.slice(2)); // Remove 0x from right
      nextLevel.push(combined);
    }

    currentLevel = nextLevel;
  }

  return {
    leaves,
    root: currentLevel[0],
  };
}

/**
 * Storage key prefix for secrets in sessionStorage
 */
export const SECRET_STORAGE_PREFIX = "fusion_secret_";

/**
 * Store secret in sessionStorage keyed by order hash
 */
export function storeSecret(orderHash: string, secret: string): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(SECRET_STORAGE_PREFIX + orderHash, secret);
  }
}

/**
 * Retrieve secret from sessionStorage by order hash
 */
export function retrieveSecret(orderHash: string): string | null {
  if (typeof window !== "undefined") {
    return sessionStorage.getItem(SECRET_STORAGE_PREFIX + orderHash);
  }
  return null;
}

/**
 * Remove secret from sessionStorage
 */
export function clearSecret(orderHash: string): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(SECRET_STORAGE_PREFIX + orderHash);
  }
}
