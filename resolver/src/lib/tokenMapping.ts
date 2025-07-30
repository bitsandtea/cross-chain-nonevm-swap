/**
 * Token Address Mapping for 1inch API
 * Maps testnet/local token addresses to their mainnet equivalents
 */

export interface TokenMapping {
  testnetAddress: string;
  mainnetAddress: string;
  symbol: string;
  decimals: number;
  chainId: number;
}

// Token mappings for different chains
export const TOKEN_MAPPINGS: TokenMapping[] = [
  // Ethereum testnet tokens
  {
    testnetAddress: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
    mainnetAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC mainnet
    symbol: "USDC",
    decimals: 6,
    chainId: 1,
  },
  {
    testnetAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    mainnetAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH mainnet
    symbol: "WETH",
    decimals: 18,
    chainId: 1,
  },
  // Aptos tokens
  {
    testnetAddress:
      "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::USDC",
    mainnetAddress:
      "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b", // Aptos USDC mainnet
    symbol: "USDC",
    decimals: 6,
    chainId: 1000,
  },
  {
    testnetAddress: "0x1::aptos_coin::AptosCoin",
    mainnetAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH as APT equivalent
    symbol: "APT",
    decimals: 8,
    chainId: 1000,
  },
];

/**
 * Get mainnet address for a testnet token
 */
export function getMainnetAddress(
  testnetAddress: string,
  chainId: number
): string {
  const mapping = TOKEN_MAPPINGS.find(
    (m) =>
      m.testnetAddress.toLowerCase() === testnetAddress.toLowerCase() &&
      m.chainId === chainId
  );

  if (!mapping) {
    throw new Error(
      `No mainnet mapping found for ${testnetAddress} on chain ${chainId}`
    );
  }

  return mapping.mainnetAddress;
}

/**
 * Get token info for a testnet address
 */
export function getTokenInfo(
  testnetAddress: string,
  chainId: number
): TokenMapping | null {
  return (
    TOKEN_MAPPINGS.find(
      (m) =>
        m.testnetAddress.toLowerCase() === testnetAddress.toLowerCase() &&
        m.chainId === chainId
    ) || null
  );
}

/**
 * Check if a token address is mapped
 */
export function isTokenMapped(
  testnetAddress: string,
  chainId: number
): boolean {
  return TOKEN_MAPPINGS.some(
    (m) =>
      m.testnetAddress.toLowerCase() === testnetAddress.toLowerCase() &&
      m.chainId === chainId
  );
}
