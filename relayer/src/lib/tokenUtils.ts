import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import { getTokenInfo as getStaticTokenInfo } from "./tokenMapping";

// ERC20 ABI for allowance and approval
export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
];

// Factory address for allowance checking
export const FACTORY_ADDRESS =
  process.env.NEXT_PUBLIC_ETH_FACTORY_ADDRESS ||
  "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853";

export interface AllowanceState {
  currentAllowance: bigint;
  requiredAmount: bigint;
  hasEnoughAllowance: boolean;
  isLoading: boolean;
  error?: string;
  decimals?: number;
}

export interface TokenInfo {
  decimals: number;
  symbol: string;
  name: string;
}

// Cache for token info to avoid repeated calls
const tokenInfoCache = new Map<string, TokenInfo>();

// Get token information (decimals, symbol, name)
export async function getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
  const cacheKey = tokenAddress.toLowerCase();

  // Check cache first
  if (tokenInfoCache.has(cacheKey)) {
    return tokenInfoCache.get(cacheKey)!;
  }

  // For non-EVM addresses, we can only rely on static mapping
  if (isNonEVMAddress(tokenAddress)) {
    const staticInfo = getStaticTokenInfo(tokenAddress);
    if (staticInfo) {
      const tokenInfo: TokenInfo = {
        decimals: staticInfo.decimals,
        symbol: staticInfo.symbol,
        name: staticInfo.name,
      };
      tokenInfoCache.set(cacheKey, tokenInfo);
      return tokenInfo;
    } else {
      throw new Error(
        `No static mapping found for non-EVM token: ${tokenAddress}`
      );
    }
  }

  // For EVM addresses, validate and fetch from contract
  try {
    console.log(
      "Validating token address:",
      tokenAddress,
      "Type:",
      typeof tokenAddress
    );

    if (!isEVMAddress(tokenAddress)) {
      console.error("Address validation failed for:", tokenAddress);
      throw new Error("Invalid EVM token address");
    }

    const provider = new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545"
    );
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      provider
    );

    console.log("Fetching token info for:", tokenAddress);
    const [decimals, symbol, name] = await Promise.all([
      tokenContract.decimals(),
      tokenContract.symbol(),
      tokenContract.name(),
    ]);

    const tokenInfo: TokenInfo = {
      decimals: Number(decimals),
      symbol,
      name,
    };

    console.log("Token info fetched successfully:", tokenInfo);

    // Cache the result
    tokenInfoCache.set(cacheKey, tokenInfo);
    return tokenInfo;
  } catch (error) {
    console.error(
      "Failed to get token info for address:",
      tokenAddress,
      "Error:",
      error
    );
    throw new Error("Failed to fetch token information");
  }
}

// Check if a token contract exists and implements ERC20
export async function validateTokenContract(
  tokenAddress: string
): Promise<boolean> {
  try {
    await getTokenInfo(tokenAddress);
    return true;
  } catch (error) {
    console.error("Token validation failed:", error);
    return false;
  }
}

// Parse amount with correct decimals
export async function parseTokenAmount(
  amount: string,
  tokenAddress: string
): Promise<bigint> {
  const tokenInfo = await getTokenInfo(tokenAddress);
  return ethers.parseUnits(amount, tokenInfo.decimals);
}

// Format amount with correct decimals
export async function formatTokenAmount(
  amount: bigint,
  tokenAddress: string
): Promise<string> {
  try {
    const tokenInfo = await getTokenInfo(tokenAddress);
    return ethers.formatUnits(amount, tokenInfo.decimals);
  } catch (error) {
    console.error("Failed to format token amount:", error);
    return "0";
  }
}

