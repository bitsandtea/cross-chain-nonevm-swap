// Token mapping from local deployment addresses to mainnet addresses
// Used for price fetching from 1inch API

export interface TokenMapping {
  localAddress: string;
  mainnetAddress: string;
  symbol: string;
  name: string;
  decimals: number;
}

export const TOKEN_MAPPINGS: TokenMapping[] = [
  // 1INCH Token
  {
    localAddress:
      process.env.NEXT_PUBLIC_ONEINCH_TOKEN_ADDRESS ||
      (() => {
        throw new Error(
          "NEXT_PUBLIC_ONEINCH_TOKEN_ADDRESS environment variable is required"
        );
      })(),
    mainnetAddress: "0x111111111117dc0aa78b770fa6a738034120c302", // Real 1INCH mainnet
    symbol: "1INCH",
    name: "1inch Token",
    decimals: 18,
  },
  // USDC Token
  {
    localAddress:
      process.env.NEXT_PUBLIC_USDC_ADDRESS ||
      (() => {
        throw new Error(
          "NEXT_PUBLIC_USDC_ADDRESS environment variable is required"
        );
      })(),
    mainnetAddress: "0xA0b86a33E6441446414C632C6ab3b73bD3Cc6F22", // Real USDC mainnet
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
  // AAVE Token
  {
    localAddress:
      process.env.NEXT_PUBLIC_AAVE_TOKEN_ADDRESS ||
      (() => {
        throw new Error(
          "NEXT_PUBLIC_AAVE_TOKEN_ADDRESS environment variable is required"
        );
      })(),
    mainnetAddress: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", // Real AAVE mainnet
    symbol: "AAVE",
    name: "Aave Token",
    decimals: 18,
  },
  // WETH Token
  {
    localAddress:
      process.env.NEXT_PUBLIC_WETH_ADDRESS ||
      (() => {
        throw new Error(
          "NEXT_PUBLIC_WETH_ADDRESS environment variable is required"
        );
      })(),
    mainnetAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // Real WETH mainnet
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
  },
  // UNI Token
  {
    localAddress:
      process.env.NEXT_PUBLIC_UNI_TOKEN_ADDRESS ||
      (() => {
        throw new Error(
          "NEXT_PUBLIC_UNI_TOKEN_ADDRESS environment variable is required"
        );
      })(),
    mainnetAddress: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", // Real UNI mainnet
    symbol: "UNI",
    name: "Uniswap Token",
    decimals: 18,
  },

  // USDC on Aptos
  {
    localAddress:
      process.env.NEXT_PUBLIC_USDC_APTOS_ADDRESS ||
      (() => {
        throw new Error(
          "NEXT_PUBLIC_USDC_APTOS_ADDRESS environment variable is required"
        );
      })(),
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
