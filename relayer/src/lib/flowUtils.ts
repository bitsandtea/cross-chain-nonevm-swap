import { uint8ArrayToHex, UINT_40_MAX } from "@1inch/byte-utils";
import { HashLock, randBigInt } from "@1inch/cross-chain-sdk";
import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import {
  AllowanceState,
  approveTokenAllowance,
  checkTokenAllowance,
  parseTokenAmount,
} from "./tokenUtils";
import {
  FUSION_ORDER_TYPE,
  FusionPlusIntentRequest,
  FusionPlusOrder,
} from "./types";

// Flow steps
export enum FlowStep {
  FORM = "form",
  CHECKING_ALLOWANCE = "checking_allowance",
  NEEDS_APPROVAL = "needs_approval",
  APPROVING = "approving",
  READY_TO_SIGN = "ready_to_sign",
  SIGNING = "signing",
}

export interface FormData {
  chainIn: number;
  chainOut: number;
  sellToken: string;
  sellAmount: string;
  buyToken: string;
  minBuyAmount: string;
  deadline: string;
  // Dutch auction parameters
  auctionType: "fixed" | "dutch";
  startPricePremium: string; // Percentage above market price (e.g., "10" for 10%)
  minPriceDiscount: string; // Percentage below market price (e.g., "5" for 5%)
  decayRate: string;
  decayPeriod: string;
  auctionStartDelay?: string; // Delay before auction starts (in seconds)
  // Escrow targets (optional, defaults to user address)
  srcEscrowTarget?: string;
  dstEscrowTarget?: string;
  // NEW: User-specified destination address for cross-chain swaps
  destinationAddress?: string;
  // Safety deposits (optional, uses defaults)
  srcSafetyDeposit?: string;
  dstSafetyDeposit?: string;
}

export interface FlowState {
  currentStep: FlowStep;
  allowanceState: AllowanceState;
  approvalTxHash: string;
  loading: boolean;
}

// Flow management class
export class IntentFlowManager {
  private setCurrentStep: (step: FlowStep) => void;
  private setAllowanceState: (
    state: AllowanceState | ((prev: AllowanceState) => AllowanceState)
  ) => void;
  private setApprovalTxHash: (hash: string) => void;
  private setLoading: (loading: boolean) => void;

  constructor(
    setCurrentStep: (step: FlowStep) => void,
    setAllowanceState: (
      state: AllowanceState | ((prev: AllowanceState) => AllowanceState)
    ) => void,
    setApprovalTxHash: (hash: string) => void,
    setLoading: (loading: boolean) => void
  ) {
    this.setCurrentStep = setCurrentStep;
    this.setAllowanceState = setAllowanceState;
    this.setApprovalTxHash = setApprovalTxHash;
    this.setLoading = setLoading;
  }

  // Reset flow state
  resetFlow(): void {
    this.setCurrentStep(FlowStep.FORM);
    this.setAllowanceState({
      currentAllowance: BigInt(0),
      requiredAmount: BigInt(0),
      hasEnoughAllowance: false,
      isLoading: false,
    });
    this.setApprovalTxHash("");
  }

  // Check allowance and update flow state
  async checkAllowance(
    account: string,
    tokenAddress: string,
    amount: string
  ): Promise<void> {
    this.setAllowanceState((prev) => ({
      ...prev,
      isLoading: true,
      error: undefined,
    }));
    console.log("checkAllowance account", account);
    console.log("checkAllowance tokenAddress", tokenAddress);
    console.log("checkAllowance amount", amount);
    const result = await checkTokenAllowance(account, tokenAddress, amount);
    console.log("checkAllowance result", result);
    this.setAllowanceState(result);

    if (result.error) {
      toast.error(result.error);
      this.setCurrentStep(FlowStep.FORM);
      return;
    }

    // Always proceed to ready to sign, regardless of allowance
    // The user wants to skip approval step and execute directly
    this.setCurrentStep(FlowStep.READY_TO_SIGN);
  }

