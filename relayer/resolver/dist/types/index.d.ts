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
    evmPrivateKey: string;
    aptosPrivateKey: string;
    evmRpcUrl: string;
    aptosRpcUrl: string;
    minEvmBalance: string;
    minAptosBalance: string;
    minProfitThreshold: string;
    oneInchApiKey: string;
    oneInchApiUrl: string;
    gasBuffer: number;
    maxGasPriceGwei: number;
    relayerApiUrl: string;
    pollIntervalMs: number;
    maxConcurrentOrders: number;
    healthCheckIntervalMs: number;
}
/**
 * Intent from the relayer API
 */
export interface Intent {
    id: string;
    fusionOrder: FusionPlusOrder;
    signature: string;
    nonce: number;
    status: "pending" | "processing" | "completed" | "failed" | "cancelled";
    createdAt: number;
    updatedAt: number;
}
/**
 * Profitability analysis result
 */
export interface ProfitabilityAnalysis {
    profitable: boolean;
    expectedProfit: string;
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
    blockTime: number;
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
//# sourceMappingURL=index.d.ts.map