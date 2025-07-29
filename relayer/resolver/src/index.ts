/**
 * Resolver Main Entry Point
 * Implements Phase 1 of resolver_both_phases.md
 */

import chalk from "chalk";
import { EventEmitter } from "events";
import { loadResolverConfig } from "./config";
import { extractErrorMessage, generateSecret, hashSecret } from "./lib/utils";
import { BalanceManager } from "./services/BalanceManager";
import { IntentMonitor } from "./services/IntentMonitor";
import { createLogger } from "./services/Logger";
import { ProfitabilityAnalyzer } from "./services/ProfitabilityAnalyzer";
import {
  Intent,
  OrderExecutionContext,
  OrderProcessedEvent,
  ResolverConfig,
} from "./types";

export class Resolver extends EventEmitter {
  private config: ResolverConfig;
  private logger = createLogger("Resolver");
  private intentMonitor: IntentMonitor;
  private profitabilityAnalyzer: ProfitabilityAnalyzer;
  private balanceManager: BalanceManager;
  private isRunning = false;
  private processingQueue = new Set<string>();

  constructor(config?: ResolverConfig) {
    super();
    this.config = config || loadResolverConfig();

    // Initialize services
    this.intentMonitor = new IntentMonitor(this.config);
    this.profitabilityAnalyzer = new ProfitabilityAnalyzer(this.config);
    this.balanceManager = new BalanceManager(this.config);

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Start the resolver
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Resolver is already running");
      return;
    }

    const addresses = this.balanceManager.getWalletAddresses();
    this.logger.info("Starting resolver", {
      evmWallet: addresses.evm,
      aptosWallet: addresses.aptos,
    });

    console.log(chalk.blue("🚀 Starting Cross-Chain Resolver"));
    console.log(chalk.gray(`EVM Wallet: ${addresses.evm}`));
    console.log(chalk.gray(`Aptos Wallet: ${addresses.aptos}`));

