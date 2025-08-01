import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import {
  ETH_FACTORY_ADDRESS,
  RESOLVER_ADDRESS,
  USDC_ADDRESS,
  USDC_APTOS_ADDRESS,
  ZERO_ADDRESS,
} from "../../config/env";
import { generateSecrets, storeSecret } from "./crypto";

// Real 1inch SDK imports - using installed packages
import {
  AuctionDetails,
  EvmCrossChainOrder as CrossChainOrder,
  EvmAddress,
  HashLock,
  TimeLocks,
  randBigInt,
} from "@1inch/cross-chain-sdk";

import { TOKEN_MAPPINGS } from "./tokenMapping";
import {
  AllowanceState,
  approveTokenAllowance,
  checkTokenAllowance,
} from "./tokenUtils";

// Import types from dedicated types folder
import { UINT_40_MAX } from "@1inch/byte-utils";
import {
  CrossChainOrderInfo,
  Details,
  EscrowParams,
  Extra,
  FlowStep,
  FormData,
} from "../types/flow";

// Helper function to detect if an address is Aptos-style (non-EVM)
function isAptosAddress(address: string): boolean {
  if (!address) return false;

  // Check if it contains Move module syntax (::)
  if (address.includes("::")) return true;

  // Check if it's longer than EVM address (EVM = 42 chars, Aptos can be 64+ chars)
  if (address.startsWith("0x") && address.length > 42) return true;

  return false;
}

// Helper function to detect if a chain is non-EVM
function isNonEvmChain(chainId: number): boolean {
  return chainId === 1000; // Aptos chain ID
}

// Utility function to get token decimals
function getTokenDecimals(tokenAddress: string): number {
  const mapping = TOKEN_MAPPINGS.find(
    (token) =>
      token.localAddress.toLowerCase() === tokenAddress.toLowerCase() ||
      token.mainnetAddress.toLowerCase() === tokenAddress.toLowerCase()
  );
  return mapping?.decimals || 18; // Default to 18 if not found
}