// Check token allowance with proper error handling
export async function checkTokenAllowance(
  account: string,
  tokenAddress: string,
  amount: string
): Promise<AllowanceState> {
  try {
    // Validate inputs
    if (!account || !tokenAddress || !amount) {
      throw new Error("Missing required parameters");
    }

    // For non-EVM tokens, allowance concept doesn't apply
    if (isNonEVMAddress(tokenAddress)) {
      // Get decimals from static mapping for consistency
      const decimals = getTokenDecimalsSync(tokenAddress) || 18;
      const requiredAmount = ethers.parseUnits(amount, decimals);

      return {
        currentAllowance: BigInt(0),
        requiredAmount,
        hasEnoughAllowance: true, // Non-EVM tokens don't need allowance
        isLoading: false,
        decimals,
      };
    }

    // For EVM tokens, validate addresses and check allowance
    if (!isEVMAddress(account) || !isEVMAddress(tokenAddress)) {
      throw new Error("Invalid EVM address format");
    }

    // Get token info and validate contract
    const tokenInfo = await getTokenInfo(tokenAddress);

    const provider = new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545"
    );
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      provider
    );

    const requiredAmount = ethers.parseUnits(amount, tokenInfo.decimals);

    // Use call with explicit error handling
    const currentAllowance = await tokenContract.allowance(
      account,
      FACTORY_ADDRESS
    );

    const hasEnoughAllowance = currentAllowance >= requiredAmount;

    return {
      currentAllowance,
      requiredAmount,
      hasEnoughAllowance,
      isLoading: false,
      decimals: tokenInfo.decimals,
    };
  } catch (error: unknown) {
    console.error("Allowance check error:", error);

    let errorMessage = "Failed to check allowance";
    if (error instanceof Error) {
      if (error.message.includes("could not decode result")) {
        errorMessage = "Token contract not found or invalid";
      } else if (error.message.includes("network")) {
        errorMessage = "Network connection error";
      } else {
        errorMessage = error.message;
      }
    }

    return {
      currentAllowance: BigInt(0),
      requiredAmount: BigInt(0),
      hasEnoughAllowance: false,
      isLoading: false,
      error: errorMessage,
    };
  }
}

// Approve token allowance
export async function approveTokenAllowance(
  tokenAddress: string,
  amount: string,
  signer: ethers.Signer
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Get token info and validate contract
    const tokenInfo = await getTokenInfo(tokenAddress);

    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const requiredAmount = ethers.parseUnits(amount, tokenInfo.decimals);

    toast.loading("Approve transaction pending...", { id: "approval" });

    const tx = await tokenContract.approve(FACTORY_ADDRESS, requiredAmount);

    toast.loading("Waiting for confirmation...", { id: "approval" });
    await tx.wait();

    toast.success("Token approved successfully!", { id: "approval" });

    return { success: true, txHash: tx.hash };
  } catch (error: unknown) {
    console.error("Approval error:", error);

    let errorMessage = "Approval failed";
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ACTION_REJECTED") {
        errorMessage = "Approval rejected by user";
      }
    }

    toast.error(errorMessage, { id: "approval" });
    return { success: false, error: errorMessage };
  }
}

// Format allowance amount for display using decimals from allowance state
export function formatAllowanceWithDecimals(
  amount: bigint,
  decimals?: number
): string {
  try {
    const actualDecimals = decimals || 18; // Fallback to 18 if not provided
    const formatted = ethers.formatUnits(amount, actualDecimals);
    return parseFloat(formatted).toFixed(4);
  } catch {
    return "0.0000";
  }
}

// Format allowance amount for display (with automatic decimal detection)
export async function formatAllowanceAmount(
  amount: bigint,
  tokenAddress: string
): Promise<string> {
  try {
    const formatted = await formatTokenAmount(amount, tokenAddress);
    return parseFloat(formatted).toFixed(4);
  } catch {
    return "0.0000";
  }
}

// Legacy function for backward compatibility (uses 18 decimals as fallback)
export function formatAllowance(amount: bigint): string {
  try {
    return parseFloat(ethers.formatEther(amount)).toFixed(4);
  } catch {
    return "0.0000";
  }
}

