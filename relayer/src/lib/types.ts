export interface SecretData {
  orderHash: string;
  timestamp: number;
  action: "secret_shared";
  processed: boolean;
}

export interface IntentDB {
  intents: FusionPlusIntent[];
  whitelist: string[];
  nonces: Record<string, number>;
  secrets: SecretData[];
}

// Fusion+ Order Structure Interface (now the primary order type)
export interface FusionPlusOrder {
  // Core swap parameters
  makerAsset: string; // Token address being sold
  takerAsset: string; // Token address being bought
  makingAmount: string; // Amount being sold (in wei/smallest unit)
  takingAmount: string; // Amount being bought (in wei/smallest unit)
  maker: string; // Address of the order maker

  // Cross-chain parameters
  srcChain: number; // Source chain ID
  dstChain: number; // Destination chain ID

  // Dutch auction configuration
  auctionStartTime: number; // Auction start timestamp
  auctionDuration: number; // Duration in seconds
  startRate: string; // Initial price rate (in USD per unit)
  endRate: string; // Final price rate (in USD per unit)

  // Secret and escrow parameters
  secretHash: string; // Hash of the secret for atomic swap
  srcEscrowTarget: string; // Source chain escrow withdrawal address
  dstEscrowTarget: string; // Destination chain escrow withdrawal address

  // Timelock configuration
  srcTimelock: number; // Source chain timelock in seconds
  dstTimelock: number; // Destination chain timelock in seconds
  finalityLock: number; // Chain reorganization protection in seconds

  // Safety deposit requirements
  srcSafetyDeposit: string; // Required safety deposit on source chain
  dstSafetyDeposit: string; // Required safety deposit on destination chain

  // Partial fill support
  fillThresholds: number[]; // Fill percentage thresholds [25, 50, 75, 100]
  secretTree?: string; // Merkle tree root of partial secrets

  // Order metadata
  salt: string; // Random salt for order uniqueness
  expiration: number; // Order expiration timestamp
}

export interface ResolverClaim {
  resolver: string; // Resolver address
  intentId: string; // Intent ID being claimed
  claimTime: number; // Timestamp of claim
  srcTxHash?: string; // Source chain transaction hash
  dstTxHash?: string; // Destination chain transaction hash
  status: "pending" | "completed" | "failed";
}

// New simplified Intent structure (Fusion+ only)
export interface FusionPlusIntent {
  id: string;
  fusionOrder: FusionPlusOrder;
  signature: string;
  status:
    | "pending" // Phase 1: Announcement - Dutch auction active
    | "processing" // Phase 2: Deposit - Resolver working on escrows
    | "escrow_src_created" // Phase 2: Source chain escrow created
    | "escrow_dst_created" // Phase 2: Destination chain escrow created
    | "secret_revealed" // Phase 3: Withdrawal - Secret shared with resolvers
    | "completed" // Phase 3: Successfully executed (filled)
    | "filled" // Legacy alias for completed
    | "failed" // Execution failed during any phase
    | "cancelled" // User cancelled or resolver cancelled
    | "expired"; // Phase 4: Recovery - Timelock expired
  createdAt: number;
  updatedAt: number;
  resolverClaims: ResolverClaim[];
  nonce: number; // Moved from fusionOrder to intent level for signature
  // Fusion+ protocol metadata
  phase?: 1 | 2 | 3 | 4; // Current protocol phase
  escrowSrcTxHash?: string; // Source chain escrow transaction
  escrowDstTxHash?: string; // Destination chain escrow transaction
  secretHash?: string; // Hash of the secret for this order
  secret?: string; // The actual secret (revealed when ready)
  secretRevealedAt?: number; // Timestamp when secret was revealed
  withdrawalTxHash?: string; // Final withdrawal transaction
  failureReason?: string; // Reason for failure if status is "failed"
  metadata?: Record<string, unknown>; // Additional resolver metadata
}

export interface FusionPlusIntentRequest {
  fusionOrder: FusionPlusOrder;
  sdkOrder: any; // 1inch SDK CrossChainOrder instance
  nonce: number;
  signature: string;
  secret: string; // The actual secret for atomic swap
}

export interface CancelRequest {
  signature: string;
}

export interface AuctionPriceCurve {
  intentId: string;
  startPrice: number;
  currentPrice: number;
  minPrice: number;
  decayRate: number;
  decayPeriod: number;
  startTime: number;
  lastUpdated: number;
}

export interface CurrentAuctionPrice {
  intentId: string;
  originalStartPrice: number;
  currentPrice: number;
  minPrice: number;
  timeElapsed: number;
  isActive: boolean;
}

export const DOMAIN = {
  name: "CrossChainFusionPlus",
  version: "1",
  chainId: 1,
  verifyingContract:
    process.env.ZERO_ADDRESS || "0x0000000000000000000000000000000000000000",
};

export const FUSION_ORDER_TYPE = {
  FusionPlusOrder: [
    { name: "makerAsset", type: "string" },
    { name: "takerAsset", type: "string" },
    { name: "makingAmount", type: "uint256" },
    { name: "takingAmount", type: "uint256" },
    { name: "maker", type: "string" },
    { name: "srcChain", type: "uint256" },
    { name: "dstChain", type: "uint256" },
    { name: "auctionStartTime", type: "uint256" },
    { name: "auctionDuration", type: "uint256" },
    { name: "startRate", type: "string" },
    { name: "endRate", type: "string" },
    { name: "secretHash", type: "string" },
    { name: "srcEscrowTarget", type: "string" },
    { name: "dstEscrowTarget", type: "string" },
    { name: "srcTimelock", type: "uint256" },
    { name: "dstTimelock", type: "uint256" },
    { name: "finalityLock", type: "uint256" },
    { name: "srcSafetyDeposit", type: "uint256" },
    { name: "dstSafetyDeposit", type: "uint256" },
    { name: "fillThresholds", type: "uint256[]" },
    { name: "salt", type: "string" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

export const CANCEL_TYPE = {
  Cancel: [
    { name: "intentId", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
};
