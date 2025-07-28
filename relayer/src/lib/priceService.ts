// 1inch API price fetching service
// Based on documentation: https://portal.1inch.dev/documentation/apis/spot-price/quick-start

import { getMainnetAddress, getTokenInfo } from "./tokenMapping";

// 1inch API base URL for Ethereum mainnet
const ONEINCH_API_BASE = "https://api.1inch.dev/price/v1.1";
const ETHEREUM_CHAIN_ID = 1;

// Types for 1inch API responses
export interface TokenPrice {
  [tokenAddress: string]: string; // Price in USD
}

export interface PriceResponse {
  [tokenAddress: string]: string;
}

export interface QuoteParams {
  srcToken: string;
  dstToken: string;
  amount: string;
}

export interface QuoteResponse {
  dstAmount: string;
  srcToken: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
  dstToken: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
  protocols: Array<any>;
}

// Mock prices for fallback when API is unavailable
const MOCK_PRICES: Record<string, string> = {
  // 1INCH Token
  "0x111111111117dc0aa78b770fa6a738034120c302": "0.45",
  // USDC
  "0xA0b86a33E6441446414C632C6ab3b73bD3Cc6F22": "1.00",
  // AAVE
  "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": "89.50",
  // WETH
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": "2650.00",
  // UNI
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": "8.75",
  // DAI
  "0x6B175474E89094C44Da98b954EedeAC495271d0F": "1.00",
};

/**
 * Get mock prices for tokens (fallback when API is unavailable)
 */
function getMockPrices(tokenAddresses: string[]): TokenPrice {
  const result: TokenPrice = {};
  tokenAddresses.forEach((address) => {
    result[address] = MOCK_PRICES[address] || "1.00";
  });
  return result;
}

// Get API headers with authorization
function getApiHeaders(): HeadersInit {
  const apiKey = process.env.ONEINCH_API_KEY;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * Fetch current USD prices for multiple tokens
 * @param tokenAddresses Array of token addresses (can be local or mainnet)
 * @returns Promise<TokenPrice> - Object mapping addresses to USD prices
 */
export async function getTokenPrices(
  tokenAddresses: string[]
): Promise<TokenPrice> {
  try {
    // Convert local addresses to mainnet addresses
    const mainnetAddresses = tokenAddresses
      .map((addr) => getMainnetAddress(addr) || addr)
      .filter(Boolean);

    if (mainnetAddresses.length === 0) {
      throw new Error("No valid token addresses provided");
    }

    // Build query parameters
    const params = new URLSearchParams({
      tokens: mainnetAddresses.join(","),
      currency: "USD",
    });

    const response = await fetch(
      `${ONEINCH_API_BASE}/${ETHEREUM_CHAIN_ID}?${params}`,
      {
        method: "GET",
        headers: getApiHeaders(),
      }
    );

    if (!response.ok) {
      // If API fails, log the error and return mock prices
      console.warn(
        `1inch API error: ${response.status} ${response.statusText}, using mock prices`
      );

      // Map mock prices back to original addresses
      const mockResult: TokenPrice = {};
      tokenAddresses.forEach((originalAddr) => {
        const mainnetAddr = getMainnetAddress(originalAddr) || originalAddr;
        mockResult[originalAddr] = MOCK_PRICES[mainnetAddr] || "1.00";
      });

      return mockResult;
    }

    const data: PriceResponse = await response.json();

    // Map back to original addresses if they were local
    const result: TokenPrice = {};
    tokenAddresses.forEach((originalAddr) => {
      const mainnetAddr = getMainnetAddress(originalAddr) || originalAddr;
      if (data[mainnetAddr]) {
        result[originalAddr] = data[mainnetAddr];
      } else {
        // Use mock price if not found in API response
        result[originalAddr] = MOCK_PRICES[mainnetAddr] || "1.00";
      }
    });

    return result;
  } catch (error) {
    console.warn("Error fetching token prices, using mock prices:", error);

    // Return mock prices for all requested tokens
    const mockResult: TokenPrice = {};
    tokenAddresses.forEach((originalAddr) => {
      const mainnetAddr = getMainnetAddress(originalAddr) || originalAddr;
      mockResult[originalAddr] = MOCK_PRICES[mainnetAddr] || "1.00";
    });

    return mockResult;
  }
}

/**
 * Get price for a single token in USD
 * @param tokenAddress Token address (local or mainnet)
 * @returns Promise<string> - Price in USD
 */
export async function getTokenPrice(tokenAddress: string): Promise<string> {
  const prices = await getTokenPrices([tokenAddress]);
  const price = prices[tokenAddress];

  if (!price) {
    throw new Error(`Price not found for token ${tokenAddress}`);
  }

  return price;
}

/**
 * Get a quote for swapping tokens (amount of dstToken for given srcToken amount)
 * @param params Quote parameters
 * @returns Promise<QuoteResponse>
 */
export async function getSwapQuote(
  params: QuoteParams
): Promise<QuoteResponse> {
  try {
    // Convert local addresses to mainnet
    const srcMainnet = getMainnetAddress(params.srcToken) || params.srcToken;
    const dstMainnet = getMainnetAddress(params.dstToken) || params.dstToken;

    const queryParams = new URLSearchParams({
      src: srcMainnet,
      dst: dstMainnet,
      amount: params.amount,
    });

    const response = await fetch(
      `${ONEINCH_API_BASE}/${ETHEREUM_CHAIN_ID}/quote?${queryParams}`,
      {
        method: "GET",
        headers: getApiHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(
        `1inch quote API error: ${response.status} ${response.statusText}`
      );
    }

    const data: QuoteResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching swap quote:", error);
    throw error;
  }
}

/**
 * Calculate USD value of a token amount
 * @param tokenAddress Token address (local or mainnet)
 * @param amount Amount in token's smallest unit (wei for 18 decimals)
 * @returns Promise<number> - USD value
 */
export async function calculateUSDValue(
  tokenAddress: string,
  amount: string
): Promise<number> {
  try {
    const price = await getTokenPrice(tokenAddress);
    const tokenInfo = getTokenInfo(tokenAddress);

    if (!tokenInfo) {
      throw new Error(`Token info not found for ${tokenAddress}`);
    }

    // Convert amount from smallest unit to readable amount
    const readableAmount =
      parseFloat(amount) / Math.pow(10, tokenInfo.decimals);

    // Calculate USD value
    const usdValue = readableAmount * parseFloat(price);

    return usdValue;
  } catch (error) {
    console.error("Error calculating USD value:", error);
    throw error;
  }
}

/**
 * Get price ratio between two tokens
 * @param token1Address First token address
 * @param token2Address Second token address
 * @returns Promise<number> - Ratio of token1/token2
 */
export async function getPriceRatio(
  token1Address: string,
  token2Address: string
): Promise<number> {
  try {
    const prices = await getTokenPrices([token1Address, token2Address]);

    const price1 = parseFloat(prices[token1Address]);
    const price2 = parseFloat(prices[token2Address]);

    if (!price1 || !price2) {
      throw new Error("Could not fetch prices for both tokens");
    }

    return price1 / price2;
  } catch (error) {
    console.error("Error calculating price ratio:", error);
    throw error;
  }
}

/**
 * Format price for display
 * @param price Price string from API
 * @param decimals Number of decimal places to show
 * @returns string - Formatted price
 */
export function formatPrice(price: string, decimals: number = 6): string {
  const num = parseFloat(price);
  return num.toFixed(decimals);
}