// Check if amount exceeds current allowance and suggest limiting
export function checkAmountVsAllowance(
  allowanceState: AllowanceState,
  amount: string
): boolean {
  if (
    !allowanceState.currentAllowance ||
    allowanceState.currentAllowance === BigInt(0)
  ) {
    return false; // No allowance, will need approval
  }

  try {
    // Use the decimals from allowance state if available, otherwise fallback to 18
    const decimals = allowanceState.decimals || 18;
    const requestedAmount = ethers.parseUnits(amount, decimals);
    return requestedAmount > allowanceState.currentAllowance;
  } catch {
    return false;
  }
}

// Get maximum available amount based on current allowance
export async function getMaxAllowanceAmount(
  allowanceState: AllowanceState,
  tokenAddress: string
): Promise<string> {
  if (
    !allowanceState.currentAllowance ||
    allowanceState.currentAllowance === BigInt(0)
  ) {
    return "0";
  }

  try {
    return await formatTokenAmount(
      allowanceState.currentAllowance,
      tokenAddress
    );
  } catch {
    return formatAllowance(allowanceState.currentAllowance);
  }
}

// Enhanced utility functions for handling decimals correctly

/**
 * Check if an address is an EVM address (Ethereum-style)
 */
export function isEVMAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * Check if an address is a non-EVM address (e.g., Aptos)
 * Non-EVM addresses typically contain "::" or other chain-specific patterns
 */
export function isNonEVMAddress(address: string): boolean {
  // Aptos addresses contain "::"
  // Add other patterns as needed for different chains
  return (
    address.includes("::") || (!isEVMAddress(address) && address.length > 0)
  );
}

/**
 * Get token decimals from static mapping first, fallback to dynamic lookup
 */
export async function getTokenDecimals(tokenAddress: string): Promise<number> {
  // First try static mapping for known tokens
  const staticInfo = getStaticTokenInfo(tokenAddress);
  if (staticInfo) {
    return staticInfo.decimals;
  }

  // For EVM addresses, try dynamic lookup
  if (isEVMAddress(tokenAddress)) {
    try {
      const tokenInfo = await getTokenInfo(tokenAddress);
      return tokenInfo.decimals;
    } catch (error) {
      console.warn(
        `Failed to get decimals for EVM token ${tokenAddress}, using 18 as fallback`
      );
      return 18; // Default fallback for EVM tokens
    }
  }

  // For non-EVM addresses, we can only rely on static mapping
  console.warn(
    `No static mapping found for non-EVM token ${tokenAddress}, using 18 as fallback`
  );
  return 18; // Default fallback
}

/**
 * Get token decimals synchronously from static mapping only
 */
export function getTokenDecimalsSync(tokenAddress: string): number | null {
  const staticInfo = getStaticTokenInfo(tokenAddress);
  return staticInfo?.decimals || null;
}

/**
 * Format token amount with proper decimals (async version)
 * Uses static mapping first for performance, falls back to contract call
 */
export async function formatTokenAmountWithDecimals(
  amount: string | bigint,
  tokenAddress: string,
  maxDisplayDecimals: number = 4
): Promise<string> {
  try {
    const decimals = await getTokenDecimals(tokenAddress);
    const amountBigInt = typeof amount === "string" ? BigInt(amount) : amount;
    const formatted = ethers.formatUnits(amountBigInt, decimals);
    return parseFloat(formatted).toFixed(maxDisplayDecimals);
  } catch (error) {
    console.error("Failed to format token amount:", error);
    return "0.0000";
  }
}

/**
 * Format token amount with proper decimals (sync version for known tokens)
 * Returns null if token is not in static mapping
 */
export function formatTokenAmountSync(
  amount: string | bigint,
  tokenAddress: string,
  maxDisplayDecimals: number = 4
): string | null {
  try {
    const decimals = getTokenDecimalsSync(tokenAddress);
    if (decimals === null) {
      return null; // Token not in static mapping
    }

    const amountBigInt = typeof amount === "string" ? BigInt(amount) : amount;
    const formatted = ethers.formatUnits(amountBigInt, decimals);
    return parseFloat(formatted).toFixed(maxDisplayDecimals);
  } catch (error) {
    console.error("Failed to format token amount:", error);
    return null;
  }
}

