import { uint8ArrayToHex, UINT_40_MAX } from "@1inch/byte-utils";
import { randomBytes } from "crypto";
import { ethers } from "ethers";
import { Intent, ResolverConfig } from "../types";
import { createLogger } from "./Logger";

// Dynamic import to handle ESM/CommonJS compatibility issues
let Sdk: any;
try {
  Sdk = require("@1inch/cross-chain-sdk");
} catch (error) {
  console.error("Failed to import 1inch SDK:", error);
  throw new Error("1inch SDK not available");
}

export class OrderBuilder {
  private logger = createLogger("OrderBuilder");
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
    const order = intent.fusionOrder;
    const currentTime = Math.floor(Date.now() / 1000);

    const shouldAllowPartialFills =
      BigInt(order.makingAmount) > BigInt("1000000000000000000"); // > 1 token

    let secrets: string[] = [];
    let hashLock: any;

    if (shouldAllowPartialFills) {
      secrets = Array.from({ length: 11 }).map(() =>
        uint8ArrayToHex(randomBytes(32))
      );
      const leaves = Sdk.HashLock.getMerkleLeaves(secrets);
      hashLock = Sdk.HashLock.forMultipleFills(leaves);
    } else {
      const secret = uint8ArrayToHex(randomBytes(32));
      secrets = [secret];
      hashLock = Sdk.HashLock.forSingleFill(secret);
    }

    // For cross-chain orders, we need to handle Aptos addresses differently
    // The 1inch SDK expects EVM addresses, so we use a marker for Aptos assets
    const isAptosAsset = (address: string, dstChain: number) => {
      // Check if destination chain is Aptos (chain ID 1000)
      if (dstChain !== 1000) return false;

      // Testnet format: contains "::"
      if (address.includes("::")) return true;

      // Mainnet format: 32-byte hex (66 chars including 0x)
      if (address.length === 66 && address.startsWith("0x")) return true;

      return false;
    };

    const isCrossChainToAptos = isAptosAsset(order.takerAsset, order.dstChain);

    // Use marker address for Aptos assets, original address for EVM assets
    const takerAssetForSdk = isCrossChainToAptos
      ? "0x0000000000000000000000000000000000010000" // Marker address for Aptos assets
      : order.takerAsset;

    // HACK: Use EVM chain ID for SDK call when targeting Aptos
    // Store real destination chain in meta for downstream services
    const hackForceEvmDstChain =
      process.env.HACK_FORCE_EVM_DST_CHAIN === "true";
    const dstChainIdForSdk =
      isCrossChainToAptos && hackForceEvmDstChain
        ? 137 // Force Polygon chain ID for Aptos routes (must be different from srcChain=1)
        : order.dstChain;

    this.logger.info("Cross-chain order creation", {
      intentId: intent.id,
      originalTakerAsset: order.takerAsset,
      sdkTakerAsset: takerAssetForSdk,
      isCrossChainToAptos,
      originalDstChain: order.dstChain,
      sdkDstChain: dstChainIdForSdk,
      hackEnabled: hackForceEvmDstChain,
    });

    // NEW APPROACH: Try to use SDK's API flow instead of manual order creation
    // This follows the pattern from the example code
    try {
      // Check if we have access to the SDK instance for API calls
      if (typeof Sdk.SDK !== "undefined") {
        this.logger.info("Attempting to use SDK API flow");

        // Create SDK instance if not available
        const sdk = new Sdk.SDK({
          url: "https://api.1inch.dev/fusion-plus",
          authKey: process.env.ONEINCH_API_KEY || "",
          blockchainProvider: this.evmWallet,
        });

        // Use the SDK's getQuote and placeOrder flow
        const params = {
          srcChainId: order.srcChain,
          dstChainId: dstChainIdForSdk,
          srcTokenAddress: order.makerAsset,
          dstTokenAddress: takerAssetForSdk,
          amount: order.makingAmount,
          enableEstimate: true,
          walletAddress: order.maker,
        };

        // For now, fall back to manual creation
        // TODO: Implement proper SDK API flow
        this.logger.info(
          "SDK API flow not yet implemented, using manual creation"
        );
      }
    } catch (error) {
      this.logger.warn("SDK API flow not available, using manual creation", {
        error,
      });
    }

    // MANUAL CREATION (current approach)
    const crossChainOrder = Sdk.CrossChainOrder.new(
      new Sdk.Address(this.config.evmEscrowFactoryAddress),
      {
        salt: Sdk.randBigInt(1000n),
        maker: new Sdk.Address(order.maker),
        makingAmount: BigInt(order.makingAmount),
        takingAmount: BigInt(order.takingAmount),
        makerAsset: new Sdk.Address(order.makerAsset),
        takerAsset: new Sdk.Address(takerAssetForSdk),
      },
      {
        hashLock,
        timeLocks: Sdk.TimeLocks.new({
          srcWithdrawal: BigInt(order.finalityLock),
          srcPublicWithdrawal: BigInt(order.srcTimelock),
          srcCancellation: BigInt(order.srcTimelock + 3600),
          srcPublicCancellation: BigInt(order.srcTimelock + 7200),
          dstWithdrawal: BigInt(order.finalityLock),
          dstPublicWithdrawal: BigInt(order.dstTimelock),
          dstCancellation: BigInt(order.dstTimelock + 3600),
        }),
        srcChainId: order.srcChain,
        dstChainId: dstChainIdForSdk,
        srcSafetyDeposit: BigInt(order.srcSafetyDeposit),
        dstSafetyDeposit: BigInt(order.dstSafetyDeposit),
      },
      {
        auction: new Sdk.AuctionDetails({
          initialRateBump: 0,
          points: [],
          duration: BigInt(order.auctionDuration || 3600),
          startTime: BigInt(order.auctionStartTime || currentTime),
        }),
        whitelist: [
          {
            address: new Sdk.Address(this.evmWallet.address),
            allowFrom: 0n,
          },
        ],
        resolvingStartTime: 0n,
      },
      {
        nonce: Sdk.randBigInt(Number(UINT_40_MAX)),
        allowPartialFills: shouldAllowPartialFills,
        allowMultipleFills: shouldAllowPartialFills,
      }
    );