    try {
      // Check initial balances
      const balanceCheck = await this.balanceManager.checkMinimumBalances();
      if (!balanceCheck.sufficient) {
        throw new Error(
          `Insufficient balances: EVM=${balanceCheck.balances.evm}, Aptos=${balanceCheck.balances.aptos}`
        );
      }

      this.logger.info("Balance check passed", balanceCheck.balances);

      console.log(chalk.green("✅ Balance check passed"));
      console.log(chalk.gray(`EVM: ${balanceCheck.balances.evm} ETH`));
      console.log(chalk.gray(`Aptos: ${balanceCheck.balances.aptos} APT`));

      // Start intent monitoring
      await this.intentMonitor.start();

      this.isRunning = true;
      this.logger.info("Resolver started successfully");

      console.log(chalk.green("🎯 Resolver started successfully"));
      console.log(chalk.blue("📡 Monitoring for cross-chain swap intents..."));
    } catch (error) {
      this.logger.error(
        "Failed to start resolver:",
        extractErrorMessage(error)
      );
      throw error;
    }
  }

  /**
   * Stop the resolver
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.logger.info("Stopping resolver");
    console.log(chalk.yellow("🛑 Stopping resolver..."));
    this.intentMonitor.stop();
    this.isRunning = false;
    this.logger.info("Resolver stopped");
    console.log(chalk.green("✅ Resolver stopped"));
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.intentMonitor.on("newIntent", this.handleNewIntent.bind(this));
    this.intentMonitor.on("error", (error) => {
      this.logger.error("Intent monitor error:", extractErrorMessage(error));
    });
  }

  /**
   * Handle new intent from the monitor
   */
  private async handleNewIntent(intent: Intent): Promise<void> {
    // Skip if already processing
    if (this.processingQueue.has(intent.id)) {
      return;
    }

    // Check queue limit
    if (this.processingQueue.size >= this.config.maxConcurrentOrders) {
      this.logger.warn("Max concurrent orders reached, skipping intent", {
        intentId: intent.id,
        queueSize: this.processingQueue.size,
      });
      return;
    }

    this.processingQueue.add(intent.id);

    try {
      await this.processIntent(intent);
    } catch (error) {
      this.logger.error(
        `Failed to process intent ${intent.id}:`,
        extractErrorMessage(error)
      );
    } finally {
      this.processingQueue.delete(intent.id);
    }
  }

  /**
   * Process a single intent through Phase 1 flow
   */
  private async processIntent(intent: Intent): Promise<void> {
    const startTime = Date.now();

    this.logger.info(`Processing intent ${intent.id}`, {
      maker: intent.fusionOrder.maker,
      srcChain: intent.fusionOrder.srcChain,
      dstChain: intent.fusionOrder.dstChain,
      makingAmount: intent.fusionOrder.makingAmount,
      takingAmount: intent.fusionOrder.takingAmount,
    });

    console.log(chalk.yellow(`🔄 Processing Intent: ${intent.id}`));
    console.log(
      chalk.gray(
        `Chain: ${intent.fusionOrder.srcChain} → ${intent.fusionOrder.dstChain}`
      )
    );
    console.log(
      chalk.gray(
        `Amount: ${intent.fusionOrder.makingAmount} → ${intent.fusionOrder.takingAmount}`
      )
    );

    try {
      // Update status to processing
      await this.intentMonitor.updateIntentStatus(intent.id, "processing");

      // Step 1-2: Profitability analysis (1inch quote + cost calculation)
      const profitability =
        await this.profitabilityAnalyzer.analyzeProfitability(
          intent.fusionOrder
        );

      if (!profitability.profitable) {
        this.logger.info(`Intent ${intent.id} not profitable`, {
          expectedProfit: profitability.expectedProfit,
          error: profitability.error,
        });

        console.log(chalk.red(`❌ Intent ${intent.id} not profitable`));
        console.log(
          chalk.gray(`Expected profit: ${profitability.expectedProfit}`)
        );

        await this.intentMonitor.updateIntentStatus(intent.id, "failed", {
          reason: "not_profitable",
          profitability,
        });
        return;
      }

      // Step 3: Balance and liquidity checks
      const balanceCheck = await this.balanceManager.checkBalances(
        intent.fusionOrder
      );

      if (!balanceCheck.sufficient) {
        this.logger.warn(`Intent ${intent.id} insufficient balance`, {
          balanceCheck,
        });

        console.log(chalk.red(`❌ Intent ${intent.id} insufficient balance`));
        console.log(
          chalk.gray(
            `EVM: ${balanceCheck.evmBalance}, Required: ${balanceCheck.requiredEvm}`
          )
        );
        console.log(
          chalk.gray(
            `Aptos: ${balanceCheck.aptosBalance}, Required: ${balanceCheck.requiredAptos}`
          )
        );

        await this.intentMonitor.updateIntentStatus(intent.id, "failed", {
          reason: "insufficient_balance",
          balanceCheck,
        });
        return;
      }

      // Step 4-5: Generate order parameters and order hash
      const secret = generateSecret();
      const secretHash = hashSecret(secret);
      const orderHash = this.generateOrderHash(intent.fusionOrder);

      const executionContext: OrderExecutionContext = {
        intent,
        profitability,
        balanceCheck,
        orderHash,
        secret,
        secretHash,
      };

      this.logger.info(`Intent ${intent.id} ready for execution`, {
        orderHash,
        expectedProfit: profitability.expectedProfit,
      });

      console.log(chalk.cyan(`✅ Intent ${intent.id} ready for execution`));
      console.log(
        chalk.gray(`Expected profit: ${profitability.expectedProfit}`)
      );
      console.log(chalk.gray(`Order hash: ${orderHash}`));

      // Step 6-7: Create escrows (simplified for hackathon)
      const result = await this.createEscrows(executionContext);

      const processingTime = Date.now() - startTime;

      if (result.success) {
        await this.intentMonitor.updateIntentStatus(intent.id, "completed", {
          orderHash,
          txHashes: result.txHashes,
          profit: profitability.expectedProfit,
          processingTime,
        });

        const event: OrderProcessedEvent = {
          intentId: intent.id,
          success: true,
          profit: profitability.expectedProfit,
          txHashes: result.txHashes!,
          processingTime,
        };

        this.emit("orderProcessed", event);

        this.logger.info(`Intent ${intent.id} completed successfully`, {
          processingTime,
          profit: profitability.expectedProfit,
        });

        console.log(
          chalk.green(`🎉 Intent ${intent.id} completed successfully!`)
        );
        console.log(chalk.gray(`Processing time: ${processingTime}ms`));
        console.log(chalk.gray(`Profit: ${profitability.expectedProfit}`));
      } else {
        await this.intentMonitor.updateIntentStatus(intent.id, "failed", {
          reason: "escrow_creation_failed",
          error: result.error,
        });

        this.logger.error(`Intent ${intent.id} escrow creation failed`, {
          error: result.error,
        });

        console.log(chalk.red(`💥 Intent ${intent.id} escrow creation failed`));
        console.log(chalk.gray(`Error: ${result.error}`));
      }
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      this.logger.error(`Error processing intent ${intent.id}:`, errorMessage);

      await this.intentMonitor.updateIntentStatus(intent.id, "failed", {
        reason: "processing_error",
        error: errorMessage,
      });
    }
  }

  /**
   * Generate order hash (simplified)
   */
  private generateOrderHash(fusionOrder: any): string {
    // Simplified hash generation for hackathon
    const hashInput = JSON.stringify({
      maker: fusionOrder.maker,
      makerAsset: fusionOrder.makerAsset,
      takerAsset: fusionOrder.takerAsset,
      makingAmount: fusionOrder.makingAmount,
      takingAmount: fusionOrder.takingAmount,
      salt: fusionOrder.salt,
    });

    return hashSecret(hashInput);
  }

  /**
   * Create escrows on both chains (placeholder for hackathon)
   */
  private async createEscrows(context: OrderExecutionContext): Promise<{
    success: boolean;
    txHashes?: {
      evmEscrow?: string;
      aptosEscrow?: string;
    };
    error?: string;
  }> {
    try {
      this.logger.info("Creating escrows (placeholder implementation)", {
        intentId: context.intent.id,
        orderHash: context.orderHash,
      });

      console.log(
        chalk.blue(`🔐 Creating escrows for intent ${context.intent.id}`)
      );
      console.log(chalk.gray(`Order hash: ${context.orderHash}`));

      // For hackathon: simulate escrow creation
      // In production, this would call actual smart contracts
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate network delay

      // Simulate transaction hashes
      const txHashes = {
        evmEscrow: `0x${Math.random().toString(16).substr(2, 64)}`,
        aptosEscrow: `0x${Math.random().toString(16).substr(2, 64)}`,
      };

      this.logger.info("Escrows created (simulated)", {
        intentId: context.intent.id,
        txHashes,
      });

      console.log(chalk.green(`✅ Escrows created (simulated)`));
      console.log(chalk.gray(`EVM: ${txHashes.evmEscrow}`));
      console.log(chalk.gray(`Aptos: ${txHashes.aptosEscrow}`));

      return {
        success: true,
        txHashes,
      };
    } catch (error) {
      return {
        success: false,
        error: extractErrorMessage(error),
      };
    }
  }

  /**
   * Get resolver status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      queueSize: this.processingQueue.size,
      walletAddresses: this.balanceManager.getWalletAddresses(),
      intentMonitor: this.intentMonitor.getHealthStatus(),
    };
  }
}

/**
 * Main function to start the resolver
 */
