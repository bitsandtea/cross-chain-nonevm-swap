/**
 * Resolver Bot for Fusion+ LOP Integration
 * Watches relayer API, runs profitability checks, executes Resolver.deploySrc
 */

import Sdk from "@1inch/cross-chain-sdk";
import axios from "axios";
import { ethers } from "ethers";
import { EventEmitter } from "events";
import { extractErrorMessage } from "../lib/utils";
import { Intent, ResolverConfig } from "../types";
import { BalanceManager } from "./BalanceManager";
import { createLogger } from "./Logger";
import { ProfitabilityAnalyzer } from "./ProfitabilityAnalyzer";

interface ResolverContractConfig {
  address: string;
  abi: string[];
}

interface LOPContractConfig {
  address: string;
  abi: string[];
}

export class ResolverBot extends EventEmitter {
  private config: ResolverConfig;
  private logger = createLogger("ResolverBot");
  private provider: ethers.Provider;
  private signer: ethers.Signer;
  private resolver: ethers.Contract;
  private profitabilityAnalyzer: ProfitabilityAnalyzer;
  private balanceManager: BalanceManager;
  private isRunning = false;

  // Resolver contract ABI for deploySrc function
  private resolverABI = [
    "function deploySrc(tuple(address,address,address,address,uint256,uint256,uint256,bytes32) order, bytes32 r, bytes32 vs, uint256 fillAmount, bytes calldata args) external payable",
    "function deployDst(tuple(bytes32,bytes32,address,address,address,uint256,uint256,tuple(uint256)) dstImmutables, uint256 srcCancellationTimestamp) external payable",
  ];

  constructor(
    config: ResolverConfig,
    provider: ethers.Provider,
    signer: ethers.Signer,
    resolverAddress: string
  ) {
    super();
    this.config = config;
    this.provider = provider;
    this.signer = signer;

    this.resolver = new ethers.Contract(
      resolverAddress,
      this.resolverABI,
      signer
    );
    this.profitabilityAnalyzer = new ProfitabilityAnalyzer(config);
    this.balanceManager = new BalanceManager(config);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    this.logger.info("Starting resolver bot");

    // Start monitoring for ready orders
    this.monitorReadyOrders();
  }

  stop(): void {
    this.isRunning = false;
    this.logger.info("Stopping resolver bot");
  }

