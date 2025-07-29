import { ethers } from "ethers";
import {
  generatePartialSecrets,
  hashSecret,
  validateSecretFormat,
} from "./secretUtils";

/**
 * Merkle tree utilities for partial fill support
 */

export interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
}

export interface MerkleProof {
  leaf: string;
  proof: string[];
  indices: number[];
}

export interface PartialFillTree {
  root: string;
  leaves: string[];
  tree: MerkleNode;
  fillThresholds: number[];
}

/**
 * Build Merkle tree from partial secrets based on fill thresholds
 */
export function buildPartialFillTree(
  masterSecret: string,
  fillThresholds: number[] = [25, 50, 75, 100]
): PartialFillTree {
  // Validate master secret
  const validation = validateSecretFormat(masterSecret);
  if (!validation.valid) {
    throw new Error(`Invalid master secret: ${validation.error}`);
  }

  // Sort thresholds and ensure 100% is included
  const sortedThresholds = [...new Set(fillThresholds)].sort((a, b) => a - b);
  if (sortedThresholds[sortedThresholds.length - 1] !== 100) {
    sortedThresholds.push(100);
  }

  // Generate partial secrets for each threshold
  const partialSecrets = generatePartialSecrets(
    masterSecret,
    sortedThresholds.length
  );

  // Hash the partial secrets to create leaves
  const leaves = partialSecrets.map((secret) => hashSecret(secret));

  // Build Merkle tree
  const tree = buildMerkleTree(leaves);
  const root = tree.hash;

  return {
    root,
    leaves,
    tree,
    fillThresholds: sortedThresholds,
  };
}

/**
 * Build Merkle tree from an array of leaf hashes
 */
