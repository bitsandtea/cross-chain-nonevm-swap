/**
 * Resolver-specific type definitions
 * Simplified for hackathon implementation
 */

/**
 * Basic FusionPlusOrder interface
 */
export interface FusionPlusOrder {
  makerAsset: string;
  takerAsset: string;
  makingAmount: string;
  takingAmount: string;
  maker: string;
  srcChain: number;
  dstChain: number;
  auctionStartTime: number;
  auctionDuration: number;
  startRate: string;
  endRate: string;
  secretHash: string;
  srcEscrowTarget: string;
  dstEscrowTarget: string;
  srcTimelock: number;
  dstTimelock: number;
  finalityLock: number;
  srcSafetyDeposit: string;
  dstSafetyDeposit: string;
  fillThresholds: number[];
  secretTree?: string;
  salt: string;
  expiration: number;
}

/**
 * Resolver configuration interface
 */
export interface ResolverConfig {
  // Private keys
  evmPrivateKey: string;
  aptosPrivateKey: string;

  // Network RPC endpoints
  evmRpcUrl: string;
  aptosRpcUrl: string;

  // Contract addresses
  evmEscrowFactoryAddress: string;
  aptosEscrowFactoryAddress: string;
  resolverContractAddress: string;

  // Liquidity thresholds
  minEvmBalance: string;
  minAptosBalance: string;
  minProfitThreshold: string;

  // 1inch API configuration
  oneInchApiKey: string;
  oneInchApiUrl: string;

  // Gas estimation
  gasBuffer: number;
  maxGasPriceGwei: number;

  // Relayer API
  relayerApiUrl: string;
  resolverApiKey: string; // API key for authenticating with relayer

  // Monitoring
  pollIntervalMs: number;
  maxConcurrentOrders: number;
  healthCheckIntervalMs: number;
}

/**
 * Intent from the relayer API
 */
export interface SdkOrder {
  maker: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: string;
  takingAmount: string;
  salt: string;
  receiver: string;
  makerTraits: string;
}

export interface Intent {
  id: string;
  orderHash: string;
  order: SdkOrder;
  signature: string;
  status:
    | "pending"
    | "open"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled";
  createdAt: number;
  updatedAt: number;
  resolverClaims: any[];
  secretHash: string;
  srcChain: number;
  dstChain: number;
  auctionStartTime: number;
  auctionDuration: number;
  startRate: string;
  endRate: string;
  finalityLock: number;
  fillThresholds: number[];
  expiration: number;
  srcTimelock: number;
  dstTimelock: number;
  srcSafetyDeposit: string;
  dstSafetyDeposit: string;
  srcEscrowTarget: string;
  dstEscrowTarget: string;
  signedChainId?: number; // The chain ID used when signing the order
  extension?: any; // CrossChainOrder extension data
  sdkOrderEncoded?: string; // Encoded SDK order as single source-of-truth (PassTheOrder.md strategy)

  // Additional timelock fields
  srcWithdrawal?: number;
  srcPublicWithdrawal?: number;
  srcCancellation?: number;
  srcPublicCancellation?: number;
  dstWithdrawal?: number;
  dstPublicWithdrawal?: number;
  dstCancellation?: number;
}

/**
 * Profitability analysis result
 */
export interface ProfitabilityAnalysis {
  profitable: boolean;
  expectedProfit: string; // in ETH equivalent
  costs: {
    gasEstimate: string;
    safetyDeposit: string;
    bridgeCosts?: string;
  };
  quote: {
    fromAmount: string;
    toAmount: string;
    price: string;
    protocols: string[];
  };
  error?: string;
}

/**
 * Balance check result
 */
export interface BalanceCheck {
  sufficient: boolean;
  evmBalance: string;
  aptosBalance: string;
  requiredEvm: string;
  requiredAptos: string;
  error?: string;
}

/**
 * Escrow creation result
 */
export interface EscrowCreationResult {
  success: boolean;
  txHash?: string;
  escrowAddress?: string;
  error?: string;
  gasUsed?: string;
  gasPrice?: string;
}

/**
 * Order execution context
 */
export interface OrderExecutionContext {
  intent: Intent;
  profitability: ProfitabilityAnalysis;
  balanceCheck: BalanceCheck;
  orderHash: string;
  secret: string;
  secretHash: string;
}

/**
 * Chain configuration
 */
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  escrowFactoryAddress: string;
  nativeTokenSymbol: string;
  blockTime: number; // in seconds
}

/**
 * Resolver metrics for monitoring
 */
export interface ResolverMetrics {
  totalOrdersProcessed: number;
  successfulOrders: number;
  failedOrders: number;
  totalProfitEarned: string;
  averageProcessingTime: number;
  currentBalance: {
    evm: string;
    aptos: string;
  };
  lastUpdateTime: number;
}

/**
 * Health check status
 */
export interface HealthStatus {
  healthy: boolean;
  checks: {
    evmConnection: boolean;
    aptosConnection: boolean;
    relayerConnection: boolean;
    balanceSufficient: boolean;
    privateKeysValid: boolean;
  };
  lastCheck: number;
  error?: string;
}

/**
 * Event emitted when order is processed
 */
export interface OrderProcessedEvent {
  intentId: string;
  success: boolean;
  profit?: string;
  txHashes: {
    evmEscrow?: string;
    aptosEscrow?: string;
    evmWithdraw?: string;
    aptosWithdraw?: string;
  };
  processingTime: number;
  error?: string;
}

/**
 * Escrow immutables structure matching on-chain format
 */
export interface EscrowImmutables {
  orderHash: string;
  maker: string;
  taker: string;
  token: string;
  amount: bigint;
  hashLock: string;
  safetyDeposit: bigint;
  timelocks: string; // bytes32 encoded
}

/**
 * Secret data from relayer
 */
export interface SecretData {
  orderHash: string;
  secret: string;
  intentId: string;
  action: string;
  timestamp?: number;
}