  // Approve token and update flow state
  async approveToken(
    tokenAddress: string,
    amount: string,
    signer: ethers.Signer
  ): Promise<void> {
    this.setCurrentStep(FlowStep.APPROVING);

    const result = await approveTokenAllowance(tokenAddress, amount, signer);

    if (result.success && result.txHash) {
      this.setApprovalTxHash(result.txHash);
      // Recheck allowance after approval
      const account = await signer.getAddress();
      await this.checkAllowance(account, tokenAddress, amount);
    } else {
      this.setCurrentStep(FlowStep.NEEDS_APPROVAL);
    }
  }

  // Execute Fusion+ order signing and submission
  async executeFusionOrder(
    account: string,
    formData: FormData,
    loadIntents: () => void,
    loadUserBalances: (address: string) => void
  ): Promise<void> {
    this.setCurrentStep(FlowStep.SIGNING);
    this.setLoading(true);

    try {
      if (!window.ethereum) {
        throw new Error("MetaMask not found");
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Get current network chain ID
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);

      // Create dynamic domain with current chain ID
      const dynamicDomain = {
        name: "CrossChainFusionPlus",
        version: "1",
        chainId: currentChainId,
        verifyingContract:
          process.env.NEXT_PUBLIC_ZERO_ADDRESS ||
          "0x0000000000000000000000000000000000000000",
      };

      // Get user nonce from API
      const nonceResponse = await fetch(`/api/nonce/${account}`);
      const nonceData = await nonceResponse.json();
      const nonce = nonceData.nextNonce;

      // Calculate required buffer time for timelock execution
      const defaultParams = getDefaultFusionPlusParams();
      const requiredBufferTime =
        Math.max(defaultParams.srcTimelock, defaultParams.dstTimelock) +
        defaultParams.finalityLock;

      // Add both the user deadline and required buffer time
      const expiration =
        Math.floor(Date.now() / 1000) +
        parseInt(formData.deadline) * 3600 +
        requiredBufferTime;

      // Parse amounts with correct decimals for tokens on their respective chains
      let makingAmountParsed: bigint;
      let takingAmountParsed: bigint;

      // Only use parseTokenAmount for Ethereum tokens (chain 1)
      if (formData.chainIn === 1) {
        makingAmountParsed = await parseTokenAmount(
          formData.sellAmount,
          formData.sellToken
        );
      } else {
        // For non-Ethereum chains, use parseEther as fallback (assuming 18 decimals)
        makingAmountParsed = ethers.parseEther(formData.sellAmount);
      }

      if (formData.chainOut === 1) {
        takingAmountParsed = await parseTokenAmount(
          formData.minBuyAmount,
          formData.buyToken
        );
      } else {
        // For non-Ethereum chains, use parseEther as fallback (assuming 18 decimals)
        takingAmountParsed = ethers.parseEther(formData.minBuyAmount);
      }

      // Calculate Dutch auction prices if needed
      let startRate = "0";
      let endRate = "0";

      if (formData.auctionType === "dutch") {
        const calculatedPrices = await calculateAuctionPrices(
          formData.sellAmount,
          formData.sellToken,
          formData.startPricePremium || "10",
          formData.minPriceDiscount || "5"
        );

        if (!calculatedPrices) {
          throw new Error("Failed to calculate auction prices");
        }

        startRate = calculatedPrices.startPrice;
        endRate = calculatedPrices.minPrice;
      }

      // Generate secret and salt using 1inch SDK
      const secret = uint8ArrayToHex(ethers.randomBytes(32));
      const secretHash = HashLock.hashSecret(secret);
      const salt = ethers.toBeHex(randBigInt(BigInt(1000)), 32);

      // Get default parameters
      const defaults = getDefaultFusionPlusParams();

      // Build secret tree for partial fills
      let secretTree: string | undefined;
      try {
        const { buildPartialFillTree } = await import("./merkleUtils");
        const partialFillTree = buildPartialFillTree(
          secret,
          defaults.fillThresholds
        );
        secretTree = partialFillTree.root;
      } catch (error) {
        console.error("Failed to build partial fill tree:", error);
        // Continue without secretTree for now
      }

      // Calculate proper escrow target addresses (withdrawal destinations)
      const srcEscrowTarget = account; // User's address on source chain
      const dstEscrowTarget = formData.destinationAddress || account; // User's address on destination chain

      // Create the Fusion+ order with proper escrow targets
      const fusionOrder: FusionPlusOrder = {
        makerAsset: formData.sellToken,
        takerAsset: formData.buyToken,
        makingAmount: makingAmountParsed.toString(),
        takingAmount: takingAmountParsed.toString(),
        maker: account,
        srcChain: formData.chainIn,
        dstChain: formData.chainOut,
        auctionStartTime:
          Math.floor(Date.now() / 1000) +
          parseInt(formData.auctionStartDelay || "0"),
        auctionDuration:
          parseInt(formData.decayPeriod) || defaults.auctionDuration,
        startRate,
        endRate,
        secretHash,
        srcEscrowTarget, // User's withdrawal address on source chain
        dstEscrowTarget, // User's withdrawal address on destination chain
        srcTimelock: defaults.srcTimelock,
        dstTimelock: defaults.dstTimelock,
        finalityLock: defaults.finalityLock,
        srcSafetyDeposit:
          formData.srcSafetyDeposit || defaults.srcSafetyDeposit,
        dstSafetyDeposit:
          formData.dstSafetyDeposit || defaults.dstSafetyDeposit,
        fillThresholds: defaults.fillThresholds,
        secretTree,
        salt,
        expiration,
      };

      // Create message for signing (includes nonce)
      const message = {
        ...fusionOrder,
        nonce,
      };

      // Sign order with dynamic domain
      const signature = await signer.signTypedData(
        dynamicDomain,
        FUSION_ORDER_TYPE,
        message
      );

      // Submit to API
      const requestBody: FusionPlusIntentRequest = {
        fusionOrder,
        nonce,
        signature,
      };

      const response = await fetch("/api/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success("🚀 Fusion+ order broadcasted to the grid!");
        this.resetFlow();
        loadIntents();
        await loadUserBalances(account);
        return; // Success, return the default form data reset
      } else {
        toast.error(result.error || "Failed to submit Fusion+ order");
        this.setCurrentStep(FlowStep.FORM);
      }
    } catch (error) {
      console.error("Submit error:", error);
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ACTION_REJECTED"
      ) {
        toast.error("Transaction rejected by user");
      } else {
        toast.error("Failed to submit Fusion+ order");
      }
      this.setCurrentStep(FlowStep.FORM);
    } finally {
      this.setLoading(false);
    }
  }
}