export function buildMerkleTree(leaves: string[]): MerkleNode {
  if (leaves.length === 0) {
    throw new Error("Cannot build tree with no leaves");
  }

  // Create leaf nodes
  let currentLevel: MerkleNode[] = leaves.map((leaf) => ({ hash: leaf }));

  // Build tree bottom-up
  while (currentLevel.length > 1) {
    const nextLevel: MerkleNode[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left; // Duplicate last node if odd count

      const combinedHash = ethers.keccak256(
        ethers.concat([ethers.getBytes(left.hash), ethers.getBytes(right.hash)])
      );

      nextLevel.push({
        hash: combinedHash,
        left,
        right: right !== left ? right : undefined,
      });
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0];
}

/**
 * Generate Merkle proof for a specific leaf
 */
export function generateMerkleProof(
  tree: MerkleNode,
  targetLeaf: string
): MerkleProof | null {
  const proof: string[] = [];
  const indices: number[] = [];

  function findLeafAndGenerateProof(
    node: MerkleNode,
    target: string,
    isLeft: boolean,
    index: number
  ): boolean {
    // Base case: leaf node
    if (!node.left && !node.right) {
      return node.hash === target;
    }

    // Search left subtree
    if (
      node.left &&
      findLeafAndGenerateProof(node.left, target, true, index * 2)
    ) {
      if (node.right) {
        proof.push(node.right.hash);
        indices.push(isLeft ? 1 : 0); // 1 if sibling is on right, 0 if on left
      }
      return true;
    }

    // Search right subtree
    if (
      node.right &&
      findLeafAndGenerateProof(node.right, target, false, index * 2 + 1)
    ) {
      if (node.left) {
        proof.push(node.left.hash);
        indices.push(isLeft ? 0 : 1);
      }
      return true;
    }

    return false;
  }

  const found = findLeafAndGenerateProof(tree, targetLeaf, true, 0);

  if (!found) {
    return null;
  }

  return {
    leaf: targetLeaf,
    proof: proof.reverse(), // Reverse to get proof from leaf to root
    indices: indices.reverse(),
  };
}

/**
 * Verify Merkle proof
 */
export function verifyMerkleProof(
  proof: MerkleProof,
  expectedRoot: string
): boolean {
  try {
    let computedHash = proof.leaf;

    for (let i = 0; i < proof.proof.length; i++) {
      const siblingHash = proof.proof[i];
      const isRightSibling = proof.indices[i] === 1;

      if (isRightSibling) {
        // Sibling is on the right
        computedHash = ethers.keccak256(
          ethers.concat([
            ethers.getBytes(computedHash),
            ethers.getBytes(siblingHash),
          ])
        );
      } else {
        // Sibling is on the left
        computedHash = ethers.keccak256(
          ethers.concat([
            ethers.getBytes(siblingHash),
            ethers.getBytes(computedHash),
          ])
        );
      }
    }

    return computedHash === expectedRoot;
  } catch (error) {
    return false;
  }
}

/**
 * Get partial secret for a specific fill percentage
 */
export function getPartialSecretForFill(
  masterSecret: string,
  fillPercentage: number,
  fillThresholds: number[] = [25, 50, 75, 100]
): {
  secret: string;
  secretHash: string;
  thresholdIndex: number;
} | null {
  // Find the appropriate threshold
  const sortedThresholds = [...fillThresholds].sort((a, b) => a - b);
  const thresholdIndex = sortedThresholds.findIndex(
    (threshold) => threshold >= fillPercentage
  );

  if (thresholdIndex === -1) {
    return null; // Fill percentage exceeds maximum threshold
  }

  // Generate partial secrets
  const partialSecrets = generatePartialSecrets(
    masterSecret,
    sortedThresholds.length
  );
  const selectedSecret = partialSecrets[thresholdIndex];

  return {
    secret: selectedSecret,
    secretHash: hashSecret(selectedSecret),
    thresholdIndex,
  };
}

/**
 * Validate partial fill tree structure
 */
export function validatePartialFillTree(tree: PartialFillTree): {
  valid: boolean;
  error?: string;
} {
  // Check fill thresholds
  if (!Array.isArray(tree.fillThresholds) || tree.fillThresholds.length === 0) {
    return { valid: false, error: "Fill thresholds must be a non-empty array" };
  }

  const sortedThresholds = [...tree.fillThresholds].sort((a, b) => a - b);
  if (sortedThresholds[sortedThresholds.length - 1] !== 100) {
    return { valid: false, error: "Fill thresholds must include 100%" };
  }

  // Check leaves count matches thresholds
  if (tree.leaves.length !== tree.fillThresholds.length) {
    return {
      valid: false,
      error: "Number of leaves must match number of fill thresholds",
    };
  }

  // Validate leaf hashes format
  for (const leaf of tree.leaves) {
    if (!leaf.startsWith("0x") || leaf.length !== 66) {
      return { valid: false, error: "Invalid leaf hash format" };
    }
  }

  // Validate root hash format
  if (!tree.root.startsWith("0x") || tree.root.length !== 66) {
    return { valid: false, error: "Invalid root hash format" };
  }

  // Verify tree integrity by rebuilding
  try {
    const rebuiltTree = buildMerkleTree(tree.leaves);
    if (rebuiltTree.hash !== tree.root) {
      return { valid: false, error: "Tree root does not match computed root" };
    }
  } catch (error) {
    return { valid: false, error: "Failed to verify tree integrity" };
  }

  return { valid: true };
}

/**
 * Create simplified partial fill proof for specific threshold
 */
export function createPartialFillProof(
  tree: PartialFillTree,
  fillPercentage: number
): {
  threshold: number;
  thresholdIndex: number;
  secretHash: string;
  merkleProof: MerkleProof;
} | null {
  // Find appropriate threshold
  const thresholdIndex = tree.fillThresholds.findIndex(
    (t) => t >= fillPercentage
  );
  if (thresholdIndex === -1) {
    return null;
  }

  const threshold = tree.fillThresholds[thresholdIndex];
  const secretHash = tree.leaves[thresholdIndex];

  // Generate Merkle proof for this leaf
  const merkleProof = generateMerkleProof(tree.tree, secretHash);
  if (!merkleProof) {
    return null;
  }

  return {
    threshold,
    thresholdIndex,
    secretHash,
    merkleProof,
  };
}
