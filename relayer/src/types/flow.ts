import {
  AuctionDetails,
  EvmAddress,
  HashLock,
  TimeLocks,
} from "@1inch/cross-chain-sdk";

// Flow steps
export enum FlowStep {
  FORM = "form",
  CHECKING_ALLOWANCE = "checking_allowance",
  NEEDS_APPROVAL = "needs_approval",
  APPROVING = "approving",
  READY_TO_SIGN = "ready_to_sign",
  SIGNING = "signing",
}

export interface FormData {
  chainIn: number;
  chainOut: number;
  sellToken: string;
  sellAmount: string;
  buyToken: string;
  minBuyAmount: string;
  deadline: string;
  // Dutch auction parameters
  auctionType: "fixed" | "dutch";
  startPricePremium: string; // Percentage above market price (e.g., "10" for 10%)
  minPriceDiscount: string; // Percentage below market price (e.g., "5" for 5%)
  decayRate: string;
  decayPeriod: string;
  auctionStartDelay?: string; // Delay before auction starts (in seconds)
  // Escrow targets (optional, defaults to user address)
  srcEscrowTarget?: string;
  dstEscrowTarget?: string;
  // NEW: User-specified destination address for cross-chain swaps
  destinationAddress?: string;
  // Safety deposits (optional, uses defaults)
  srcSafetyDeposit?: string;
  dstSafetyDeposit?: string;
  // Cross-chain order secrets and parameters
  secret?: string;
  secretHash?: string;
  nonce?: bigint;
  partialFillAllowed?: boolean;
  multipleFillsAllowed?: boolean;
  // NonEVM destination metadata (for Aptos, etc.)
  aptosChainId?: number; // Aptos chain ID (e.g., 32 for mainnet, 48 for testnet)
  aptosCoinType?: string; // Full Move coin type (e.g., "0x1::coin::USDC")
  aptosReceiver?: string; // Aptos receiver address (32-byte hex)
}

export interface FlowState {
  currentStep: FlowStep;
  allowanceState: {
    currentAllowance: bigint;
    requiredAmount: bigint;
    hasEnoughAllowance: boolean;
    isLoading: boolean;
    error?: string;
  };
  approvalTxHash: string;
  loading: boolean;
}

// Type definitions for the 1inch SDK
export type CrossChainOrderInfo = {
  makerAsset: EvmAddress;
  takerAsset: EvmAddress;
  makingAmount: bigint;
  takingAmount: bigint;
  maker: EvmAddress;
  receiver?: EvmAddress;
  salt?: bigint;
};

export type EscrowParams = {
  hashLock: HashLock;
  srcChainId: any; // Use any for now to match SDK expectations
  dstChainId: any; // Use any for now to match SDK expectations
  srcSafetyDeposit: bigint;
  dstSafetyDeposit: bigint;
  timeLocks: TimeLocks;
};

export type Details = {
  auction: AuctionDetails;
  fees?: {
    integratorFee?: any;
    bankFee?: bigint;
  };
  whitelist: any[];
  resolvingStartTime?: bigint;
};

export type Extra = {
  nonce?: bigint;
  permit?: string;
  orderExpirationDelay?: bigint;
  enablePermit2?: boolean;
  source?: string;
  allowMultipleFills?: boolean;
  allowPartialFills?: boolean;
};
