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
  NetworkEnum,
  TimeLocks,
} from "@1inch/cross-chain-sdk";

import { TOKEN_MAPPINGS } from "./tokenMapping";
import {
  AllowanceState,
  approveTokenAllowance,
  checkTokenAllowance,
} from "./tokenUtils";

// Import types from dedicated types folder
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

    console.log("🔧 Creating NonEvmDstExtension with real chain ID:", {
      formDataChainOut: formData.chainOut,
      finalAptosChainId: aptosChainId,
      aptosCoinType,
      aptosReceiver,
    });

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

    console.log("✅ NonEvmDstExtension created:", {
      extensionBytes,
      length: extensionBytes.length,
    });

    return { extensionBytes, metadata };
  }

  return { extensionBytes: "0x", metadata: null }; // Empty extension for non-Aptos chains
}

// Enhanced CrossChainOrder creation that properly handles extensions
function createCrossChainOrderWithExtension(
  ESCROW_FACTORY_ADDRESS: string,
  orderInfo: CrossChainOrderInfo,
  escrowParams: EscrowParams,
  details: Details,
  extra: Extra,
  nonEvmExtension: { extensionBytes: string; metadata: any }
): CrossChainOrder {
  console.log("🔧 createCrossChainOrderWithExtension called with:", {
    factoryAddress: ESCROW_FACTORY_ADDRESS,
    hasNonEvmExtension: nonEvmExtension.extensionBytes !== "0x",
    extensionLength: nonEvmExtension.extensionBytes.length,
  });

  // If we have a NonEvmDstExtension, we need to customize the order creation
  if (nonEvmExtension.extensionBytes !== "0x") {
    console.log("🔧 Creating CrossChainOrder with NonEvmDstExtension...");

    try {
      // Create the base CrossChainOrder first
      console.log("🔧 Calling CrossChainOrder.new()...");
      const baseOrder = CrossChainOrder.new(
        EvmAddress.fromString(ESCROW_FACTORY_ADDRESS),
        orderInfo,
        escrowParams,
        details,
        extra
      );

      console.log("🔧 Base order created successfully");
      console.log("🔧 Base order properties:", {
        hasExtension: !!baseOrder.extension,
        extensionType: typeof baseOrder.extension,
      });

      // Get the base extension data
      console.log("🔧 Encoding base extension...");
      const baseExtensionBytes = baseOrder.extension.encode();
      console.log("🔧 Base extension bytes:", baseExtensionBytes);

      // Combine the base extension with the NonEvmDstExtension
      const combinedExtensionBytes =
        baseExtensionBytes + nonEvmExtension.extensionBytes.slice(2);
      console.log("🔧 Combined extension bytes:", combinedExtensionBytes);

      // Store the combined extension on the order
      (baseOrder as any)._combinedExtensionBytes = combinedExtensionBytes;
      (baseOrder as any)._nonEvmExtensionMetadata = nonEvmExtension.metadata;

      console.log("✅ Combined extension created:", {
        base: baseExtensionBytes,
        nonEvm: nonEvmExtension.extensionBytes,
        combined: combinedExtensionBytes,
        metadata: nonEvmExtension.metadata,
      });

      return baseOrder;
    } catch (error) {
      console.error("❌ Error in NonEvmDstExtension path:", error);
      throw error;
    }
  }

  // For orders without NonEvmDstExtension, use standard creation
  console.log(
    "🔧 Creating standard CrossChainOrder (no NonEvmDstExtension)..."
  );

  try {
    const order = CrossChainOrder.new(
      EvmAddress.fromString(ESCROW_FACTORY_ADDRESS),
      orderInfo,
      escrowParams,
      details,
      extra
    );

    console.log("✅ Standard CrossChainOrder created successfully");
    return order;
  } catch (error) {
    console.error("❌ Error in standard path:", error);
    throw error;
  }
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

      // ONLY CROSS-CHAIN ORDERS ARE SUPPORTED!
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

      // Use REAL CrossChainOrder.new() for ALL orders
      console.log("🚀 Building cross-chain order using REAL 1inch SDK...");

      const { order: crossChainOrder, merkleSecrets } =
        this.buildCrossChainOrder(account, formData, currentChainId);

      // Get EIP-712 typed data for signing
      const { domain, types, message } =
        crossChainOrder.getTypedData(currentChainId);
      console.log("🔐 EIP-712 domain:", domain);
      console.log("🔐 EIP-712 types:", types);
      console.log("🔐 EIP-712 message:", message);

      // Remove EIP712Domain to avoid ambiguity (ethers-v6 requirement)
      const orderTypes = { Order: types.Order };

      // Sign with EIP-712 typed data
      const signature = await signer.signTypedData(domain, orderTypes, message);
      console.log("✅ EIP-712 signature created successfully");

      // Submit to API with new payload structure
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
            console.log(
              "✅ Merkle secrets stored for order:",
              result.orderHash
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
  private buildCrossChainOrder(
    account: string,
    formData: FormData,
    srcChainId: number
  ): {
    order: CrossChainOrder;
    merkleSecrets?: any;
  } {
    console.log("🚀 Starting CrossChainOrder build process...");
    console.log("📋 Form data:", {
      chainIn: formData.chainIn,
      chainOut: formData.chainOut,
      sellToken: formData.sellToken,
      buyToken: formData.buyToken,
      sellAmount: formData.sellAmount,
      minBuyAmount: formData.minBuyAmount,
      auctionType: formData.auctionType,
      account,
      srcChainId,
    });

    const ESCROW_FACTORY_ADDRESS = ETH_FACTORY_ADDRESS;
    console.log("🏭 Using EscrowFactory address:", ESCROW_FACTORY_ADDRESS);

    // Get correct token decimals
    const makerTokenDecimals = getTokenDecimals(formData.sellToken);
    const takerTokenDecimals = getTokenDecimals(formData.buyToken);

    console.log("💰 Token decimals:", {
      sellToken: formData.sellToken,
      sellTokenDecimals: makerTokenDecimals,
      buyToken: formData.buyToken,
      buyTokenDecimals: takerTokenDecimals,
    });

    // Check for non-EVM chains and addresses using improved detection
    const isSourceNonEvm =
      isNonEvmChain(formData.chainIn) ||
      isAptosAddress(formData.sellToken) ||
      (account && isAptosAddress(account));
    const isDestinationNonEvm =
      isNonEvmChain(formData.chainOut) ||
      isAptosAddress(formData.buyToken) ||
      (formData.destinationAddress &&
        isAptosAddress(formData.destinationAddress));

    if (isSourceNonEvm) {
      console.log("🔗 Detected non-EVM source:", {
        chainIn: formData.chainIn,
        sellToken: formData.sellToken,
        account: account,
        message:
          "Source chain or addresses are non-EVM - this may not be fully supported yet",
      });
    }

    if (isDestinationNonEvm) {
      console.log("🔗 Detected non-EVM destination:", {
        chainOut: formData.chainOut,
        buyToken: formData.buyToken,
        destinationAddress: formData.destinationAddress,
        message:
          "Using zero address for EVM field, real address will be in extension",
      });
    }

    // For cross-chain orders involving non-EVM chains, we may need special handling
    if (isSourceNonEvm && isDestinationNonEvm) {
      throw new Error(
        "❌ Non-EVM to Non-EVM swaps are not supported yet. Please use at least one EVM chain."
      );
    }

    if (isSourceNonEvm) {
      throw new Error(
        "❌ Non-EVM source chains are not fully supported yet. Please start from an EVM chain."
      );
    }

    // Build CrossChainOrderInfo
    const makingAmount = ethers.parseUnits(
      formData.sellAmount,
      makerTokenDecimals
    );
    const takingAmount = ethers.parseUnits(
      formData.minBuyAmount,
      takerTokenDecimals
    );
    // Use proper 40-bit random for salt (like working example)
    const saltMax = BigInt("0xffffffffff");
    const salt = BigInt(Math.floor(Math.random() * Number(saltMax))); // 40-bit max

    console.log("💱 Parsed amounts:", {
      sellAmount: formData.sellAmount,
      makingAmount: makingAmount.toString(),
      minBuyAmount: formData.minBuyAmount,
      takingAmount: takingAmount.toString(),
      salt: salt.toString(),
      saltHex: `0x${salt.toString(16)}`,
      saltBits: salt.toString(16).length * 4,
      maxAllowed: "0xffffffffff (40 bits)",
    });

    const orderInfo: CrossChainOrderInfo = {
      // For non-EVM source assets, use zero address (but we're blocking this case above for now)
      makerAsset: isAptosAddress(formData.sellToken)
        ? EvmAddress.fromString(ZERO_ADDRESS)
        : EvmAddress.fromString(formData.sellToken),
      // For non-EVM destinations, use zero address in EVM field - real address goes in extension
      takerAsset: isDestinationNonEvm
        ? EvmAddress.fromString(ZERO_ADDRESS)
        : EvmAddress.fromString(formData.buyToken),
      makingAmount,
      takingAmount,
      // For non-EVM maker, use zero address (but we're blocking this case above for now)
      maker: isAptosAddress(account)
        ? EvmAddress.fromString(ZERO_ADDRESS)
        : EvmAddress.fromString(account),
      receiver: formData.destinationAddress
        ? isAptosAddress(formData.destinationAddress)
          ? undefined // Non-EVM receiver goes in extension
          : EvmAddress.fromString(formData.destinationAddress)
        : undefined,
      salt,
    };

    console.log("📦 CrossChainOrderInfo built:", {
      makerAsset: orderInfo.makerAsset.toString(),
      takerAsset: orderInfo.takerAsset.toString(),
      makingAmount: orderInfo.makingAmount.toString(),
      takingAmount: orderInfo.takingAmount.toString(),
      maker: orderInfo.maker.toString(),
      receiver: orderInfo.receiver?.toString() || "undefined",
      salt: orderInfo.salt?.toString() || "undefined",
    });

    // Handle multiple fills with Merkle tree
    let secretHash =
      formData.secretHash ||
      "0x0000000000000000000000000000000000000000000000000000000000000000";
    let merkleSecrets: any = null;

    if (formData.multipleFillsAllowed) {
      // Generate multiple secrets and Merkle tree for partial fills
      merkleSecrets = generateSecrets(4); // 4 secrets for 25%, 50%, 75%, 100% fills
      secretHash = merkleSecrets.merkleRoot;
      console.log("🌳 Generated Merkle tree for partial fills:", {
        root: merkleSecrets.merkleRoot,
        leaves: merkleSecrets.hashes,
      });
    }

    // Build EscrowParams
    // For non-EVM chains, use placeholder EVM chain IDs and pass real IDs through extension
    const srcChainIdForOrder = isNonEvmChain(formData.chainIn)
      ? (56 as NetworkEnum) // Use BSC as placeholder for non-EVM source chains
      : (formData.chainIn as NetworkEnum);
    const dstChainIdForOrder = isNonEvmChain(formData.chainOut)
      ? (56 as NetworkEnum) // Use BSC as placeholder for non-EVM destination chains
      : (formData.chainOut as NetworkEnum);

    console.log("🔗 Chain ID mapping:", {
      originalSrc: formData.chainIn,
      mappedSrc: srcChainIdForOrder,
      originalDst: formData.chainOut,
      mappedDst: dstChainIdForOrder,
      message:
        "Using EVM placeholder IDs for non-EVM chains, real IDs go in extension",
    });

    const srcSafetyDeposit = ethers.parseEther(
      formData.srcSafetyDeposit || "0.1"
    );
    const dstSafetyDeposit = ethers.parseEther(
      formData.dstSafetyDeposit || "0.1"
    );

    console.log("🔒 Building EscrowParams:", {
      secretHash,
      srcChainId: srcChainIdForOrder,
      dstChainId: dstChainIdForOrder,
      srcSafetyDeposit: srcSafetyDeposit.toString(),
      dstSafetyDeposit: dstSafetyDeposit.toString(),
    });

    const escrowParams: EscrowParams = {
      hashLock: HashLock.fromString(secretHash),
      srcChainId: srcChainIdForOrder,
      dstChainId: dstChainIdForOrder,
      srcSafetyDeposit,
      dstSafetyDeposit,
      timeLocks: TimeLocks.new({
        srcWithdrawal: BigInt(1800), // 30 minutes
        srcPublicWithdrawal: BigInt(3600), // 1 hour
        srcCancellation: BigInt(7200), // 2 hours
        srcPublicCancellation: BigInt(14400), // 4 hours
        dstWithdrawal: BigInt(900), // 15 minutes
        dstPublicWithdrawal: BigInt(1800), // 30 minutes
        dstCancellation: BigInt(3600), // 1 hour
      }),
    };

    console.log("✅ EscrowParams created successfully");

    // Build auction details
    const auctionStartTime = BigInt(
      Math.floor(Date.now() / 1000) +
        parseInt(formData.auctionStartDelay || "0")
    );
    const auctionDuration = BigInt(parseInt(formData.decayPeriod) || 3600);

    // Build auction - using exact pattern from working example
    // NOTE: Using empty points array and initialRateBump=0 to match working resolver pattern

    if (formData.auctionType === "dutch") {
      console.log(
        "🔧 Dutch auction requested but using flat rate (like working example):",
        {
          auctionDuration: auctionDuration.toString(),
          startPricePremium: formData.startPricePremium,
          minPriceDiscount: formData.minPriceDiscount,
          note: "Using initialRateBump=0 and empty points array to match working example",
        }
      );
    }

    console.log("🔧 Creating AuctionDetails with:", {
      startTime: auctionStartTime.toString(),
      duration: auctionDuration.toString(),
      initialRateBump: 0,
      pointsCount: 0,
      note: "Using exact pattern from working example",
    });

    // Validate all values before creating AuctionDetails
    if (!auctionStartTime || !auctionDuration) {
      throw new Error("Invalid auction timing parameters");
    }

    // No validation needed - using empty points array like working example

    console.log("🔧 Final AuctionDetails constructor parameters:", {
      startTime: auctionStartTime.toString(),
      duration: auctionDuration.toString(),
      initialRateBump: 0,
      pointsCount: 0,
      note: "Matching working example exactly",
    });

    const auction = new AuctionDetails({
      startTime: auctionStartTime,
      duration: auctionDuration,
      initialRateBump: 0, // Always use 0 like the working example
      points: [], // Always use empty array like the working example
    });

    // Build Details with proper resolver whitelist
    const resolverAddress = RESOLVER_ADDRESS;

    console.log("🔓 Setting up order whitelist:", {
      resolverAddress,
      allowFrom: "BigInt(0) (no time restriction)",
      purpose: "Allow specific resolver to fulfill this order",
    });

    const resolvingStartTime = BigInt(0); // Use 0n like the working example

    console.log("🔓 Building Details with whitelist:", {
      resolverAddress,
      allowFrom: "BigInt(0) (no time restriction)",
      resolvingStartTime: resolvingStartTime.toString(),
      bankFee: "10 bps (0.1%)",
    });

    const details: Details = {
      auction,
      fees: {
        bankFee: BigInt(10), // 0.1% (10 basis points)
        integratorFee: undefined, // No integrator fee for now
      },
      // SDK requires whitelist with resolver addresses in specific format
      whitelist: [
        {
          address: EvmAddress.fromString(resolverAddress),
          allowFrom: BigInt(0), // No time restriction - resolver can fulfill immediately
        },
      ],
      resolvingStartTime,
    };

    console.log("✅ Details created successfully");

    // Build Extra parameters
    // Use proper 40-bit random for nonce (like working example)
    const MAX_40_BIT = BigInt("0xffffffffff");
    let nonce: bigint;
    if (formData.nonce !== undefined && formData.nonce !== null) {
      const provided = BigInt(formData.nonce);
      if (provided <= MAX_40_BIT) {
        nonce = provided;
      } else {
        console.warn(
          "⚠️ Provided nonce is larger than 40-bit, generating new random 40-bit nonce instead.",
          provided.toString()
        );
        nonce = BigInt(Math.floor(Math.random() * Number(MAX_40_BIT)));
      }
    } else {
      nonce = BigInt(Math.floor(Math.random() * Number(MAX_40_BIT)));
    }
    const orderExpirationDelay = BigInt(parseInt(formData.deadline) * 3600);

    console.log("⚙️ Building Extra parameters:", {
      nonce: nonce.toString(),
      nonceHex: `0x${nonce.toString(16)}`,
      nonceBits: nonce.toString(16).length * 4,
      orderExpirationDelay: orderExpirationDelay.toString(),
      allowPartialFills: formData.partialFillAllowed || false,
      allowMultipleFills: formData.multipleFillsAllowed || false,
      deadline: formData.deadline,
      maxAllowed: "0xffffffffff (40 bits)",
    });

    const extra: Extra = {
      nonce,
      orderExpirationDelay,
      allowPartialFills: formData.partialFillAllowed || false,
      allowMultipleFills: formData.multipleFillsAllowed || false,
    };

    console.log("✅ Extra parameters created successfully");

    try {
      console.log("🔧 Starting final order assembly...");

      // Create NonEvmDstExtension for Aptos metadata if needed
      const nonEvmExtension = createNonEvmDstExtension(formData);
      console.log("🔧 NonEvmExtension created:", {
        hasExtension: nonEvmExtension.extensionBytes !== "0x",
        extensionLength: nonEvmExtension.extensionBytes.length,
      });

      // Create REAL CrossChainOrder using enhanced function with extension support
      console.log("🔧 Calling createCrossChainOrderWithExtension...");
      const crossChainOrder = createCrossChainOrderWithExtension(
        ESCROW_FACTORY_ADDRESS,
        orderInfo,
        escrowParams,
        details,
        extra,
        nonEvmExtension
      );

      console.log("✅ REAL CrossChainOrder created successfully!");
      console.log("📋 Final order summary:", {
        orderType: "CrossChainOrder",
        hasExtension: !!(crossChainOrder as any)._combinedExtensionBytes,
        merkleSecrets: !!merkleSecrets,
      });

      return {
        order: crossChainOrder,
        merkleSecrets, // Include merkle data for multiple fills
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

// ===== CROSS-CHAIN ORDER UTILITY FUNCTIONS =====

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
