import { ethers } from "ethers";
import { getUserNonce, isTokenWhitelisted } from "./database";
import { getTokenInfo as getStaticTokenInfo } from "./tokenMapping";
import { CANCEL_TYPE, Intent, INTENT_TYPE } from "./types";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
];

// Address validation utilities (duplicated here to avoid circular imports)
function isEVMAddress(address: string): boolean {
  return ethers.isAddress(address);
}

function isNonEVMAddress(address: string): boolean {
  // Aptos addresses contain "::"
  // Add other patterns as needed for different chains
  return (
    address.includes("::") || (!isEVMAddress(address) && address.length > 0)
  );
}

interface TokenInfo {
  decimals: number;
  symbol: string;
  name: string;
}

// Cache for token info to avoid repeated calls (server-side)
const serverTokenInfoCache = new Map<string, TokenInfo>();

// Server-side version of getTokenInfo
async function getServerTokenInfo(tokenAddress: string): Promise<TokenInfo> {
  const cacheKey = tokenAddress.toLowerCase();

  // Check cache first
  if (serverTokenInfoCache.has(cacheKey)) {
    return serverTokenInfoCache.get(cacheKey)!;
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
      serverTokenInfoCache.set(cacheKey, tokenInfo);
      return tokenInfo;
    } else {
      throw new Error(
        `No static mapping found for non-EVM token: ${tokenAddress}`
      );
    }
  }

  // For EVM addresses, validate and fetch from contract
  try {
    console.log("Server: Validating token address:", tokenAddress);

    if (!isEVMAddress(tokenAddress)) {
      console.error("Server: Address validation failed for:", tokenAddress);
      throw new Error("Invalid EVM token address");
    }

    const rpcUrl = process.env.RPC_URL || "http://localhost:8545";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      provider
    );

    console.log("Server: Fetching token info for:", tokenAddress);
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

    console.log("Server: Token info fetched successfully:", tokenInfo);

    // Cache the result
    serverTokenInfoCache.set(cacheKey, tokenInfo);
    return tokenInfo;
  } catch (error) {
    console.error(
      "Server: Failed to get token info for address:",
      tokenAddress,
      "Error:",
      error
    );
    throw new Error("Failed to fetch token information");
  }
}

