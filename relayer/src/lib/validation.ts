import { ethers } from "ethers";
import { getUserNonce, isTokenWhitelisted } from "./database";
import { validateEscrowTargets, validateTimelockSequence } from "./flowUtils";
import { getTokenInfo as getStaticTokenInfo } from "./tokenMapping";
import { CANCEL_TYPE, FUSION_ORDER_TYPE, FusionPlusOrder } from "./types";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
];

// Address validation utilities
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

    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8545";
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

// Create dynamic domain for signature verification
function createDomain(chainId?: number): {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
} {
  const getCurrentChainId = () => {
    const chainId =
      process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || "31337";
    return parseInt(chainId);
  };

  const actualChainId = chainId || getCurrentChainId();
  return {
    name: "CrossChainFusionPlus",
    version: "1",
    chainId: actualChainId,
    verifyingContract:
      process.env.ZERO_ADDRESS ||
      process.env.NEXT_PUBLIC_ZERO_ADDRESS ||
      "0x0000000000000000000000000000000000000000",
  };
}

export async function verifyFusionOrderSignature(
  fusionOrder: FusionPlusOrder,
  nonce: number,
  signature: string,
  chainId?: number
): Promise<string> {
  const domain = createDomain(chainId);
  console.log("Verifying Fusion+ order signature with domain:", domain);

  // Create the message object for signing
  const message = {
    ...fusionOrder,
    nonce,
  };

  const digest = ethers.TypedDataEncoder.hash(
    domain,
    FUSION_ORDER_TYPE,
    message
  );
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
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8545";
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

/**
 * Validate FusionPlusOrder structure and fields
 */
export function validateFusionPlusOrder(fusionOrder: FusionPlusOrder): {
  valid: boolean;
  error?: string;
} {
  // Validate required core fields
  const requiredFields: (keyof FusionPlusOrder)[] = [
    "makerAsset",
    "takerAsset",
    "makingAmount",
    "takingAmount",
    "maker",
    "srcChain",
    "dstChain",
    "auctionStartTime",
    "auctionDuration",
    "startRate",
    "endRate",
    "secretHash",
    "srcEscrowTarget",
    "dstEscrowTarget",
    "srcTimelock",
    "dstTimelock",
    "finalityLock",
    "srcSafetyDeposit",
    "dstSafetyDeposit",
    "fillThresholds",
    "salt",
    "expiration",
  ];

  for (const field of requiredFields) {
    if (fusionOrder[field] === undefined || fusionOrder[field] === null) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  // Validate address formats
  if (!ethers.isAddress(fusionOrder.maker)) {
    return { valid: false, error: "Invalid maker address format" };
  }

  // Validate chain compatibility
  if (fusionOrder.srcChain === fusionOrder.dstChain) {
    return {
      valid: false,
      error: "Source and destination chains must be different",
    };
  }

  // Validate amounts are positive
  try {
    const makingAmount = BigInt(fusionOrder.makingAmount);
    const takingAmount = BigInt(fusionOrder.takingAmount);
    const srcSafetyDeposit = BigInt(fusionOrder.srcSafetyDeposit);
    const dstSafetyDeposit = BigInt(fusionOrder.dstSafetyDeposit);

    if (makingAmount <= BigInt(0)) {
      return { valid: false, error: "Making amount must be positive" };
    }
    if (takingAmount <= BigInt(0)) {
      return { valid: false, error: "Taking amount must be positive" };
    }
    if (srcSafetyDeposit < BigInt(0)) {
      return {
        valid: false,
        error: "Source safety deposit cannot be negative",
      };
    }
    if (dstSafetyDeposit < BigInt(0)) {
      return {
        valid: false,
        error: "Destination safety deposit cannot be negative",
      };
    }
  } catch (error) {
    return { valid: false, error: "Invalid numeric amounts in order" };
  }

  // Validate secret hash format (should be 32 bytes hex)
  if (
    !fusionOrder.secretHash.startsWith("0x") ||
    fusionOrder.secretHash.length !== 66
  ) {
    return {
      valid: false,
      error: "Invalid secret hash format (must be 32 bytes hex)",
    };
  }

  // Validate salt format (should be 32 bytes hex)
  if (!fusionOrder.salt.startsWith("0x") || fusionOrder.salt.length !== 66) {
    return {
      valid: false,
      error: "Invalid salt format (must be 32 bytes hex)",
    };
  }

  // Validate timelock sequence
  const timelockValidation = validateTimelockSequence(fusionOrder);
  if (!timelockValidation.valid) {
    return timelockValidation;
  }

  // Validate escrow targets
  const escrowValidation = validateEscrowTargets(fusionOrder);
  if (!escrowValidation.valid) {
    return escrowValidation;
  }

  // Validate auction parameters
  if (fusionOrder.auctionDuration <= 0) {
    return { valid: false, error: "Auction duration must be positive" };
  }

  if (fusionOrder.auctionStartTime <= 0) {
    return { valid: false, error: "Invalid auction start time" };
  }

  // Validate Dutch auction rates if specified
  if (fusionOrder.startRate !== "0" && fusionOrder.endRate !== "0") {
    const startRate = parseFloat(fusionOrder.startRate);
    const endRate = parseFloat(fusionOrder.endRate);

    if (isNaN(startRate) || startRate <= 0) {
      return { valid: false, error: "Start rate must be a positive number" };
    }
    if (isNaN(endRate) || endRate <= 0) {
      return { valid: false, error: "End rate must be a positive number" };
    }
    if (startRate <= endRate) {
      return {
        valid: false,
        error: "Start rate must be greater than end rate for price decay",
      };
    }
  }

  // Validate fill thresholds
  if (
    !Array.isArray(fusionOrder.fillThresholds) ||
    fusionOrder.fillThresholds.length === 0
  ) {
    return { valid: false, error: "Fill thresholds must be a non-empty array" };
  }

  for (const threshold of fusionOrder.fillThresholds) {
    if (typeof threshold !== "number" || threshold <= 0 || threshold > 100) {
      return {
        valid: false,
        error: "Fill thresholds must be numbers between 1 and 100",
      };
    }
  }

  // Ensure thresholds are sorted and include 100%
  const sortedThresholds = [...fusionOrder.fillThresholds].sort(
    (a, b) => a - b
  );
  if (sortedThresholds[sortedThresholds.length - 1] !== 100) {
    return {
      valid: false,
      error: "Fill thresholds must include 100% completion",
    };
  }

  // Validate expiration is in future
  if (fusionOrder.expiration <= Math.floor(Date.now() / 1000)) {
    return { valid: false, error: "Expiration must be in the future" };
  }

  // Validate that tokens are whitelisted
  if (!isTokenWhitelisted(fusionOrder.makerAsset, fusionOrder.srcChain)) {
    return { valid: false, error: "Maker asset is not whitelisted" };
  }

  if (!isTokenWhitelisted(fusionOrder.takerAsset, fusionOrder.dstChain)) {
    return { valid: false, error: "Taker asset is not whitelisted" };
  }

  return { valid: true };
}

export function validateNonce(userAddress: string, nonce: number): boolean {
  const expectedNonce = getUserNonce(userAddress) + 1;
  return nonce === expectedNonce;
}

/**
 * Simple resolver authentication using API keys
 */
export function verifyResolverAuthentication(req: Request): {
  valid: boolean;
  resolverName?: string;
  resolverAddress?: string;
  error?: string;
} {
  try {
    const authHeader = req.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return {
        valid: false,
        error:
          "Missing or invalid Authorization header. Use 'Bearer <api_key>'",
      };
    }

    const apiKey = authHeader.substring(7);
    const { validateResolverApiKey } = require("./resolverAuth");
    const result = validateResolverApiKey(apiKey);

    if (!result.valid) {
      return {
        valid: false,
        error: result.error,
      };
    }

    return {
      valid: true,
      resolverName: result.resolver?.name,
      resolverAddress: result.resolver?.address,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Authentication error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
}