// Validate form data
export function validateFormData(formData: FormData): {
  valid: boolean;
  error?: string;
} {
  if (
    !formData.sellToken ||
    !formData.sellAmount ||
    !formData.buyToken ||
    !formData.minBuyAmount
  ) {
    return { valid: false, error: "Please fill in all required fields" };
  }

  // Validate amounts are positive numbers
  const sellAmount = parseFloat(formData.sellAmount);
  const buyAmount = parseFloat(formData.minBuyAmount);

  if (isNaN(sellAmount) || sellAmount <= 0) {
    return { valid: false, error: "Invalid sell amount" };
  }

  if (isNaN(buyAmount) || buyAmount <= 0) {
    return { valid: false, error: "Invalid buy amount" };
  }

  // Validate Dutch auction parameters if selected
  if (formData.auctionType === "dutch") {
    if (!formData.startPricePremium || !formData.minPriceDiscount) {
      return {
        valid: false,
        error: "Dutch auction requires premium and discount percentages",
      };
    }

    const premium = parseFloat(formData.startPricePremium);
    const discount = parseFloat(formData.minPriceDiscount);

    if (isNaN(premium) || premium < 0) {
      return {
        valid: false,
        error: "Start price premium must be a non-negative number",
      };
    }

    if (isNaN(discount) || discount < 0 || discount >= 100) {
      return {
        valid: false,
        error: "Min price discount must be between 0 and 100%",
      };
    }

    // Ensure there's a meaningful price range
    if (premium <= discount) {
      return {
        valid: false,
        error:
          "Start price premium should be higher than min price discount for meaningful auction",
      };
    }

    const decayRate = parseFloat(formData.decayRate);
    if (isNaN(decayRate) || decayRate <= 0 || decayRate > 1) {
      return {
        valid: false,
        error: "Decay rate must be between 0 and 1 (e.g., 0.02 for 2%)",
      };
    }

    const decayPeriod = parseInt(formData.decayPeriod);
    if (isNaN(decayPeriod) || decayPeriod < 1) {
      return { valid: false, error: "Decay period must be at least 1 second" };
    }
  }

  return { valid: true };
}