// Create NonEvmDstExtension for Aptos metadata using 1inch utilities
function createNonEvmDstExtension(formData: FormData): {
  extensionBytes: string;
  metadata: any;
} {
  // Check if this is a cross-chain order to Aptos using improved detection
  const isDestinationNonEvm =
    isNonEvmChain(formData.chainOut) || isAptosAddress(formData.buyToken);

  if (isDestinationNonEvm) {
    // Use real Aptos chain ID - prioritize chainOut if it's Aptos, otherwise use aptosChainId field
    const aptosChainId = isNonEvmChain(formData.chainOut)
      ? formData.chainOut
      : formData.aptosChainId || 48; // Default to testnet if no specific Aptos ID
    const aptosCoinType = formData.aptosCoinType || formData.buyToken; // Use buyToken as fallback
    const aptosReceiver =
      formData.aptosReceiver || formData.destinationAddress || ""; // Use destinationAddress as fallback

    const metadata = {
      type: "NonEvmDstExtension",
      version: 1,
      chainId: aptosChainId,
      coinType: aptosCoinType,
      receiver: aptosReceiver,
    };

    // Encode the extension as hex bytes according to 1inch protocol
    // Format: [type:2bytes][version:1byte][chainId:4bytes][coinTypeLength:1byte][coinType:variable][receiver:32bytes]
    const typeHex = "4E45"; // "NE" in hex for NonEvm
    const versionHex = "01"; // Version 1
    const chainIdHex = aptosChainId.toString(16).padStart(8, "0");
    const coinTypeBytes = ethers.toUtf8Bytes(aptosCoinType);
    const coinTypeLengthHex = coinTypeBytes.length
      .toString(16)
      .padStart(2, "0");
    const coinTypeHex = ethers.hexlify(coinTypeBytes).slice(2); // Remove 0x prefix
    const receiverHex = aptosReceiver.replace(/^0x/, "").padStart(64, "0"); // Ensure 32 bytes

    const extensionBytes =
      "0x" +
      typeHex +
      versionHex +
      chainIdHex +
      coinTypeLengthHex +
      coinTypeHex +
      receiverHex;

    return { extensionBytes, metadata };
  }

  return { extensionBytes: "0x", metadata: null }; // Empty extension for non-Aptos chains
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

    const result = await checkTokenAllowance(account, tokenAddress, amount);
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

      const isCrossChain = formData.chainIn !== formData.chainOut;

      if (!isCrossChain) {
        throw new Error(
          "❌ Same-chain swaps are not supported! Please select different source and destination chains."
        );
      }

      if (!formData.secretHash) {
        throw new Error(
          "❌ Secret hash is required for cross-chain orders! Please generate a secret first."
        );
      }

      const {
        order: crossChainOrder,
        merkleSecrets,
        escrowParams,
        auctionStartTime,
        auctionDuration,
        timelockValues,
      } = await this.buildCrossChainOrder(
        account,
        formData,
        currentChainId,
        provider
      );

      // Get EIP-712 typed data for signing
      console.log("getting typed data for", currentChainId);
      const { domain, types, message } =
        // crossChainOrder.getTypedData(currentChainId);
        crossChainOrder.getTypedData(1); // TODO: hardcoded ETH Mainnet chain

      // Remove EIP712Domain to avoid ambiguity (ethers-v6 requirement)
      const orderTypes = { Order: types.Order };

      console.log("domain", domain);
      console.log("orderTypes", orderTypes);
      console.log("message", message);
      // Sign with EIP-712 typed data
      const signature = await signer.signTypedData(domain, orderTypes, message);

      // Submit to API with new payload structure including timelock data
      const requestBody = {
        order: crossChainOrder.build(),
        extension: (crossChainOrder as any)._combinedExtensionBytes
          ? {
              ...crossChainOrder.extension,
              _combinedBytes: (crossChainOrder as any)._combinedExtensionBytes,
              _nonEvmMetadata: (crossChainOrder as any)
                ._nonEvmExtensionMetadata,
            }
          : crossChainOrder.extension,
        signature,
        hash: formData.secretHash,
        // Include chain IDs
        srcChain: formData.chainIn,
        dstChain: formData.chainOut,
        // Include timelock data from actual values
        srcTimelock: timelockValues.srcPublicWithdrawal,
        dstTimelock: timelockValues.dstPublicWithdrawal,
        srcWithdrawal: timelockValues.srcWithdrawal,
        srcPublicWithdrawal: timelockValues.srcPublicWithdrawal,
        srcCancellation: timelockValues.srcCancellation,
        srcPublicCancellation: timelockValues.srcPublicCancellation,
        dstWithdrawal: timelockValues.dstWithdrawal,
        dstPublicWithdrawal: timelockValues.dstPublicWithdrawal,
        dstCancellation: timelockValues.dstCancellation,
        srcSafetyDeposit: escrowParams.srcSafetyDeposit.toString(),
        dstSafetyDeposit: escrowParams.dstSafetyDeposit.toString(),
        // Include escrow targets
        srcEscrowTarget: account, // Default to maker address
        dstEscrowTarget: formData.destinationAddress || account, // Use destination or fallback to maker
        // Include auction data from actual values
        auctionStartTime: Number(auctionStartTime),
        auctionDuration: Number(auctionDuration),
        startRate: "1.0",
        endRate: "1.0",
        finalityLock: 300,
        fillThresholds: [25, 50, 75, 100],
        expiration: Number(auctionStartTime) + Number(auctionDuration) + 86400, // auction + 24h
      };

      const response = await fetch("/api/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (response.ok) {
        // Store secret(s) for later use during settlement
        if (result.orderHash) {
          if (merkleSecrets) {
            // Store all secrets for partial fills
            merkleSecrets.secrets.forEach((secret: string, index: number) => {
              storeSecret(`${result.orderHash}_${index}`, secret);
            });
            // Also store the merkle root and tree structure
            storeSecret(
              `${result.orderHash}_merkle`,
              JSON.stringify({
                root: merkleSecrets.merkleRoot,
                tree: merkleSecrets.tree,
                hashes: merkleSecrets.hashes,
              })
            );
          } else if (formData.secret) {
            // Store single secret for non-partial fills
            storeSecret(result.orderHash, formData.secret);
            console.log("✅ Secret stored for order:", result.orderHash);
          }
        }

        toast.success("🚀 Cross-chain order broadcasted to the grid!");
        this.resetFlow();
        loadIntents();
        loadUserBalances(account);
      } else {
        toast.error(result.error || "Failed to submit cross-chain order");
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

  // Build REAL CrossChainOrder using 1inch SDK
  private async buildCrossChainOrder(
    account: string,
    formData: FormData,
    srcChainId: number,
    provider: ethers.Provider
  ): Promise<{
    order: CrossChainOrder;
    merkleSecrets?: any;
    escrowParams: EscrowParams;
    auctionStartTime: bigint;
    auctionDuration: bigint;
    timelockValues: {
      srcWithdrawal: number;
      srcPublicWithdrawal: number;
      srcCancellation: number;
      srcPublicCancellation: number;
      dstWithdrawal: number;
      dstPublicWithdrawal: number;
      dstCancellation: number;
    };
  }> {
    // Get correct token decimals
    const makerTokenDecimals = getTokenDecimals(formData.sellToken);
    const takerTokenDecimals = getTokenDecimals(formData.buyToken);

    const isSourceNonEvm = false;
    // isNonEvmChain(formData.chainIn) ||
    // isAptosAddress(formData.sellToken) ||
    // (account && isAptosAddress(account));
    const isDestinationNonEvm = true;
    // const isDestinationNonEvm =
    //   isNonEvmChain(formData.chainOut) ||
    //   isAptosAddress(formData.buyToken) ||
    //   (formData.destinationAddress &&
    //     isAptosAddress(formData.destinationAddress));

    // Build CrossChainOrderInfo
    const makingAmount = ethers.parseUnits(
      formData.sellAmount,
      makerTokenDecimals
    );
    const takingAmount = ethers.parseUnits(
      formData.minBuyAmount,
      takerTokenDecimals
    );
    // // Use proper 40-bit random for salt (like working example)
    // const saltMax = BigInt("0xffffffffff");
    // const salt = BigInt(Math.floor(Math.random() * Number(saltMax))); // 40-bit max
    const salt = randBigInt(BigInt(1000));

    const orderInfo: CrossChainOrderInfo = {
      makerAsset: EvmAddress.fromString(formData.sellToken),
      takerAsset: EvmAddress.fromString(ZERO_ADDRESS),
      makingAmount,
      takingAmount,
      maker: EvmAddress.fromString(account),
      receiver: EvmAddress.fromString(ZERO_ADDRESS),
      salt,
    };

    // Handle multiple fills with Merkle tree
    if (!formData.secretHash) {
      throw new Error("Secret hash is required and missing");
    }
    let secretHash = formData.secretHash;
    let merkleSecrets: any = null;

    merkleSecrets = generateSecrets(4); // 4 secrets for 25%, 50%, 75%, 100% fills
    secretHash = merkleSecrets.merkleRoot;

    const srcChainIdForOrder = formData.chainIn;
    // isNonEvmChain(formData.chainIn)
    //   ? (56 as NetworkEnum) // Use BSC as placeholder for non-EVM source chains
    //   : (formData.chainIn as NetworkEnum);
    const dstChainIdForOrder = 56;
    // isNonEvmChain(formData.chainOut)
    //   ? (56 as NetworkEnum) // Use BSC as placeholder for non-EVM destination chains
    //   : (formData.chainOut as NetworkEnum);

    const safetyDepositAmount = ethers.parseEther("0.01");

    // Define timelock values
    const timelockValues = {
      srcWithdrawal: 10, // 10sec finality lock for test
      srcPublicWithdrawal: 120, // 2m for private withdrawal
      srcCancellation: 121, // 1sec public withdrawal
      srcPublicCancellation: 122, // 1sec private cancellation
      dstWithdrawal: 10, // 10sec finality lock for test
      dstPublicWithdrawal: 100, // 100sec private withdrawal
      dstCancellation: 101, // 1sec public withdrawal
    };

    const escrowParams: EscrowParams = {
      hashLock: HashLock.fromString(secretHash),
      srcChainId: srcChainIdForOrder,
      dstChainId: dstChainIdForOrder,
      srcSafetyDeposit: safetyDepositAmount,
      dstSafetyDeposit: safetyDepositAmount,
      timeLocks: TimeLocks.new({
        srcWithdrawal: BigInt(timelockValues.srcWithdrawal),
        srcPublicWithdrawal: BigInt(timelockValues.srcPublicWithdrawal),
        srcCancellation: BigInt(timelockValues.srcCancellation),
        srcPublicCancellation: BigInt(timelockValues.srcPublicCancellation),
        dstWithdrawal: BigInt(timelockValues.dstWithdrawal),
        dstPublicWithdrawal: BigInt(timelockValues.dstPublicWithdrawal),
        dstCancellation: BigInt(timelockValues.dstCancellation),
      }),
    };
    console.log("escrowParams", escrowParams);

    // Build auction details
    // Get current block timestamp using eth call
    const auctionStartTime = BigInt(
      (await provider.getBlock("latest"))?.timestamp || 0
    );

    console.log("auction start time is: ", auctionStartTime);
    const auctionDuration = BigInt(parseInt(formData.decayPeriod) || 3600);

    // Validate all values before creating AuctionDetails
    if (!auctionStartTime || !auctionDuration) {
      throw new Error("Invalid auction timing parameters");
    }

    const auction = new AuctionDetails({
      initialRateBump: 0,
      points: [],
      duration: auctionDuration,
      startTime: auctionStartTime,
    });

    const resolvingStartTime = BigInt(0); // Use 0n like the working example

    const details: Details = {
      auction,
      whitelist: [
        {
          address: EvmAddress.fromString(RESOLVER_ADDRESS),
          allowFrom: BigInt(0), // No time restriction - resolver can fulfill immediately
        },
      ],
      resolvingStartTime,
    };

    const nonce = randBigInt(UINT_40_MAX);

    const extra: Extra = {
      nonce,
      allowPartialFills: true,
      allowMultipleFills: true,
    };

    try {
      // Create NonEvmDstExtension for Aptos metadata if needed
      const nonEvmExtension = createNonEvmDstExtension(formData);

      const crossChainOrder = CrossChainOrder.new(
        EvmAddress.fromString(ETH_FACTORY_ADDRESS),
        orderInfo,
        escrowParams,
        details,
        extra
      );
      console.log("createdCrossChainOrder", JSON.stringify(crossChainOrder));

      // Apply NonEvmDstExtension if needed (TODO: use SDK method when available)
      if (nonEvmExtension.extensionBytes !== "0x") {
        // Store extension metadata for later use
        (crossChainOrder as any)._nonEvmExtensionMetadata =
          nonEvmExtension.metadata;
      }

      return {
        order: crossChainOrder,
        merkleSecrets, // Include merkle data for multiple fills
        escrowParams,
        auctionStartTime,
        auctionDuration,
        timelockValues,
      };
    } catch (error) {
      console.error("❌ Failed to build REAL CrossChainOrder:", error);
      console.error("❌ Error details:", {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw new Error(
        "Failed to build cross-chain order: " + (error as Error).message
      );
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

// Get default form data
export function getDefaultFormData(): FormData {
  return {
    chainIn: 1, // Ethereum
    chainOut: 1000, // Aptos
    sellToken: USDC_ADDRESS, // USDC on Ethereum
    sellAmount: "1", // Default to 1 USDC
    buyToken: USDC_APTOS_ADDRESS, // USDC on Aptos
    minBuyAmount: "1", // Default to 1 USDC
    deadline: "1", // 1 hour
    // Dutch auction defaults (remove fixed option)
    auctionType: "dutch",
    startPricePremium: "10", // 10% above market
    minPriceDiscount: "5", // 5% below market
    decayRate: "0.02", // 2% per second
    decayPeriod: "300", // 5 minutes (reasonable test duration)
    // Default destination address for Aptos
    destinationAddress:
      "0x44689d8f78944f57e1d84bfa1d9f4042d20d7e22c3ec0fe93a05b8035c7712c1",
  };
}

/**
 * Get default cross-chain order parameters
 */
export function getDefaultCrossChainParams() {
  return {
    // Default timelock values (in seconds)
    srcTimelock: 3600, // 1 hour for source chain (must be > dstTimelock)
    dstTimelock: 1800, // 30 minutes for destination chain

    // Default safety deposit amounts (in wei)
    srcSafetyDeposit: ethers.parseEther("0.1").toString(), // 0.1 ETH equivalent
    dstSafetyDeposit: ethers.parseEther("0.1").toString(), // 0.1 ETH equivalent

    // Default auction duration (1 hour)
    auctionDuration: 3600,
  };
}