/**
 * Format token amount with fallback handling
 * Tries sync first, then async, then basic ether formatting
 */
export async function formatTokenAmountSafe(
  amount: string | bigint,
  tokenAddress: string,
  maxDisplayDecimals: number = 4
): Promise<string> {
  // Try sync formatting first for known tokens
  const syncResult = formatTokenAmountSync(
    amount,
    tokenAddress,
    maxDisplayDecimals
  );
  if (syncResult !== null) {
    return syncResult;
  }

  // Fallback to async formatting
  try {
    return await formatTokenAmountWithDecimals(
      amount,
      tokenAddress,
      maxDisplayDecimals
    );
  } catch (error) {
    // Last resort: assume 18 decimals
    try {
      const amountBigInt = typeof amount === "string" ? BigInt(amount) : amount;
      const formatted = ethers.formatEther(amountBigInt);
      return parseFloat(formatted).toFixed(maxDisplayDecimals);
    } catch {
      return "0.0000";
    }
  }
}

/**
 * Parse token amount with proper decimals (async version)
 */
export async function parseTokenAmountWithDecimals(
  amount: string,
  tokenAddress: string
): Promise<bigint> {
  const decimals = await getTokenDecimals(tokenAddress);
  return ethers.parseUnits(amount, decimals);
}

/**
 * Parse token amount with proper decimals (sync version for known tokens)
 */
export function parseTokenAmountSync(
  amount: string,
  tokenAddress: string
): bigint | null {
  try {
    const decimals = getTokenDecimalsSync(tokenAddress);
    if (decimals === null) {
      return null; // Token not in static mapping
    }
    return ethers.parseUnits(amount, decimals);
  } catch (error) {
    console.error("Failed to parse token amount:", error);
    return null;
  }
}

/**
 * Calculate USD value from raw token amount (in smallest units)
 * @param rawAmount - Amount in token's smallest units (e.g., wei for 18 decimal tokens)
 * @param tokenAddress - Token contract address
 * @param tokenPriceUSD - Token price in USD
 * @returns Promise<string> - Formatted USD value (e.g., "$123.45")
 */
export async function calculateUSDFromRawAmount(
  rawAmount: string | bigint,
  tokenAddress: string,
  tokenPriceUSD: string | number
): Promise<string> {
  try {
    const priceNum =
      typeof tokenPriceUSD === "string"
        ? parseFloat(tokenPriceUSD)
        : tokenPriceUSD;
    if (isNaN(priceNum) || priceNum === 0) return "$0.00";

    const formattedAmount = await formatTokenAmountWithDecimals(
      rawAmount,
      tokenAddress,
      18
    );
    const amountNum = parseFloat(formattedAmount);

    if (isNaN(amountNum)) return "$0.00";

    const usdValue = amountNum * priceNum;
    return `$${usdValue.toFixed(2)}`;
  } catch (error) {
    console.error("Failed to calculate USD value:", error);
    return "$0.00";
  }
}

/**
 * Calculate USD value from human-readable token amount
 * @param humanAmount - Human-readable amount (e.g., "1.5")
 * @param tokenPriceUSD - Token price in USD
 * @returns string - Formatted USD value (e.g., "$123.45")
 */
export function calculateUSDFromHumanAmount(
  humanAmount: string | number,
  tokenPriceUSD: string | number
): string {
  try {
    const amountNum =
      typeof humanAmount === "string" ? parseFloat(humanAmount) : humanAmount;
    const priceNum =
      typeof tokenPriceUSD === "string"
        ? parseFloat(tokenPriceUSD)
        : tokenPriceUSD;

    if (isNaN(amountNum) || isNaN(priceNum) || priceNum === 0) return "$0.00";

    const usdValue = amountNum * priceNum;
    return `$${usdValue.toFixed(2)}`;
  } catch (error) {
    console.error("Failed to calculate USD value:", error);
    return "$0.00";
  }
}
