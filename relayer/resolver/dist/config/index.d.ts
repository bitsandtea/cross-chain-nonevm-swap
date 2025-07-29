import { ResolverConfig } from "../types";
/**
 * Load resolver configuration from environment variables
 */
export declare function loadResolverConfig(): ResolverConfig;
/**
 * Validate private key format
 */
export declare function validatePrivateKey(key: string, type: "evm" | "aptos"): boolean;
/**
 * Chain configurations
 */
export declare const CHAIN_CONFIGS: {
    readonly 1: {
        readonly chainId: 1;
        readonly name: "Ethereum";
        readonly rpcUrl: string;
        readonly escrowFactoryAddress: "0x0000000000000000000000000000000000000000";
        readonly nativeTokenSymbol: "ETH";
        readonly blockTime: 12;
    };
    readonly 1000: {
        readonly chainId: 1000;
        readonly name: "Aptos";
        readonly rpcUrl: string;
        readonly escrowFactoryAddress: "0x0000000000000000000000000000000000000000";
        readonly nativeTokenSymbol: "APT";
        readonly blockTime: 1;
    };
};
/**
 * Get chain configuration by ID
 */
export declare function getChainConfig(chainId: number): {
    readonly chainId: 1;
    readonly name: "Ethereum";
    readonly rpcUrl: string;
    readonly escrowFactoryAddress: "0x0000000000000000000000000000000000000000";
    readonly nativeTokenSymbol: "ETH";
    readonly blockTime: 12;
} | {
    readonly chainId: 1000;
    readonly name: "Aptos";
    readonly rpcUrl: string;
    readonly escrowFactoryAddress: "0x0000000000000000000000000000000000000000";
    readonly nativeTokenSymbol: "APT";
    readonly blockTime: 1;
};
//# sourceMappingURL=index.d.ts.map