// Calculate actual start and min prices from sell amount and percentages
async function calculateAuctionPrices(
  sellAmount: string,
  sellToken: string,
  startPricePremium: string,
  minPriceDiscount: string
): Promise<{ startPrice: string; minPrice: string } | null> {
  try {
    // Get current token price
    const response = await fetch(
      `/api/prices?tokens=${encodeURIComponent(sellToken)}`
    );
    if (!response.ok) return null;

    const data = await response.json();
    const tokenPrice = parseFloat(data.prices[sellToken]);
    if (isNaN(tokenPrice) || tokenPrice <= 0) return null;

    // Calculate base USD value
    const sellAmountNum = parseFloat(sellAmount);
    if (isNaN(sellAmountNum) || sellAmountNum <= 0) return null;

    const baseValue = sellAmountNum * tokenPrice;

    // Calculate start price (premium above market)
    const premiumPercent = parseFloat(startPricePremium) / 100;
    const startPrice = baseValue * (1 + premiumPercent);

    // Calculate min price (discount below market)
    const discountPercent = parseFloat(minPriceDiscount) / 100;
    const minPrice = baseValue * (1 - discountPercent);

    return {
      startPrice: startPrice.toFixed(2),
      minPrice: minPrice.toFixed(2),
    };
  } catch (error) {
    console.error("Error calculating auction prices:", error);
    return null;
  }
}

// Get default form data
export function getDefaultFormData(): FormData {
  return {
    chainIn: 1,
    chainOut: 1000,
    sellToken: "",
    sellAmount: "",
    buyToken: "",
    minBuyAmount: "",
    deadline: "1",
    // Dutch auction defaults
    auctionType: "fixed",
    startPricePremium: "10", // 10% above market
    minPriceDiscount: "5", // 5% below market
    decayRate: "0.02", // 2% per second
    decayPeriod: "5", // 5 seconds
  };
}

// ===== FUSION+ UTILITY FUNCTIONS =====

/**
 * Generate a random secret for atomic swaps using 1inch SDK patterns
 */
export function generateSecret(): string {
  return uint8ArrayToHex(ethers.randomBytes(32));
}

/**
 * Generate SHA256/Keccak256 hash of a secret using 1inch SDK
 */
export function hashSecret(secret: string): string {
  return HashLock.hashSecret(secret);
}

/**
 * Generate random salt for order uniqueness using 1inch SDK
 */
export function generateSalt(): string {
  return ethers.toBeHex(randBigInt(UINT_40_MAX), 32);
}

/**
 * Get default Fusion+ parameters
 */
