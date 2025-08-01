/**
 * Simple environment configuration
 */

// Browser-safe environment variables (always available)
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "";
export const ETH_FACTORY_ADDRESS =
  process.env.NEXT_PUBLIC_ETH_FACTORY_ADDRESS || "";
export const RESOLVER_ADDRESS = process.env.NEXT_PUBLIC_RESOLVER_ADDRESS || "";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ONEINCH_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_ONEINCH_TOKEN_ADDRESS || "";
export const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS || "";
export const USDC_APTOS_ADDRESS =
  process.env.NEXT_PUBLIC_USDC_APTOS_ADDRESS || "";

export const NEXT_PUBLIC_LOP_ADDRESS =
  process.env.NEXT_PUBLIC_LOP_ADDRESS || "";
// Server-only variables (with fallbacks for browser)
export const CHAIN_ID = process.env.CHAIN_ID || "31337";
export const APTOS_RPC_URL =
  process.env.APTOS_RPC_URL || "https://api.testnet.aptoslabs.com/v1";
