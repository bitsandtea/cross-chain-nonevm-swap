import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import {
  RESOLVER_ADDRESS,
  USDC_ADDRESS,
  USDC_APTOS_ADDRESS,
  ZERO_ADDRESS,
} from "../../config/env";
import { generateSecrets, storeSecret } from "./crypto";

import {
  AuctionDetails,
  EvmCrossChainOrder as CrossChainOrder,
  EvmAddress,
  HashLock,
  randBigInt,
  TimeLocks,
} from "@1inch/cross-chain-sdk";

import { EIP712TypedData } from "@1inch/fusion-sdk";

// Declare window.ethereum for TypeScript
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
    };
  }
}

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

interface BlockchainProviderConnector {
  signTypedData(
    walletAddress: string,
    typedData: EIP712TypedData
  ): Promise<string>;
}

interface OrderStruct {
  maker: string;
  // ... other order properties
}

interface Order {
  getTypedData(srcChainId: number): EIP712TypedData;
  build(): OrderStruct;
  // ... other order methods
}

interface Config {
  blockchainProvider: BlockchainProviderConnector;
}

async function signOrder(
  config: Config,
  orderStruct: OrderStruct,
  order: Order,
  srcChainId: number
): Promise<string> {
  if (!config.blockchainProvider) {
    throw new Error("blockchainProvider has not been set to config");
  }

  const signature = await config.blockchainProvider.signTypedData(
    orderStruct.maker,
    order.getTypedData(srcChainId)
  );

  return signature;
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // Use the actual current network chain ID as source chain
      const actualSrcChainId = currentChainId;

      const isCrossChain = actualSrcChainId !== formData.chainOut;

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
      //lets generate these once ONLY
      const UINT_40_MAX = (BigInt(1) << BigInt(40)) - BigInt(1);
      const salt = randBigInt(UINT_40_MAX);
      const nonce = randBigInt(UINT_40_MAX);

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
        actualSrcChainId, // Use actual source chain ID
        provider,
        salt,
        nonce
      );

      const orderStruct = crossChainOrder.build();

      // Create blockchain provider connector for MetaMask
      const blockchainProvider: BlockchainProviderConnector = {
        signTypedData: async (
          walletAddress: string,
          typedData: EIP712TypedData
        ) => {
          // Check if MetaMask is available
          if (!window.ethereum) {
            throw new Error("MetaMask is not installed");
          }

          // Request account access if not already connected
          const accounts = (await window.ethereum.request({
            method: "eth_requestAccounts",
          })) as string[];

          if (!accounts || accounts.length === 0) {
            throw new Error("No accounts found");
          }

          const account = accounts[0];

          // Sign the typed data using MetaMask
          const signature = (await window.ethereum.request({
            method: "eth_signTypedData_v4",
            params: [account, JSON.stringify(typedData)],
          })) as string;

          return signature;
        },
      };

      const config: Config = { blockchainProvider };

      // Use buildOrderTypedData approach instead of order.getTypedData()
      const { buildOrderTypedData } = await import("@1inch/limit-order-sdk");

      const typedData = buildOrderTypedData(
        currentChainId,
        process.env.NEXT_PUBLIC_LOP_ADDRESS || "",
        "1inch Limit Order Protocol",
        "4",
        orderStruct
      );

      const domainForSignature = {
        ...typedData.domain,
        chainId: currentChainId,
      };

      // Sign using MetaMask with the correct typed data structure
      const signature = (await window.ethereum.request({
        method: "eth_signTypedData_v4",
        params: [
          account,
          JSON.stringify({
            domain: domainForSignature,
            types: typedData.types,
            primaryType: "Order",
            message: typedData.message,
          }),
        ],
      })) as string;

      // Patch the order hash method to ensure consistency
      (crossChainOrder as any).getOrderHash = (_srcChainId: number) => {
        return ethers.TypedDataEncoder.hash(
          domainForSignature,
          { Order: typedData.types.Order },
          typedData.message
        );
      };

      // Serialize the signed order immediately after signing (Part 1 from PassTheOrder.md)
      // Store all constructor parameters needed to reconstruct the CrossChainOrder
      const sdkOrderEncoded = JSON.stringify({
        factoryAddress: process.env.NEXT_PUBLIC_LOP_ADDRESS || "",
        orderInfo: {
          makerAsset: formData.sellToken,
          takerAsset: ZERO_ADDRESS,
          makingAmount: ethers
            .parseUnits(
              formData.sellAmount,
              getTokenDecimals(formData.sellToken)
            )
            .toString(),
          takingAmount: ethers
            .parseUnits(
              formData.minBuyAmount,
              getTokenDecimals(formData.buyToken)
            )
            .toString(),
          maker: account,
          receiver: ZERO_ADDRESS,
          salt: salt.toString(),
        },
        escrowParams: {
          hashLock: merkleSecrets.merkleRoot,
          srcChainId: actualSrcChainId, // Use actual current chain ID for storage
          dstChainId: formData.chainOut === 1000 ? 56 : formData.chainOut, // bsc because the sdk doesn't accept 1000
          srcSafetyDeposit: escrowParams.srcSafetyDeposit.toString(),
          dstSafetyDeposit: escrowParams.dstSafetyDeposit.toString(),
          timeLocks: {
            srcWithdrawal: timelockValues.srcWithdrawal,
            srcPublicWithdrawal: timelockValues.srcPublicWithdrawal,
            srcCancellation: timelockValues.srcCancellation,
            srcPublicCancellation: timelockValues.srcPublicCancellation,
            dstWithdrawal: timelockValues.dstWithdrawal,
            dstPublicWithdrawal: timelockValues.dstPublicWithdrawal,
            dstCancellation: timelockValues.dstCancellation,
          },
        },
        details: {
          auction: {
            initialRateBump: 0,
            points: [],
            duration: auctionDuration.toString(),
            startTime: auctionStartTime.toString(),
          },
          whitelist: [
            {
              address: RESOLVER_ADDRESS,
              allowFrom: "0",
            },
          ],
          resolvingStartTime: "0",
        },
        extra: {
          nonce: nonce.toString(),
          allowPartialFills: true,
          allowMultipleFills: true,
        },
        // Store extension metadata if present
        // extension: (crossChainOrder as any)._nonEvmExtensionMetadata || null,
      }); // Single source-of-truth
      console.log("sdkOrderEncoded", sdkOrderEncoded);

      // Submit to API with complete payload to match current intents.json format
      const requestBody = {
        order: {
          ...crossChainOrder.build(),
        },
        extension: crossChainOrder.extension.encode(),
        signature,
        // Part 2 from PassTheOrder.md: Add encoded order as single source-of-truth
        sdkOrderEncoded, // JSON string with all constructor parameters for reconstruction
        hash: formData.secretHash,
        // Include chain IDs
        srcChain: actualSrcChainId, // Use actual current chain ID
        dstChain: formData.chainOut,
        signedChainId: currentChainId, // Store the chain ID used for signing
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
        srcEscrowTarget: formData.srcEscrowTarget || account, // Default to maker address
        dstEscrowTarget: formData.dstEscrowTarget || ZERO_ADDRESS, //todo update when aptos is implemented
        // Include auction data from actual values
        auctionStartTime: Number(auctionStartTime),
        auctionDuration:
          Number(formData.decayPeriod) || Number(auctionDuration),
        startRate: formData.startPricePremium || "1.0",
        endRate: formData.minPriceDiscount || "0.5",
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
    provider: ethers.Provider,
    salt: bigint,
    nonce: bigint
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

    // Map Base Sepolia (84532) to Base mainnet (8453) for SDK compatibility
    let srcChainIdForOrder: number = srcChainId;
    if (srcChainId === 84532) {
      srcChainIdForOrder = 8453; // Base mainnet chain ID supported by SDK
    }
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

    const AUCTION_DELAY = BigInt(60); // seconds before the auction may start
    const FILL_LIFETIME = BigInt(3600); // seconds after start when order is still valid
    const now = BigInt((await provider.getBlock("latest"))?.timestamp || 0);
    // Build auction details
    const auctionStartTime = now + AUCTION_DELAY;
    const auctionDuration = FILL_LIFETIME;

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

    const extra: Extra = {
      nonce,
      allowPartialFills: true,
      allowMultipleFills: true,
    };

    try {
      // Create NonEvmDstExtension for Aptos metadata if needed
      // const nonEvmExtension = createNonEvmDstExtension(formData);

      const crossChainOrder = CrossChainOrder.new(
        EvmAddress.ZERO,
        orderInfo,
        escrowParams,
        details,
        extra
      );
      // Disable extension entirely by clearing makerTraits extension flag

      console.log("createdCrossChainOrder", JSON.stringify(crossChainOrder));

      // Apply NonEvmDstExtension if needed (TODO: use SDK method when available)
      // if (nonEvmExtension.extensionBytes !== "0x") {
      //   // Store extension metadata for later use
      //   (crossChainOrder as any)._nonEvmExtensionMetadata =
      //     nonEvmExtension.metadata;
      // }

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

// Get default form data with optional chainIn override
export function getDefaultFormData(chainIn?: number): FormData {
  return {
    chainIn: chainIn || 84532, // Use provided chainIn or default to Base Sepolia
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

// Get current network chain ID from MetaMask
export async function getCurrentChainId(): Promise<number | null> {
  try {
    if (!window.ethereum) {
      return null;
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    return Number(network.chainId);
  } catch (error) {
    console.warn("Failed to get current chain ID:", error);
    return null;
  }
}

// Get form data with current network as chainIn
export async function getFormDataWithCurrentNetwork(): Promise<FormData> {
  const currentChainId = await getCurrentChainId();
  return getDefaultFormData(currentChainId || 84532);
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
