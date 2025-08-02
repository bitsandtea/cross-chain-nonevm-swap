import { uint8ArrayToHex } from "@1inch/byte-utils";
import { randomBytes } from "crypto";
import { ethers } from "ethers";
import { Intent, ResolverConfig } from "../types";

// Import 1inch SDK with proper types
const Sdk = require("@1inch/cross-chain-sdk");
// Import Extension utils from Fusion SDK
const { Extension } = require("@1inch/fusion-sdk");

// Ensure SDK is properly loaded
if (!Sdk.HashLock) {
  throw new Error("SDK.HashLock is not available - check SDK installation");
}

export class OrderBuilder {
  private config: ResolverConfig;
  private evmWallet: ethers.Wallet;

  constructor(config: ResolverConfig, evmWallet: ethers.Wallet) {
    this.config = config;
    this.evmWallet = evmWallet;
  }

  public createCrossChainOrder(intent: Intent): {
    order: any;
    secrets: string[];
    meta?: { aptosTakerAsset?: string; dstChain?: number };
    signature?: string;
  } {
    // Generate secrets for the order (this is needed for withdrawal)
    let secrets: string[] = [];

    // For now, always use single fill
    const secret = uint8ArrayToHex(randomBytes(32));
    secrets = [secret];
    // console.log("Generated secret for withdrawal", {
    //   secret: secret.slice(0, 10) + "...",
    //   intentId: intent.id,
    // });

    // Check if this is a cross-chain order to Aptos
    // const isCrossChainToAptos = intent.dstChain === 1000;
    const isCrossChainToAptos = true;

    // console.log("Reconstructing CrossChainOrder from encoded data", {
    //   intentId: intent.id,
    //   hasEncodedOrder: !!intent.sdkOrderEncoded,
    //   signedChainId: intent.signedChainId,
    //   isCrossChainToAptos,
    // });
    // Reconstruct the CrossChainOrder from the encoded data (PassTheOrder.md strategy)
    if (!intent.sdkOrderEncoded) {
      throw new Error("No encoded order data found in intent");
    }

    const orderData = JSON.parse(intent.sdkOrderEncoded);

    // Reconstruct the CrossChainOrder using the exact same pattern as OrderUtils.ts
    const orderInfo = {
      makerAsset: Sdk.EvmAddress.fromString(orderData.orderInfo.makerAsset),
      takerAsset: Sdk.EvmAddress.fromString(orderData.orderInfo.takerAsset),
      makingAmount: BigInt(orderData.orderInfo.makingAmount),
      takingAmount: BigInt(orderData.orderInfo.takingAmount),
      maker: Sdk.EvmAddress.fromString(orderData.orderInfo.maker),
      receiver: Sdk.EvmAddress.fromString(orderData.orderInfo.receiver),
      salt: BigInt(orderData.orderInfo.salt),
    };

    // Map Base Sepolia (84532) to Base mainnet (8453) for SDK compatibility
    let srcChainIdForOrder = orderData.escrowParams.srcChainId;
    if (srcChainIdForOrder === 84532) {
      srcChainIdForOrder = 8453; // Base mainnet chain ID supported by SDK
    }

    const escrowParams = {
      hashLock: Sdk.HashLock.fromString(orderData.escrowParams.hashLock),
      srcChainId: srcChainIdForOrder, // Use mapped chain ID for SDK compatibility
      dstChainId: orderData.escrowParams.dstChainId,
      srcSafetyDeposit: BigInt(orderData.escrowParams.srcSafetyDeposit),
      dstSafetyDeposit: BigInt(orderData.escrowParams.dstSafetyDeposit),
      timeLocks: Sdk.TimeLocks.new({
        srcWithdrawal: BigInt(orderData.escrowParams.timeLocks.srcWithdrawal),
        srcPublicWithdrawal: BigInt(
          orderData.escrowParams.timeLocks.srcPublicWithdrawal
        ),
        srcCancellation: BigInt(
          orderData.escrowParams.timeLocks.srcCancellation
        ),
        srcPublicCancellation: BigInt(
          orderData.escrowParams.timeLocks.srcPublicCancellation
        ),
        dstWithdrawal: BigInt(orderData.escrowParams.timeLocks.dstWithdrawal),
        dstPublicWithdrawal: BigInt(
          orderData.escrowParams.timeLocks.dstPublicWithdrawal
        ),
        dstCancellation: BigInt(
          orderData.escrowParams.timeLocks.dstCancellation
        ),
      }),
    };

    const details = {
      auction: new Sdk.AuctionDetails({
        initialRateBump: Number(orderData.details.auction.initialRateBump),
        points: orderData.details.auction.points,
        duration: BigInt(orderData.details.auction.duration),
        startTime: BigInt(orderData.details.auction.startTime),
      }),
      whitelist: orderData.details.whitelist.map((item: any) => ({
        address: Sdk.EvmAddress.fromString(item.address),
        allowFrom: BigInt(item.allowFrom),
      })),
      resolvingStartTime: BigInt(orderData.details.resolvingStartTime),
    };

    const extra = {
      nonce: BigInt(orderData.extra.nonce),
      allowPartialFills: orderData.extra.allowPartialFills,
      allowMultipleFills: orderData.extra.allowMultipleFills,
    };

    let crossChainOrder: any;

    if (intent.extension) {
      // Reconstruct directly from provided order data + encoded extension bytes
      const decodedExt = Extension.decode(intent.extension);
      crossChainOrder = Sdk.EvmCrossChainOrder.fromDataAndExtension(
        intent.order,
        decodedExt
      );
    } else {
      // Fallback to reconstruction from the stored constructor params
      crossChainOrder = Sdk.EvmCrossChainOrder.new(
        Sdk.EvmAddress.ZERO,
        orderInfo,
        escrowParams,
        details,
        extra
      );
    }

    return {
      order: crossChainOrder, // Full SDK object with all methods
      secrets,
      meta: isCrossChainToAptos
        ? {
            aptosTakerAsset: orderData.orderInfo.takerAsset,
            dstChain: intent.dstChain,
          }
        : undefined,
      signature: intent.signature, // Original signature from maker
    };
  }

