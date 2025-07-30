import { config } from "dotenv";
import { ResolverConfig } from "../types";

// Load environment variables
config();

/**
 * Load resolver configuration from environment variables
 */
export function loadResolverConfig(): ResolverConfig {
  const requiredEnvVars = [
    "RESOLVER_EVM_PRIVATE_KEY",
    "RESOLVER_APTOS_PRIVATE_KEY",
    "EVM_RPC_URL",
    "APTOS_RPC_URL",
    "APTOS_RESOLVER_FACTORY_ADDRESS",
    "NEXT_PUBLIC_RESOLVER_ADDRESS",
    "ONEINCH_API_KEY",
    "RELAYER_API_URL",
    "RESOLVER_API_KEY",
  ];

  // Check for required environment variables
  const missing = requiredEnvVars.filter((env) => !process.env[env]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  return {
    // Private keys
    evmPrivateKey: process.env.RESOLVER_EVM_PRIVATE_KEY!,
    aptosPrivateKey: process.env.RESOLVER_APTOS_PRIVATE_KEY!,

    // Network RPC endpoints
    evmRpcUrl: process.env.EVM_RPC_URL!,
    aptosRpcUrl: process.env.APTOS_RPC_URL!,

    // Contract addresses
    evmEscrowFactoryAddress: process.env.NEXT_PUBLIC_ETH_FACTORY_ADDRESS || "",
    aptosEscrowFactoryAddress: process.env.APTOS_RESOLVER_FACTORY_ADDRESS!,
    resolverContractAddress: process.env.NEXT_PUBLIC_RESOLVER_ADDRESS!,

    // Liquidity thresholds
    minEvmBalance: process.env.MIN_EVM_BALANCE || "0.1",
    minAptosBalance: process.env.MIN_APTOS_BALANCE || "1.0",
    minProfitThreshold: process.env.MIN_PROFIT_THRESHOLD || "0.001",

    // 1inch API configuration
    oneInchApiKey: process.env.ONEINCH_API_KEY!,
    oneInchApiUrl: process.env.ONEINCH_API_URL || "https://api.1inch.io/v5.0",

    // Gas estimation
    gasBuffer: parseFloat(process.env.GAS_BUFFER_MULTIPLIER || "1.2"),
    maxGasPriceGwei: parseInt(process.env.MAX_GAS_PRICE_GWEI || "100"),

    // Relayer API
    relayerApiUrl: process.env.RELAYER_API_URL!,
    resolverApiKey: process.env.RESOLVER_API_KEY!,

    // Monitoring
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000"),
    maxConcurrentOrders: parseInt(process.env.MAX_CONCURRENT_ORDERS || "10"),
    healthCheckIntervalMs: parseInt(
      process.env.HEALTH_CHECK_INTERVAL_MS || "30000"
    ),
  };
}

/**
 * Validate private key format
 */
export function validatePrivateKey(
  key: string,
  type: "evm" | "aptos"
): boolean {
  if (type === "evm") {
    return /^0x[a-fA-F0-9]{64}$/.test(key);
  } else {
    return /^[a-fA-F0-9]{64}$/.test(key);
  }
}

/**
 * Chain configurations
 */
export const CHAIN_CONFIGS = {
  1: {
    chainId: 1,
    name: "Ethereum",
    rpcUrl: process.env.EVM_RPC_URL || "",
    escrowFactoryAddress: "0x0000000000000000000000000000000000000000", // TODO: Update with actual address
    nativeTokenSymbol: "ETH",
    blockTime: 12,
  },
  1000: {
    chainId: 1000,
    name: "Aptos",
    rpcUrl: process.env.APTOS_RPC_URL || "",
    escrowFactoryAddress: "0x0000000000000000000000000000000000000000", // TODO: Update with actual address
    nativeTokenSymbol: "APT",
    blockTime: 1,
  },
} as const;

/**
 * Get chain configuration by ID
 */
export function getChainConfig(chainId: number) {
  const config = CHAIN_CONFIGS[chainId as keyof typeof CHAIN_CONFIGS];
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return config;
}