export function getDefaultFusionPlusParams() {
  return {
    // Default timelock values (in seconds)
    srcTimelock: 3600, // 1 hour for source chain (must be > dstTimelock)
    dstTimelock: 1800, // 30 minutes for destination chain
    finalityLock: 300, // 5 minutes for chain reorganization protection

    // Default safety deposit amounts (in wei)
    srcSafetyDeposit: ethers.parseEther("0.01").toString(), // 0.01 ETH equivalent
    dstSafetyDeposit: ethers.parseEther("0.01").toString(), // 0.01 ETH equivalent

    // Default fill thresholds for partial fills
    fillThresholds: [25, 50, 75, 100],

    // Default auction duration (1 hour)
    auctionDuration: 3600,
  };
}

/**
 * Validate timelock sequence for security
 */
export function validateTimelockSequence(fusionOrder: FusionPlusOrder): {
  valid: boolean;
  error?: string;
} {
  if (fusionOrder.srcTimelock <= fusionOrder.dstTimelock) {
    return {
      valid: false,
      error:
        "Source timelock must be greater than destination timelock for security",
    };
  }

  if (fusionOrder.srcTimelock < 300) {
    // Minimum 5 minutes
    return {
      valid: false,
      error: "Source timelock must be at least 300 seconds (5 minutes)",
    };
  }

  if (fusionOrder.dstTimelock < 180) {
    // Minimum 3 minutes
    return {
      valid: false,
      error: "Destination timelock must be at least 180 seconds (3 minutes)",
    };
  }

  if (fusionOrder.finalityLock < 60) {
    // Minimum 1 minute
    return {
      valid: false,
      error: "Finality lock must be at least 60 seconds (1 minute)",
    };
  }

  // Ensure expiration allows for timelock execution
  const currentTime = Math.floor(Date.now() / 1000);
  const maxTimelock = Math.max(
    fusionOrder.srcTimelock,
    fusionOrder.dstTimelock
  );

  if (
    fusionOrder.expiration <=
    currentTime + maxTimelock + fusionOrder.finalityLock
  ) {
    return {
      valid: false,
      error:
        "Expiration must allow sufficient time for timelock execution and finality",
    };
  }

  return { valid: true };
}

/**
 * Validate escrow target addresses based on chain
 */
export function validateEscrowTargets(fusionOrder: FusionPlusOrder): {
  valid: boolean;
  error?: string;
} {
  // Validate source escrow target format
  if (fusionOrder.srcChain === 1) {
    // Ethereum
    if (!ethers.isAddress(fusionOrder.srcEscrowTarget)) {
      return {
        valid: false,
        error: "Invalid Ethereum address format for source escrow target",
      };
    }
  } else if (fusionOrder.srcChain === 1000) {
    // Aptos - validate as hex address (64 characters after 0x)
    const aptosAddressRegex = /^0x[a-fA-F0-9]{64}$/;
    if (!aptosAddressRegex.test(fusionOrder.srcEscrowTarget)) {
      return {
        valid: false,
        error:
          "Invalid Aptos address format for source escrow target. Please provide a valid 64-character hex address",
      };
    }
  }

  // Validate destination escrow target format
  if (fusionOrder.dstChain === 1) {
    // Ethereum
    if (!ethers.isAddress(fusionOrder.dstEscrowTarget)) {
      return {
        valid: false,
        error: "Invalid Ethereum address format for destination escrow target",
      };
    }
  } else if (fusionOrder.dstChain === 1000) {
    console.log("dstEscrowTarget", fusionOrder.dstEscrowTarget);
    // Aptos - validate as hex address (64 characters after 0x)
    const aptosAddressRegex = /^0x[a-fA-F0-9]{64}$/;
    if (!aptosAddressRegex.test(fusionOrder.dstEscrowTarget)) {
      return {
        valid: false,
        error:
          "Invalid Aptos address format for destination escrow target. Please provide a valid 64-character hex address (e.g., 0x44689d8f78944f57e1d84bfa1d9f4042d20d7e22c3ec0fe93a05b8035c7712c1)",
      };
    }
  }

  return { valid: true };
}