function isValidTokenAddress(address: string): boolean {
  try {
    // Check if it's a valid EVM address
    if (isEVMAddress(address)) {
      return true;
    }

    // Check if it's a valid non-EVM address
    if (isNonEVMAddress(address)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// Legacy function for backward compatibility
function isValidEthereumAddress(address: string): boolean {
  return isEVMAddress(address);
}

// Get current chain ID from environment or default to localhost
function getCurrentChainId(): number {
  const chainId =
    process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || "31337";
  return parseInt(chainId);
}

// Create dynamic domain for signature verification
function createDomain(chainId?: number): any {
  const actualChainId = chainId || getCurrentChainId();
  return {
    name: "CrossChainIntentPool",
    version: "1",
    chainId: actualChainId,
    verifyingContract:
      process.env.ZERO_ADDRESS ||
      process.env.NEXT_PUBLIC_ZERO_ADDRESS ||
      "0x0000000000000000000000000000000000000000",
  };
}

export async function verifyIntentSignature(
  intent: Omit<
    Intent,
    "id" | "userAddress" | "signature" | "status" | "createdAt" | "updatedAt"
  >,
  signature: string,
  chainId?: number
): Promise<string> {
  const domain = createDomain(chainId);
  console.log("Verifying intent signature with domain:", domain);
  const digest = ethers.TypedDataEncoder.hash(domain, INTENT_TYPE, intent);
  const recoveredAddress = ethers.recoverAddress(digest, signature);
  console.log("Recovered address:", recoveredAddress);
  return recoveredAddress;
}

export async function verifyCancelSignature(
  intentId: string,
  nonce: number,
  signature: string,
  chainId?: number
): Promise<string> {
  const domain = createDomain(chainId);
  const message = { intentId, nonce };
  const digest = ethers.TypedDataEncoder.hash(domain, CANCEL_TYPE, message);
  const recoveredAddress = ethers.recoverAddress(digest, signature);
  return recoveredAddress;
}

export async function validateEVMBalance(
  userAddress: string,
  tokenAddress: string,
  amount: string,
  factoryAddress: string
): Promise<boolean> {
  try {
    const rpcUrl = process.env.RPC_URL || "http://localhost:8545";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    console.log("rpcUrl", rpcUrl);

    // Get token info for proper decimal handling (server-side version)
    console.log("Getting token info for:", tokenAddress);
    const tokenInfo = await getServerTokenInfo(tokenAddress);
    console.log("Token info:", tokenInfo);

    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      provider
    );

    console.log(
      `Checking balance of token ${tokenAddress} for user ${userAddress}`
    );

    // Check balance
    const balance = await tokenContract.balanceOf(userAddress);
    console.log("Raw balance:", balance.toString());

    // Amount is already in raw format (wei-like), convert to BigInt
    const requiredAmount = BigInt(amount);
    console.log("Required amount (raw):", requiredAmount.toString());
    console.log("Amount string:", amount, "Decimals:", tokenInfo.decimals);

    if (balance < requiredAmount) {
      console.log(
        "Insufficient balance:",
        balance.toString(),
        "<",
        requiredAmount.toString()
      );
      return false;
    }

    // Check allowance
    const allowance = await tokenContract.allowance(
      userAddress,
      factoryAddress
    );
    console.log("Raw allowance:", allowance.toString());

    if (allowance < requiredAmount) {
      console.log(
        "Insufficient allowance:",
        allowance.toString(),
        "<",
        requiredAmount.toString()
      );
      return false;
    }

    console.log("Balance and allowance validation passed!");
    return true;
  } catch (error) {
    console.error("EVM balance validation error:", error);
    return false;
  }
}

export async function validateAptosBalance(
  userAddress: string,
  tokenType: string,
  amount: string
): Promise<boolean> {
  try {
    // TODO: Implement Aptos balance check using @aptos-labs/ts-sdk
    // For now, return true for demo purposes
    return true;
  } catch (error) {
    console.error("Aptos balance validation error:", error);
    return false;
  }
}

export function validateIntentData(intent: any): {
  valid: boolean;
  error?: string;
} {
  // Check required fields
  const required = [
    "sellToken",
    "buyToken",
    "amountIn",
    "minAmountOut",
    "chainIn",
    "chainOut",
    "expiration",
    "maxSlippage",
    "feeCap",
    "nonce",
  ];
  for (const field of required) {
    if (!intent[field]) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  // Validate chains are different
  if (intent.chainIn === intent.chainOut) {
    return {
      valid: false,
      error: "Source and destination chains must be different",
    };
  }

  // Validate expiration is in future
  if (intent.expiration <= Date.now() / 1000) {
    return { valid: false, error: "Expiration must be in the future" };
  }

  // Validate minimum expiration time (5 minutes)
  if (intent.expiration < Date.now() / 1000 + 300) {
    return {
      valid: false,
      error: "Expiration must be at least 5 minutes in the future",
    };
  }

  // Validate tokens are whitelisted
  if (!isTokenWhitelisted(intent.sellToken, intent.chainIn)) {
    return { valid: false, error: "Sell token is not whitelisted" };
  }

  if (!isTokenWhitelisted(intent.buyToken, intent.chainOut)) {
    return { valid: false, error: "Buy token is not whitelisted" };
  }

  // Validate token address formats based on chain
  if (intent.chainIn === 1 && !isEVMAddress(intent.sellToken)) {
    return { valid: false, error: "Invalid Ethereum sell token address" };
  }

  if (intent.chainOut === 1 && !isEVMAddress(intent.buyToken)) {
    return { valid: false, error: "Invalid Ethereum buy token address" };
  }

  // Validate Aptos token addresses (chain 1000)
  if (intent.chainIn === 1000 && !isNonEVMAddress(intent.sellToken)) {
    return { valid: false, error: "Invalid Aptos sell token address" };
  }

  if (intent.chainOut === 1000 && !isNonEVMAddress(intent.buyToken)) {
    return { valid: false, error: "Invalid Aptos buy token address" };
  }

  return { valid: true };
}

export function validateNonce(userAddress: string, nonce: number): boolean {
  const expectedNonce = getUserNonce(userAddress) + 1;
  return nonce === expectedNonce;
}