    this.logger.info("Created 1inch CrossChain Order", {
      intentId: intent.id,
      orderHash: crossChainOrder.getOrderHash(order.srcChain),
      allowPartialFills: shouldAllowPartialFills,
      secretCount: secrets.length,
    });

    return {
      order: crossChainOrder,
      secrets,
      meta: isCrossChainToAptos
        ? {
            aptosTakerAsset: order.takerAsset,
            dstChain: order.dstChain, // Store real destination chain
          }
        : undefined,
    };
  }

  public calculateFillStrategy(
    crossChainOrder: any,
    availableLiquidity: string
  ): {
    fillAmount: bigint;
    secretIndex: number;
    isPartialFill: boolean;
  } {
    const orderAmount = crossChainOrder.makingAmount;

    // Handle decimal strings by parsing to float first, then converting to BigInt
    // This handles cases like "10000.0" from BalanceManager
    const liquidityValue = parseFloat(availableLiquidity);

    // Get token decimals dynamically from the order's maker asset
    const { getTokenDecimalsSync } = require("../lib/tokenMapping");

    // Ensure makerAsset is a string (it might be an Address object from 1inch SDK)
    const makerAssetAddress =
      typeof crossChainOrder.makerAsset === "string"
        ? crossChainOrder.makerAsset
        : crossChainOrder.makerAsset.toString();

    const tokenDecimals = getTokenDecimalsSync(makerAssetAddress) || 18; // Default to 18 if not found

    // Convert formatted amount back to raw units
    // e.g., "1.0" USDC -> 1000000 raw units (6 decimals)
    // e.g., "1.0" WETH -> 1000000000000000000 raw units (18 decimals)
    const liquidityInRawUnits = Math.floor(
      liquidityValue * Math.pow(10, tokenDecimals)
    );
    const liquidity = BigInt(liquidityInRawUnits);

    this.logger.info("Fill strategy calculation", {
      orderAmount: orderAmount.toString(),
      availableLiquidity,
      liquidityValue,
      liquidity: liquidity.toString(),
    });

    if (liquidity >= orderAmount) {
      this.logger.info("Full fill possible - liquidity >= order amount", {
        liquidity: liquidity.toString(),
        orderAmount: orderAmount.toString(),
        fillPercentage: "100",
      });
      return {
        fillAmount: orderAmount,
        secretIndex: 0,
        isPartialFill: false,
      };
    }

    const fillPercentage = (liquidity * 100n) / orderAmount;

    this.logger.info("Fill percentage calculation details", {
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
    crossChainOrder: any,
    chainId: bigint
  ): Promise<string> {
    try {
      const orderHash = crossChainOrder.getOrderHash(chainId);
      const signature = await this.evmWallet.signMessage(
        ethers.getBytes(orderHash)
      );

      this.logger.info("Signed CrossChain Order", {
        orderHash,
        signature: signature.slice(0, 10) + "...",
      });

      return signature;
    } catch (error: any) {
      this.logger.error("Failed to sign CrossChain Order", {
        error: error.message,
      });
      throw error;
    }
  }

  public convertSignatureToRVS(signature: string): { r: string; vs: string } {
    try {
      const sig = ethers.Signature.from(signature);
      const r = sig.r;
      const vs = ethers.solidityPacked(
        ["uint256"],
        [BigInt(sig.s) | (BigInt(sig.v - 27) << BigInt(255))]
      );
      return { r, vs };
    } catch (error: any) {
      this.logger.error("Failed to convert signature", {
        error: error.message,
        signature,
      });
      return {
        r: ethers.ZeroHash,
        vs: ethers.ZeroHash,
      };
    }
  }

  // NEW: Try to use SDK's built-in order placement
  public async trySDKOrderPlacement(intent: Intent): Promise<any> {
    try {
      // Check if we can use the SDK's API flow
      if (typeof Sdk.SDK === "undefined") {
        this.logger.warn("SDK.SDK not available, cannot use API flow");
        return null;
      }

      const order = intent.fusionOrder;

      // Create SDK instance
      const sdk = new Sdk.SDK({
        url: "https://api.1inch.dev/fusion-plus",
        authKey: process.env.ONEINCH_API_KEY || "",
        blockchainProvider: this.evmWallet,
      });

      // Use the SDK's getQuote flow
      const params = {
        srcChainId: order.srcChain,
        dstChainId: order.dstChain,
        srcTokenAddress: order.makerAsset,
        dstTokenAddress: order.takerAsset,
        amount: order.makingAmount,
        enableEstimate: true,
        walletAddress: order.maker,
      };

      this.logger.info("Attempting SDK getQuote", { params });

      // This would be the proper way, but requires API key and different flow
      // const quote = await sdk.getQuote(params);
      // const orderResponse = await sdk.placeOrder(quote, { ... });

      this.logger.info(
        "SDK API flow requires different implementation approach"
      );
      return null;
    } catch (error) {
      this.logger.warn("SDK order placement failed", { error });
      return null;
    }
  }
}