  private async monitorReadyOrders(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.checkForReadyOrders();
        await this.sleep(this.config.pollIntervalMs);
      } catch (error) {
        this.logger.error(
          "Error monitoring orders:",
          extractErrorMessage(error)
        );
        await this.sleep(this.config.pollIntervalMs * 2);
      }
    }
  }

  private async checkForReadyOrders(): Promise<void> {
    try {
      // Fetch open orders from relayer API
      const response = await axios.get(
        `${this.config.relayerApiUrl}/api/intents`,
        {
          params: { status: "pending" },
        }
      );

      const openOrders = response.data;

      for (const order of openOrders) {
        if (this.shouldProcessOrder(order)) {
          await this.processOrder(order);
        }
      }
    } catch (error) {
      this.logger.error("Failed to fetch orders:", extractErrorMessage(error));
    }
  }

  private shouldProcessOrder(order: Intent): boolean {
    // Basic filters - could be enhanced with more sophisticated logic
    const now = Math.floor(Date.now() / 1000);

    // Check if order is still valid
    if (order.fusionOrder.expiration <= now) {
      return false;
    }

    // Check if auction has started
    if (order.fusionOrder.auctionStartTime > now) {
      return false;
    }

    // Check if we haven't processed this order recently
    // (implement order tracking logic here)

    return true;
  }

  private async processOrder(order: Intent): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`Processing order ${order.id}`);

    try {
      // Step 1: Profitability analysis
      const profitability =
        await this.profitabilityAnalyzer.analyzeProfitability(
          order.fusionOrder
        );

      if (!profitability.profitable) {
        this.logger.info(`Order ${order.id} not profitable`, {
          expectedProfit: profitability.expectedProfit,
        });
        return;
      }

      // Step 2: Balance check
      const balanceCheck = await this.balanceManager.checkBalances(
        order.fusionOrder
      );

      if (!balanceCheck.sufficient) {
        this.logger.warn(
          `Order ${order.id} insufficient balance`,
          balanceCheck
        );
        return;
      }

      // Step 3: Calculate fill amount and safety deposit
      const fillAmount = this.calculateFillAmount(order.fusionOrder);
      const safetyDeposit = this.calculateSafetyDeposit(order.fusionOrder);

      // Step 4: Execute deploySrc transaction
      const srcTxHash = await this.executeDeploySrc(
        order,
        fillAmount,
        safetyDeposit
      );

      // Update intent status to escrow_src_created
      await this.updateIntentStatus(order.id, "escrow_src_created", {
        escrowSrcTxHash: srcTxHash,
      });

      // Step 5: Execute deployDst transaction
      const dstTxHash = await this.executeDeployDst(order, safetyDeposit);

      // Update intent status to escrow_dst_created
      await this.updateIntentStatus(order.id, "escrow_dst_created", {
        escrowDstTxHash: dstTxHash,
      });

      this.logger.info(`Successfully processed order ${order.id}`, {
        processingTime: Date.now() - startTime,
        fillAmount: fillAmount.toString(),
        safetyDeposit: ethers.formatEther(safetyDeposit),
        srcTxHash,
        dstTxHash,
      });

      this.emit("orderProcessed", {
        orderId: order.id,
        success: true,
        fillAmount,
        safetyDeposit,
        srcTxHash,
        dstTxHash,
      });
    } catch (error) {
      this.logger.error(
        `Failed to process order ${order.id}:`,
        extractErrorMessage(error)
      );

      this.emit("orderProcessed", {
        orderId: order.id,
        success: false,
        error: extractErrorMessage(error),
      });
    }
  }

  private calculateFillAmount(fusionOrder: any): bigint {
    // For now, fill the entire order
    // In a more sophisticated implementation, this could do partial fills
    return BigInt(fusionOrder.makingAmount);
  }

  private calculateSafetyDeposit(fusionOrder: any): bigint {
    // Use the safety deposit specified in the order, or calculate based on amount
    const specifiedDeposit = BigInt(fusionOrder.srcSafetyDeposit || 0);

    if (specifiedDeposit > 0) {
      return specifiedDeposit;
    }

    // Fallback: calculate as percentage of fill amount
    const fillAmount = BigInt(fusionOrder.makingAmount);
    return fillAmount / BigInt(100); // 1% default
  }

  private async executeDeploySrc(
    order: Intent,
    fillAmount: bigint,
    safetyDeposit: bigint
  ): Promise<string> {
    const fusionOrder = order.fusionOrder;

    // Build LOP order structure for the contract call
    const lopOrder = {
      maker: fusionOrder.maker,
      receiver: fusionOrder.srcEscrowTarget,
      makerAsset: fusionOrder.makerAsset,
      takerAsset: fusionOrder.takerAsset,
      makingAmount: fusionOrder.makingAmount,
      takingAmount: fusionOrder.takingAmount,
      makerTraits:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      salt: fusionOrder.salt,
    };

    // Extract signature components (assuming r,s,v format)
    const signature = order.signature;
    const r = signature.slice(0, 66);
    const vs = signature.slice(66);

    // Prepare resolver arguments (hashlock + timelocks)
    const args = ethers.concat([
      fusionOrder.secretHash,
      this.encodeTimelocks(fusionOrder),
    ]);

    // Add gas buffer for transaction
    const gasEstimate = await this.resolver.deploySrc.estimateGas(
      lopOrder,
      r,
      vs,
      fillAmount,
      args,
      { value: safetyDeposit }
    );

    const gasLimit = (gasEstimate * BigInt(120)) / BigInt(100); // 20% buffer

    // Execute transaction
    const tx = await this.resolver.deploySrc(
      lopOrder,
      r,
      vs,
      fillAmount,
      args,
      {
        value: safetyDeposit,
        gasLimit,
      }
    );

    this.logger.info(`Transaction submitted for order ${order.id}`, {
      txHash: tx.hash,
      gasUsed: gasLimit.toString(),
    });

    // Wait for confirmation
    const receipt = await tx.wait();

    if (receipt?.status !== 1) {
      throw new Error(`Transaction failed: ${tx.hash}`);
    }

    this.logger.info(`Transaction confirmed for order ${order.id}`, {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });

    return tx.hash;
  }

  private async executeDeployDst(
    order: Intent,
    safetyDeposit: bigint
  ): Promise<string> {
    const fusionOrder = order.fusionOrder;

    // Build dst immutables structure for the contract call
    const dstImmutables = {
      secretHash: fusionOrder.secretHash,
      hashLock: fusionOrder.secretHash, // Same as secretHash for simplicity
      maker: fusionOrder.maker,
      receiver: fusionOrder.dstEscrowTarget,
      token: fusionOrder.takerAsset,
      amount: fusionOrder.takingAmount,
      safetyDeposit: safetyDeposit.toString(),
      timeLocks: {
        srcCancellationTimestamp:
          Math.floor(Date.now() / 1000) + fusionOrder.srcTimelock,
      },
    };

    // Prepare arguments for deployDst
    const srcCancellationTimestamp =
      Math.floor(Date.now() / 1000) + fusionOrder.srcTimelock;

    // Add gas buffer for transaction
    const gasEstimate = await this.resolver.deployDst.estimateGas(
      dstImmutables,
      srcCancellationTimestamp,
      { value: safetyDeposit }
    );

    const gasLimit = (gasEstimate * BigInt(120)) / BigInt(100); // 20% buffer

    // Execute transaction
    const tx = await this.resolver.deployDst(
      dstImmutables,
      srcCancellationTimestamp,
      {
        value: safetyDeposit,
        gasLimit,
      }
    );

    this.logger.info(`DeployDst transaction submitted for order ${order.id}`, {
      txHash: tx.hash,
      gasUsed: gasLimit.toString(),
    });

    // Wait for confirmation
    const receipt = await tx.wait();

    if (receipt?.status !== 1) {
      throw new Error(`DeployDst transaction failed: ${tx.hash}`);
    }

    this.logger.info(`DeployDst transaction confirmed for order ${order.id}`, {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });

    return tx.hash;
  }

  private async updateIntentStatus(
    intentId: string,
    status: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      const response = await axios.patch(
        `${this.config.relayerApiUrl}/api/intents/${intentId}`,
        {
          status,
          ...metadata,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.resolverApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.status === 200) {
        this.logger.info(`Updated intent ${intentId} status to ${status}`);
      } else {
        this.logger.error(
          `Failed to update intent ${intentId} status: ${response.statusText}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Error updating intent ${intentId} status:`,
        extractErrorMessage(error)
      );
    }
  }

  private encodeTimelocks(fusionOrder: any): string {
    // Use 1inch SDK TimeLocks for proper encoding
    try {
      if (fusionOrder.sdkOrder && fusionOrder.sdkOrder.timeLocks) {
        // If we have an SDK order with proper TimeLocks, use it directly
        return fusionOrder.sdkOrder.timeLocks.toString();
      }

      // Fallback: create TimeLocks from fusion order data
      const timeLocks = Sdk.TimeLocks.new({
        srcWithdrawal: BigInt(fusionOrder.srcTimelock || 10),
        srcPublicWithdrawal: BigInt((fusionOrder.srcTimelock || 10) * 2),
        srcCancellation: BigInt((fusionOrder.srcTimelock || 10) * 3),
        srcPublicCancellation: BigInt((fusionOrder.srcTimelock || 10) * 4),
        dstWithdrawal: BigInt(fusionOrder.dstTimelock || 10),
        dstPublicWithdrawal: BigInt((fusionOrder.dstTimelock || 10) * 2),
        dstCancellation: BigInt((fusionOrder.dstTimelock || 10) * 3),
      });

      // Use the TimeLocks object - convert to string format
      return timeLocks.toString();
    } catch (error) {
      this.logger.warn(
        "Failed to encode timelocks with SDK, using fallback",
        error
      );

      // Manual encoding as fallback
      const srcTimelock = fusionOrder.srcTimelock || 10;
      const dstTimelock = fusionOrder.dstTimelock || 10;

      const packed =
        (BigInt(srcTimelock) << BigInt(224)) |
        (BigInt(srcTimelock * 2) << BigInt(192)) |
        (BigInt(srcTimelock * 3) << BigInt(160)) |
        (BigInt(srcTimelock * 4) << BigInt(128)) |
        (BigInt(dstTimelock) << BigInt(96)) |
        (BigInt(dstTimelock * 2) << BigInt(64)) |
        (BigInt(dstTimelock * 3) << BigInt(32)) |
        BigInt(0); // deployedAt will be set by contract

      return ethers.toBeHex(packed, 32);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
