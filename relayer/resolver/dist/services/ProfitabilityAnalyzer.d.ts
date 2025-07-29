/**
 * Profitability Analyzer Service
 * Implements Phase 1 step 1-2 from resolver_both_phases.md:
 * - Fetch 1inch quotes
 * - Calculate net profit
 */
import { FusionPlusOrder, ProfitabilityAnalysis, ResolverConfig } from "../types";
export declare class ProfitabilityAnalyzer {
    private config;
    private logger;
    constructor(config: ResolverConfig);
    /**
     * Analyze profitability of a Fusion+ order
     */
    analyzeProfitability(fusionOrder: FusionPlusOrder): Promise<ProfitabilityAnalysis>;
    /**
     * Fetch quote from 1inch API
     */
    private fetch1inchQuote;
    /**
     * Calculate various costs involved in the trade
     */
    private calculateCosts;
    /**
     * Estimate EVM gas costs
     */
    private estimateEvmGasCost;
    /**
     * Estimate Aptos gas costs
     */
    private estimateAptosGasCost;
    /**
     * Map our chain IDs to 1inch API chain IDs
     */
    private mapToOneInchChainId;
    /**
     * Check if current market conditions are favorable
     */
    checkMarketConditions(): Promise<{
        favorable: boolean;
        gasPrice?: number;
        congestion?: string;
    }>;
}
//# sourceMappingURL=ProfitabilityAnalyzer.d.ts.map