  private buildAptosExtension(intent: Intent, order: any): string {
    // Build NonEvmDstExtension for Aptos chains
    if (intent.dstChain !== 1000) return "0x"; // Only for Aptos

    // TODO: Replace with Sdk.NonEvmDstExtension.new() when available
    // For now, return minimal extension bytes
    const aptosMetadata = {
      chainId: intent.dstChain,
      coinType: order.takerAsset,
      receiver: intent.dstEscrowTarget || order.maker,
    };

    console.log("Building Aptos extension", aptosMetadata);

    // Return placeholder extension - proper implementation depends on SDK support
    return "0x01"; // Minimal extension marker
  }

  public calculateFillStrategy(
    order: any,
    availableLiquidity: string
  ): {
    fillAmount: bigint;
    secretIndex: number;
    isPartialFill: boolean;
  } {
    const orderAmount = BigInt(order.makingAmount);

    // Handle decimal strings by parsing to float first, then converting to BigInt
    // This handles cases like "10000.0" from BalanceManager
    const liquidityValue = parseFloat(availableLiquidity);

    // Get token decimals dynamically from the order's maker asset
    const { getTokenDecimalsSync } = require("../lib/tokenMapping");

    // Ensure makerAsset is a string
    const makerAssetAddress = order.makerAsset;

    const tokenDecimals = getTokenDecimalsSync(makerAssetAddress) || 18; // Default to 18 if not found

    // Convert formatted amount back to raw units
    // e.g., "1.0" USDC -> 1000000 raw units (6 decimals)
    // e.g., "1.0" WETH -> 1000000000000000000 raw units (18 decimals)
    const liquidityInRawUnits = Math.floor(
      liquidityValue * Math.pow(10, tokenDecimals)
    );
    const liquidity = BigInt(liquidityInRawUnits);

    // console.log("Fill strategy calculation", {
    //   orderAmount: orderAmount.toString(),
    //   availableLiquidity,
    //   liquidityValue,
    //   liquidity: liquidity.toString(),
    // });

    if (liquidity >= orderAmount) {
      // console.log("Full fill possible - liquidity >= order amount", {
      //   liquidity: liquidity.toString(),
      //   orderAmount: orderAmount.toString(),
      //   fillPercentage: "100",
      // });
      return {
        fillAmount: orderAmount,
        secretIndex: 0,
        isPartialFill: false,
      };
    }

    const fillPercentage = (liquidity * 100n) / orderAmount;

    console.log("Fill percentage calculation details", {
      liquidity: liquidity.toString(),
      orderAmount: orderAmount.toString(),
      fillPercentage: fillPercentage.toString(),
      minimumRequired: "10",
      calculation: `(${liquidity.toString()} * 100) / ${orderAmount.toString()} = ${fillPercentage.toString()}%`,
    });

    if (fillPercentage < 10n) {
      throw new Error("Insufficient liquidity for minimum fill (10%)");
    }

    const fillAmount = (orderAmount * liquidity) / orderAmount;
    const secretIndex = Number((BigInt(10) * (fillAmount - 1n)) / orderAmount);

    return {
      fillAmount,
      secretIndex: Math.max(0, Math.min(secretIndex, 10)),
      isPartialFill: true,
    };
  }

  public async signCrossChainOrder(
    order: any,
    chainId: bigint
  ): Promise<string> {
    try {
      // For now, return placeholder since signing is handled elsewhere
      console.log("Sign order method called - using existing signature");
      return "0x";
    } catch (error: any) {
      console.log("Failed to sign order", {
        error: error.message,
      });
      throw error;
    }
  }
}
