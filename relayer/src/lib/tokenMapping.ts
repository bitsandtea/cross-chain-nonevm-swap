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
      "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    mainnetAddress: "0x111111111117dc0aa78b770fa6a738034120c302", // Real 1INCH mainnet
    symbol: "1INCH",
    name: "1inch Token",
    decimals: 18,
  },
  // USDC Token
  {
    localAddress:
      process.env.NEXT_PUBLIC_USDC_ADDRESS ||
      "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
    mainnetAddress: "0xA0b86a33E6441446414C632C6ab3b73bD3Cc6F22", // Real USDC mainnet
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
  // AAVE Token
  {
    localAddress:
      process.env.NEXT_PUBLIC_AAVE_TOKEN_ADDRESS ||
      "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
    mainnetAddress: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", // Real AAVE mainnet
    symbol: "AAVE",
    name: "Aave Token",
    decimals: 18,
  },
  // WETH Token
  {
    localAddress:
      process.env.NEXT_PUBLIC_WETH_ADDRESS ||
      "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
    mainnetAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // Real WETH mainnet
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
  },
  // UNI Token
  {
    localAddress:
      process.env.NEXT_PUBLIC_UNI_TOKEN_ADDRESS ||
      "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9",
    mainnetAddress: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", // Real UNI mainnet
    symbol: "UNI",
    name: "Uniswap Token",
    decimals: 18,
  },
  // Aptos Coin (APT)
  {
    localAddress:
      process.env.NEXT_PUBLIC_APT_ADDRESS || "0x1::aptos_coin::AptosCoin",
    mainnetAddress: "0x1::aptos_coin::AptosCoin", // Same as local for Aptos mainnet
    symbol: "APT",
    name: "Aptos Coin",
    decimals: 8,
  },
  // USDC on Aptos
  {
    localAddress:
      process.env.NEXT_PUBLIC_USDC_APTOS_ADDRESS ||
      "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::USDC",
    mainnetAddress:
      "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::USDC", // Same as local for Aptos mainnet
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
