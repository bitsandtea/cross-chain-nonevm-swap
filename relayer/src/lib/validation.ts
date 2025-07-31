import { ethers } from "ethers";
import { RPC_URL, ZERO_ADDRESS } from "../../config/env";
import { isTokenWhitelisted } from "./database";
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
  // Aptos addresses can be in two formats:
  // 1. Testnet format with "::" (e.g., "0x1::aptos_coin::AptosCoin")
  // 2. Mainnet format as raw hash (e.g., "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b")
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

    const rpcUrl = RPC_URL;
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
function createDomain(chainId: number): {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
} {
  return {
    name: "CrossChainFusionPlus",
    version: "1",
    chainId: chainId,
    verifyingContract: ZERO_ADDRESS,
  };
}

export async function verifyFusionOrderSignature(
  fusionOrder: FusionPlusOrder,
  nonce: number,
  signature: string,
  chainId: number
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
  chainId: number
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
    const rpcUrl = RPC_URL;
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
  amount: string,
  aptosRpcUrl: string
): Promise<boolean> {
  try {
    console.log(`🔧 [Validation] Checking Aptos balance for ${userAddress}`, {
      tokenType,
      amount,
    });

    // Import Aptos SDK
    const { Aptos, AptosConfig, Network } = require("@aptos-labs/ts-sdk");

    // Configure Aptos client
    const isTestnet =
      aptosRpcUrl.includes("testnet") || aptosRpcUrl.includes("devnet");

    const config = new AptosConfig({
      network: isTestnet ? Network.TESTNET : Network.MAINNET,
      fullnode: aptosRpcUrl,
    });
    const aptos = new Aptos(config);

    console.log(`🔧 [Validation] Using Aptos RPC: ${aptosRpcUrl}`);

    // Get account resources to check balance
    try {
      const resources = await aptos.getAccountResources({
        accountAddress: userAddress,
      });

      console.log(
        `🔧 [Validation] Found ${resources.length} resources for account`
      );

      // Look for the specific coin/token balance
      let balance = BigInt(0);
      let found = false;

      // Handle both testnet and mainnet Aptos token formats
      let expectedCoinStoreType: string;
      let coinType: string;

      if (tokenType.startsWith("0x") && tokenType.length === 66) {
        // Mainnet asset hash format
        console.log(
          `🔧 [Validation] Processing mainnet asset hash: ${tokenType}`
        );
        expectedCoinStoreType = `0x1::coin::CoinStore<${tokenType}>`;
        coinType = tokenType;
      } else {
        // Testnet format with "::"
        console.log(
          `🔧 [Validation] Processing testnet token type: ${tokenType}`
        );
        coinType = tokenType.replace(/^0x/, ""); // Remove 0x prefix if present
        expectedCoinStoreType = `0x1::coin::CoinStore<${tokenType}>`;
      }

      console.log(
        `🔧 [Validation] Looking for coin store type: ${expectedCoinStoreType}`
      );

      for (const resource of resources) {
        console.log(`🔧 [Validation] Checking resource type: ${resource.type}`);

        // Check for exact match first
        if (resource.type === expectedCoinStoreType) {
          const coinData = resource.data as any;
          balance = BigInt(coinData.coin?.value || 0);
          found = true;
          console.log(
            `🔧 [Validation] Found exact CoinStore match, balance: ${balance.toString()}`
          );
          break;
        }

        // Check for partial match (for flexibility)
        if (
          resource.type.includes("coin::CoinStore") &&
          resource.type.includes(coinType)
        ) {
          const coinData = resource.data as any;
          balance = BigInt(coinData.coin?.value || 0);
          found = true;
          console.log(
            `🔧 [Validation] Found partial CoinStore match, balance: ${balance.toString()}`
          );
          break;
        }

        // Check for fungible asset store (newer Aptos standard)
        if (resource.type.includes("fungible_asset::FungibleStore")) {
          console.log(
            `🔧 [Validation] Found FungibleStore resource, needs specific implementation`
          );
          // TODO: Implement fungible asset balance checking
        }
      }

      if (!found) {
        console.warn(
          `⚠️ [Validation] No balance found for token type: ${tokenType}`
        );
        // If no coin store found, assume balance is 0
        balance = BigInt(0);
      }

      // Compare with required amount
      const requiredAmount = BigInt(amount);
      console.log(
        `🔧 [Validation] Balance: ${balance.toString()}, Required: ${requiredAmount.toString()}`
      );

      if (balance < requiredAmount) {
        console.log(
          `❌ [Validation] Insufficient Aptos balance: ${balance.toString()} < ${requiredAmount.toString()}`
        );
        return false;
      }

      console.log(`✅ [Validation] Aptos balance check passed`);
      return true;
    } catch (accountError) {
      console.warn(
        `⚠️ [Validation] Account not found or error fetching resources:`,
        accountError
      );
      // Account might not exist or have any resources - consider this as 0 balance
      const requiredAmount = BigInt(amount);
      if (requiredAmount > 0) {
        console.log(
          `❌ [Validation] Account has no resources, but amount required: ${requiredAmount.toString()}`
        );
        return false;
      }
      return true;
    }
  } catch (error) {
    console.error("Aptos balance validation error:", error);
    // For demo purposes, return true if there's an error connecting to Aptos
    console.warn(
      "⚠️ [Validation] Aptos balance check failed, allowing for demo purposes"
    );
    return true;
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

  // Validate maker address format (always EVM for now)
  if (!ethers.isAddress(fusionOrder.maker)) {
    return { valid: false, error: "Invalid maker address format" };
  }

  // Validate escrow target addresses based on their respective chains
  if (fusionOrder.srcChain === 1000) {
    // Aptos source chain - validate Aptos address format for srcEscrowTarget
    const srcEscrowValidation = validateAptosUserAddress(
      fusionOrder.srcEscrowTarget
    );
    if (!srcEscrowValidation.valid) {
      return {
        valid: false,
        error: `Invalid source escrow target: ${srcEscrowValidation.error}`,
      };
    }
  } else {
    // EVM source chain - validate EVM address format for srcEscrowTarget
    if (!ethers.isAddress(fusionOrder.srcEscrowTarget)) {
      return {
        valid: false,
        error: "Invalid source escrow target address format",
      };
    }
  }

  if (fusionOrder.dstChain === 1000) {
    // Aptos destination chain - validate Aptos address format for dstEscrowTarget
    const dstEscrowValidation = validateAptosUserAddress(
      fusionOrder.dstEscrowTarget
    );
    if (!dstEscrowValidation.valid) {
      return {
        valid: false,
        error: `Invalid destination escrow target: ${dstEscrowValidation.error}`,
      };
    }
  } else {
    // EVM destination chain - validate EVM address format for dstEscrowTarget
    if (!ethers.isAddress(fusionOrder.dstEscrowTarget)) {
      return {
        valid: false,
        error: "Invalid destination escrow target address format",
      };
    }
  }

  // Validate token addresses based on chain
  if (fusionOrder.srcChain === 1000) {
    // Aptos source chain - validate Aptos token format
    const srcTokenValidation = validateAptosTokenAddress(
      fusionOrder.makerAsset
    );
    if (!srcTokenValidation.valid) {
      return {
        valid: false,
        error: `Invalid source token address: ${srcTokenValidation.error}`,
      };
    }
  } else {
    // EVM source chain - validate EVM address format
    if (!ethers.isAddress(fusionOrder.makerAsset)) {
      return { valid: false, error: "Invalid source token address format" };
    }
  }

  if (fusionOrder.dstChain === 1000) {
    // Aptos destination chain - validate Aptos token format
    const dstTokenValidation = validateAptosTokenAddress(
      fusionOrder.takerAsset
    );
    if (!dstTokenValidation.valid) {
      return {
        valid: false,
        error: `Invalid destination token address: ${dstTokenValidation.error}`,
      };
    }
  } else {
    // EVM destination chain - validate EVM address format
    if (!ethers.isAddress(fusionOrder.takerAsset)) {
      return {
        valid: false,
        error: "Invalid destination token address format",
      };
    }
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
  if (fusionOrder.srcTimelock <= fusionOrder.dstTimelock) {
    return {
      valid: false,
      error: "Source timelock must be greater than destination timelock",
    };
  }

  // Validate escrow targets are valid addresses
  if (
    !isEVMAddress(fusionOrder.srcEscrowTarget) ||
    !isEVMAddress(fusionOrder.dstEscrowTarget)
  ) {
    return {
      valid: false,
      error: "Invalid escrow target addresses",
    };
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
  // Accept any nonce from frontend - let frontend manage its own nonce
  return typeof nonce === "number" && nonce > 0;
}

/**
 * Validate Aptos user address format
 */
export function validateAptosUserAddress(address: string): {
  valid: boolean;
  error?: string;
} {
  try {
    if (!address.startsWith("0x")) {
      return {
        valid: false,
        error: "Aptos address must start with 0x",
      };
    }

    const hexPart = address.slice(2);
    if (
      hexPart.length === 0 ||
      hexPart.length > 64 ||
      !/^[a-fA-F0-9]+$/.test(hexPart)
    ) {
      return {
        valid: false,
        error:
          "Invalid Aptos address format - invalid hex characters or length",
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Aptos address validation error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
}

/**
 * Validate Aptos token address format
 */
export function validateAptosTokenAddress(tokenAddress: string): {
  valid: boolean;
  error?: string;
} {
  try {
    // Check if it's a mainnet Aptos asset hash format
    if (tokenAddress.startsWith("0x") && tokenAddress.length === 66) {
      console.log(
        `🔧 [Validation] Validating Aptos mainnet asset hash: ${tokenAddress}`
      );
      return { valid: true };
    }

    // Check if it's a testnet Aptos token format with "::"
    if (tokenAddress.includes("::")) {
      console.log(
        `🔧 [Validation] Validating Aptos testnet token: ${tokenAddress}`
      );
      return { valid: true };
    }

    return {
      valid: false,
      error:
        "Invalid Aptos token address format - must be mainnet hash (0x...) or testnet format (module::name::type)",
    };
  } catch (error) {
    return {
      valid: false,
      error: `Aptos token validation error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
}

/**
 * Test function to validate our Aptos integration
 */
export async function testAptosValidation(): Promise<void> {
  try {
    console.log("🧪 Testing Aptos validation...");

    // Test Aptos address validation
    const testAddresses = [
      "0x1",
      "0x1::aptos_coin::AptosCoin",
      "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::USDC",
      "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b", // Aptos USDC mainnet
      "invalid::address",
    ];

    for (const addr of testAddresses) {
      if (addr.includes("::")) {
        const result = validateAptosTokenAddress(addr);
        console.log(
          `Token ${addr}: ${result.valid ? "✅" : "❌"} ${result.error || ""}`
        );
      } else {
        const result = validateAptosUserAddress(addr);
        console.log(
          `User ${addr}: ${result.valid ? "✅" : "❌"} ${result.error || ""}`
        );
      }
    }

    console.log("🧪 Aptos validation test completed");
  } catch (error) {
    console.error("❌ Aptos validation test failed:", error);
  }
}

/**
 * Get mainnet address for price fetching (for 1inch API compatibility)
 */
export function getMainnetAddressForPrice(
  tokenAddress: string,
  chainId: number
): string {
  const { getMainnetAddress } = require("./tokenMapping");
  const mainnetAddress = getMainnetAddress(tokenAddress);

  if (mainnetAddress) {
    console.log(
      `🔧 [Validation] Mapped ${tokenAddress} to mainnet: ${mainnetAddress}`
    );
    return mainnetAddress;
  }

  // Fallback to original address if no mapping found
  console.warn(
    `⚠️ [Validation] No mainnet mapping found for ${tokenAddress}, using original`
  );
  return tokenAddress;
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
    console.log("result: ", result);

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
