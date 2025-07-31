// Token mapping from local deployment addresses to mainnet addresses
// Used for price fetching from 1inch API

import {
  ONEINCH_TOKEN_ADDRESS,
  USDC_ADDRESS,
  USDC_APTOS_ADDRESS,
} from "../../config/env";

export interface TokenMapping {
  localAddress: string;
  mainnetAddress: string;
  symbol: string;
  name: string;
  decimals: number;
}

export const TOKEN_MAPPINGS: TokenMapping[] = [
  // 1INCH Token (EVM)
  {
    localAddress: ONEINCH_TOKEN_ADDRESS,
    mainnetAddress: "0x111111111117dc0aa78b770fa6a738034120c302", // Real 1INCH mainnet
    symbol: "1INCH",
    name: "1inch Token",
    decimals: 18,
  },
  // USDC Token (EVM)
  {
    localAddress: USDC_ADDRESS,
    mainnetAddress: "0xA0b86a33E6441446414C632C6ab3b73bD3Cc6F22", // Real USDC mainnet
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
  // USDC on Aptos
  {
    localAddress: USDC_APTOS_ADDRESS,
    mainnetAddress:
      "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b", // Aptos USDC mainnet
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
];

// Helper function to get mainnet address from local address
export function getMainnetAddress(localAddress: string): string | null {
  const mapping = TOKEN_MAPPINGS.find(
    (token) => token.localAddress.toLowerCase() === localAddress.toLowerCase()
  );
  return mapping?.mainnetAddress || null;
}

// Helper function to get token info by local address
export function getTokenInfo(localAddress: string): TokenMapping | null {
  return (
    TOKEN_MAPPINGS.find(
      (token) => token.localAddress.toLowerCase() === localAddress.toLowerCase()
    ) || null
  );
}

// Helper function to get token info by mainnet address
export function getTokenInfoByMainnet(
  mainnetAddress: string
): TokenMapping | null {
  return (
    TOKEN_MAPPINGS.find(
      (token) =>
        token.mainnetAddress.toLowerCase() === mainnetAddress.toLowerCase()
    ) || null
  );
}

// Get all supported tokens
export function getAllTokens(): TokenMapping[] {
  return TOKEN_MAPPINGS;
}
