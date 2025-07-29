/**
 * Balance Manager Service
 * Implements Phase 1 step 3 from resolver_both_phases.md:
 * - Check liquidity on both chains
 * - Manage allowances
 * - Monitor balance thresholds
 */
import { BalanceCheck, FusionPlusOrder, ResolverConfig } from "../types";
export declare class BalanceManager {
    private config;
    private logger;
    private evmProvider;
    private aptosClient;
    private evmWallet;
    private aptosPrivateKey;
    constructor(config: ResolverConfig);
    /**
     * Check if resolver has sufficient balance for a Fusion+ order
     */
    checkBalances(fusionOrder: FusionPlusOrder): Promise<BalanceCheck>;
    /**
     * Get EVM balance (ETH)
     */
    getEvmBalance(): Promise<string>;
    /**
     * Get Aptos balance (APT)
     */
    getAptosBalance(): Promise<string>;
    /**
     * Calculate required balances for both chains
     */
    private calculateRequiredBalances;
    /**
     * Check and approve ERC-20 token allowance if needed
     */
    ensureTokenAllowance(tokenAddress: string, spenderAddress: string, amount: string): Promise<{
        success: boolean;
        txHash?: string;
        error?: string;
    }>;
    /**
     * Check if balances are above minimum thresholds
     */
    checkMinimumBalances(): Promise<{
        sufficient: boolean;
        evmSufficient: boolean;
        aptosSufficient: boolean;
        balances: {
            evm: string;
            aptos: string;
        };
    }>;
    /**
     * Get token balance for a specific ERC-20 token
     */
    getTokenBalance(tokenAddress: string): Promise<string>;
    /**
     * Derive Aptos address from private key
     * TODO: Implement proper Aptos address derivation
     */
    private deriveAptosAddress;
    /**
     * Get resolver wallet addresses
     */
    getWalletAddresses(): {
        evm: string;
        aptos: string;
    };
}
//# sourceMappingURL=BalanceManager.d.ts.map