async function main() {
  const resolver = new Resolver();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log(chalk.yellow("\n🛑 Shutting down resolver..."));
    resolver.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log(chalk.yellow("\n🛑 Shutting down resolver..."));
    resolver.stop();
    process.exit(0);
  });

  try {
    await resolver.start();

    // Log status every 30 seconds
    setInterval(() => {
      const status = resolver.getStatus();
      console.log(chalk.blue("📊 Resolver Status:"));
      console.log(
        chalk.gray(
          `  Running: ${
            status.isRunning ? chalk.green("Yes") : chalk.red("No")
          }`
        )
      );
      console.log(chalk.gray(`  Queue Size: ${status.queueSize}`));
      console.log(chalk.gray(`  EVM Wallet: ${status.walletAddresses.evm}`));
      console.log(
        chalk.gray(`  Aptos Wallet: ${status.walletAddresses.aptos}`)
      );
      console.log(
        chalk.gray(
          `  Monitor Health: ${
            status.intentMonitor.healthy
              ? chalk.green("Healthy")
              : chalk.red("Unhealthy")
          }`
        )
      );
      console.log(""); // Empty line for readability
    }, 30000);
  } catch (error) {
    console.error(chalk.red("💥 Failed to start resolver:"), error);
    process.exit(1);
  }
}

// Start the resolver if this file is run directly
if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red("💥 Resolver crashed:"), error);
    process.exit(1);
  });
}

export default Resolver;
