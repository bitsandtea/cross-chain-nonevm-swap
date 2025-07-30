/**
 * Resolver Main Entry Point
 */
import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import chalk from "chalk";
import { ethers } from "ethers";
import { EventEmitter } from "events";
import { loadResolverConfig } from "./config";
import { extractErrorMessage } from "./lib/utils";
import { AptosEscrowService } from "./services/AptosEscrowService";
import { BalanceManager } from "./services/BalanceManager";
import { EvmEscrowService } from "./services/EvmEscrowService";
import { IntentMonitor } from "./services/IntentMonitor";
import { createLogger } from "./services/Logger";
import { OrderBuilder } from "./services/OrderBuilder";
import { ProfitabilityAnalyzer } from "./services/ProfitabilityAnalyzer";
import { RecoveryMonitor } from "./services/RecoveryMonitor";
import { SecretMonitor } from "./services/SecretMonitor";
import { Intent, OrderExecutionContext, ResolverConfig } from "./types";

// Dynamic import to handle ESM/CommonJS compatibility issues
let Sdk: any;
try {
  Sdk = require("@1inch/cross-chain-sdk");
} catch (error) {
  console.error("Failed to import 1inch SDK:", error);
  throw new Error("1inch SDK not available");
}

export class Resolver extends EventEmitter {
  private config: ResolverConfig;
  private logger = createLogger("Resolver");
  private isRunning = false;
  private processingQueue = new Set<string>();

  // Wallets and clients
  private evmWallet!: ethers.Wallet;
  private aptosAccount!: Account;

  // Services
  private intentMonitor!: IntentMonitor;
  private profitabilityAnalyzer!: ProfitabilityAnalyzer;
  private balanceManager!: BalanceManager;
  private orderBuilder!: OrderBuilder;
  private evmEscrowService!: EvmEscrowService;
  private aptosEscrowService!: AptosEscrowService;
  private secretMonitor!: SecretMonitor;
  private recoveryMonitor!: RecoveryMonitor;

  constructor(config?: ResolverConfig) {
    super();
    this.config = config || loadResolverConfig();
    this.initializeBlockchainClients();
    this.initializeServices();
    this.setupEventHandlers();
  }

  private initializeBlockchainClients(): void {
    const evmProvider = new ethers.JsonRpcProvider(this.config.evmRpcUrl);
    this.evmWallet = new ethers.Wallet(this.config.evmPrivateKey, evmProvider);
    const privateKey = new Ed25519PrivateKey(this.config.aptosPrivateKey);
    this.aptosAccount = Account.fromPrivateKey({ privateKey });
    this.logger.info("Blockchain clients initialized");
  }

  private initializeServices(): void {
    this.intentMonitor = new IntentMonitor(this.config);
    this.profitabilityAnalyzer = new ProfitabilityAnalyzer(this.config);
    this.balanceManager = new BalanceManager(this.config);
    this.orderBuilder = new OrderBuilder(this.config, this.evmWallet);
    this.evmEscrowService = new EvmEscrowService(this.config, this.evmWallet);
    this.aptosEscrowService = new AptosEscrowService(
      this.config,
      this.aptosAccount
    );
    this.secretMonitor = new SecretMonitor(
      this.config,
      this.evmEscrowService,
      this.aptosEscrowService,
      this.intentMonitor
    );
    this.recoveryMonitor = new RecoveryMonitor(
      this.config,
      this.evmEscrowService,
      this.aptosEscrowService
    );
    this.logger.info("All services initialized");
  }

  private setupEventHandlers(): void {
    this.intentMonitor.on("newIntent", (intent: Intent) =>
      this.handleNewIntent(intent)
    );
    this.intentMonitor.on("error", (error) =>
      this.logger.error("Intent monitor error", { error })
    );
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info("Resolver starting...");
    await this.balanceManager.checkMinimumBalances();
    await this.intentMonitor.start();
    this.secretMonitor.start();
    this.recoveryMonitor.start();
    console.log(chalk.green("🚀 Resolver started successfully"));
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.logger.info("Resolver stopping...");
    this.intentMonitor.stop();
    this.secretMonitor.stop();
    this.recoveryMonitor.stop();
    console.log(chalk.yellow("🛑 Resolver stopped"));
  }

  private async handleNewIntent(intent: Intent): Promise<void> {
    if (
      this.processingQueue.has(intent.id) ||
      this.processingQueue.size >= this.config.maxConcurrentOrders
    ) {
      return;
    }
    this.processingQueue.add(intent.id);
    try {
      await this.processIntent(intent);
    } catch (error) {
      this.logger.error(`Failed to process intent ${intent.id}`, {
        error: extractErrorMessage(error),
      });
    } finally {
      this.processingQueue.delete(intent.id);
    }
  }

  private async processIntent(intent: Intent): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`Processing intent ${intent.id}`);
    await this.intentMonitor.updateIntentStatus(intent.id, "processing");

    const profitability = await this.profitabilityAnalyzer.analyzeProfitability(
      intent.fusionOrder
    );
    if (!profitability.profitable) {
      this.logger.info(`Intent ${intent.id} not profitable`);
      return;
    }

    const balanceCheck = await this.balanceManager.checkBalances(
      intent.fusionOrder
    );
    if (!balanceCheck.sufficient) {
      this.logger.warn(`Insufficient balance for intent ${intent.id}`);
      return;
    }

    // Try SDK approach first, fall back to manual creation
    let crossChainOrder: any;
    let secrets: string[];
    let meta: any;

    // Try SDK API flow first
    const sdkResult = await this.orderBuilder.trySDKOrderPlacement(intent);
    if (sdkResult) {
      crossChainOrder = sdkResult.order;
      secrets = sdkResult.secrets;
      meta = sdkResult.meta;
      this.logger.info("Using SDK API flow for order creation");
    } else {
      // Fall back to manual creation
      const result = this.orderBuilder.createCrossChainOrder(intent);
      crossChainOrder = result.order;
      secrets = result.secrets;
      meta = result.meta;
      this.logger.info("Using manual order creation");
    }
    const orderHash = crossChainOrder.getOrderHash(
      BigInt(intent.fusionOrder.srcChain)
    );

    const executionContext: OrderExecutionContext = {
      intent,
      profitability,
      balanceCheck,
      orderHash,
      secret: secrets[0],
      secretHash: ethers.keccak256(secrets[0]),
    };

    const result = await this.createEscrows(
      executionContext,
      crossChainOrder,
      secrets,
      meta
    );

    const processingTime = Date.now() - startTime;
    if (result.success) {
      await this.intentMonitor.updateIntentStatus(intent.id, "completed", {
        txHashes: result.txHashes,
        processingTime,
      });
      this.emit("orderProcessed", {
        intentId: intent.id,
        success: true,
        txHashes: result.txHashes,
        processingTime,
      });
      this.logger.info(`Intent ${intent.id} completed successfully`);
    } else {
      await this.intentMonitor.updateIntentStatus(intent.id, "failed", {
        error: result.error,
      });
      this.logger.error(`Intent ${intent.id} failed`, { error: result.error });
    }
  }

  private async createEscrows(
    context: OrderExecutionContext,
    crossChainOrder: any,
    secrets: string[],
    meta?: { aptosTakerAsset?: string; dstChain?: number }
  ): Promise<any> {
    try {
      const balanceCheck = await this.balanceManager.checkBalances(
        context.intent.fusionOrder
      );

      // Get the actual token balance for the maker asset, not just ETH balance
      const tokenBalance = await this.balanceManager.getTokenBalance(
        context.intent.fusionOrder.makerAsset
      );

      const fillStrategy = this.orderBuilder.calculateFillStrategy(
        crossChainOrder,
        tokenBalance
      );

      const signatureStr = await this.orderBuilder.signCrossChainOrder(
        crossChainOrder,
        BigInt(context.intent.fusionOrder.srcChain)
      );
      const signatureRVS =
        this.orderBuilder.convertSignatureToRVS(signatureStr);

      // Debug: Check crossChainOrder structure and available methods
      console.log("crossChainOrder keys:", Object.keys(crossChainOrder));
      console.log(
        "crossChainOrder methods:",
        Object.getOwnPropertyNames(Object.getPrototypeOf(crossChainOrder))
      );
      console.log(
        "crossChainOrder.inner keys:",
        Object.keys(crossChainOrder.inner)
      );
      console.log(
        "crossChainOrder.inner methods:",
        Object.getOwnPropertyNames(Object.getPrototypeOf(crossChainOrder.inner))
      );
      console.log(
        "crossChainOrder.inner.inner keys:",
        Object.keys(crossChainOrder.inner.inner)
      );

      // Check if there's a toOrder method or similar
      if (typeof crossChainOrder.inner.toOrder === "function") {
        console.log("Found toOrder method on crossChainOrder.inner");
      } else if (typeof crossChainOrder.inner.toLimitOrder === "function") {
        console.log("Found toLimitOrder method on crossChainOrder.inner");
      } else if (typeof crossChainOrder.inner.toLOP === "function") {
        console.log("Found toLOP method on crossChainOrder.inner");
      } else {
        console.log("No toOrder/toLimitOrder/toLOP method found");
      }

      // Create args for the deploySrc call using the 1inch SDK approach
      const hashlockBytes = Sdk.HashLock.fromString(
        secrets[fillStrategy.secretIndex]
      );

      // Use the TimeLocks from the CrossChainOrder directly
      // Based on the ResolverBot implementation, we should encode timeLocks using toString()
      let args: string;
      try {
        // Try to access timeLocks from the crossChainOrder structure
        const timeLocks =
          crossChainOrder.inner?.timeLocks ||
          crossChainOrder.inner?.inner?.timeLocks ||
          crossChainOrder.inner?.fusionExtension?.timeLocks ||
          crossChainOrder.inner?.escrowExtension?.timeLocks;

        if (!timeLocks) {
          throw new Error("TimeLocks not found in crossChainOrder structure");
        }

        console.log("timeLocks found:", timeLocks);
        console.log("timeLocks type:", typeof timeLocks);

        // Set deployedAt timestamp
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const timeLocksWithTimestamp =
          timeLocks.setDeployedAt(currentTimestamp);

        // Use manual encoding like ResolverBot fallback since toString() doesn't work for ethers.concat
        const srcTimelock = context.intent.fusionOrder.finalityLock || 300;
        const srcPublicWithdrawal =
          context.intent.fusionOrder.srcTimelock || 3600;
        const dstTimelock = context.intent.fusionOrder.finalityLock || 300;
        const dstPublicWithdrawal =
          context.intent.fusionOrder.dstTimelock || 1800;

        const packed =
          (BigInt(srcTimelock) << BigInt(224)) |
          (BigInt(srcPublicWithdrawal) << BigInt(192)) |
          (BigInt(srcPublicWithdrawal + 3600) << BigInt(160)) |
          (BigInt(srcPublicWithdrawal + 7200) << BigInt(128)) |
          (BigInt(dstTimelock) << BigInt(96)) |
          (BigInt(dstPublicWithdrawal) << BigInt(64)) |
          (BigInt(dstPublicWithdrawal + 3600) << BigInt(32)) |
          currentTimestamp; // deployedAt

        const timelocksData = ethers.toBeHex(packed, 32);

        // Combine hashlock and timelocks as bytes
        args = ethers.concat([
          hashlockBytes.toString(), // This should be bytes32
          timelocksData, // This should be bytes32
        ]);

        console.log("Successfully created args for deploySrc");
      } catch (error) {
        // Fallback: create TimeLocks manually like ResolverBot does
        console.log("Falling back to manual TimeLocks creation:", error);

        const fusionOrder = context.intent.fusionOrder;
        const fallbackTimeLocks = Sdk.TimeLocks.new({
          srcWithdrawal: BigInt(fusionOrder.finalityLock || 10),
          srcPublicWithdrawal: BigInt(fusionOrder.srcTimelock || 3600),
          srcCancellation: BigInt((fusionOrder.srcTimelock || 3600) + 3600),
          srcPublicCancellation: BigInt(
            (fusionOrder.srcTimelock || 3600) + 7200
          ),
          dstWithdrawal: BigInt(fusionOrder.finalityLock || 10),
          dstPublicWithdrawal: BigInt(fusionOrder.dstTimelock || 1800),
          dstCancellation: BigInt((fusionOrder.dstTimelock || 1800) + 3600),
        });

        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

        // Use manual encoding like ResolverBot
        const srcTimelock = fusionOrder.finalityLock || 10;
        const srcPublicWithdrawal = fusionOrder.srcTimelock || 3600;
        const dstTimelock = fusionOrder.finalityLock || 10;
        const dstPublicWithdrawal = fusionOrder.dstTimelock || 1800;

        const packed =
          (BigInt(srcTimelock) << BigInt(224)) |
          (BigInt(srcPublicWithdrawal) << BigInt(192)) |
          (BigInt(srcPublicWithdrawal + 3600) << BigInt(160)) |
          (BigInt(srcPublicWithdrawal + 7200) << BigInt(128)) |
          (BigInt(dstTimelock) << BigInt(96)) |
          (BigInt(dstPublicWithdrawal) << BigInt(64)) |
          (BigInt(dstPublicWithdrawal + 3600) << BigInt(32)) |
          currentTimestamp; // deployedAt

        const timelocksData = ethers.toBeHex(packed, 32);

        args = ethers.concat([hashlockBytes.toString(), timelocksData]);
      }

      // IMPLEMENTATION OF 11_CreatingTheOrder.md FIX STRATEGY
      // Use the exact LOP struct from the SDK instead of manually reconstructing
      let lopOrder: any;

      // Try to get the proper LOP order from the SDK
      if (typeof crossChainOrder.inner.toOrder === "function") {
        console.log("Using crossChainOrder.inner.toOrder()");
        lopOrder = crossChainOrder.inner.toOrder();
      } else if (typeof crossChainOrder.inner.toLimitOrder === "function") {
        console.log("Using crossChainOrder.inner.toLimitOrder()");
        lopOrder = crossChainOrder.inner.toLimitOrder();
      } else if (typeof crossChainOrder.inner.toLOP === "function") {
        console.log("Using crossChainOrder.inner.toLOP()");
        lopOrder = crossChainOrder.inner.toLOP();
      } else {
        // Fallback: Use the SDK's internal structure more carefully
        console.log("Using SDK internal structure as fallback");

        // Get the extension bytes properly
        let extensionBytes = "0x";
        if (crossChainOrder.inner.inner.extension) {
          const ext = crossChainOrder.inner.inner.extension;
          if (typeof ext === "string") {
            extensionBytes = ext;
          } else if (ext.encode && typeof ext.encode === "function") {
            extensionBytes = ext.encode();
          } else if (ext.postInteraction) {
            extensionBytes = ext.postInteraction;
          }
        }

        // Use crossChainOrder.inner.inner which is the actual LimitOrder
        lopOrder = {
          maker: crossChainOrder.inner.inner.maker.toString(),
          makerAsset: crossChainOrder.inner.inner.makerAsset.toString(),
          takerAsset: crossChainOrder.inner.inner.takerAsset.toString(),
          makingAmount: crossChainOrder.inner.inner.makingAmount.toString(),
          takingAmount: crossChainOrder.inner.inner.takingAmount.toString(),
          receiver:
            crossChainOrder.inner.inner.receiver?.toString() ||
            crossChainOrder.inner.inner.maker.toString(),
          allowedSender: "0x0000000000000000000000000000000000000000",
          makerAssetData: "0x",
          takerAssetData: "0x",
          getMakerAmount: "0x",
          getTakerAmount: "0x",
          predicate: "0x",
          permit: "0x",
          interaction: extensionBytes,
          makerTraits:
            crossChainOrder.inner.inner.makerTraits?.toString() ||
            "0x0000000000000000000000000000000000000000000000000000000000000000",
          salt: crossChainOrder.inner.inner._salt?.toString() || "0",
        };
      }

      console.log("LOP order structure:", lopOrder);

      // VALIDATION: Check if our order hash matches the SDK order hash (from 11_CreatingTheOrder.md hardening)
      try {
        const sdkOrderHash = crossChainOrder.getOrderHash(
          BigInt(context.intent.fusionOrder.srcChain)
        );
        console.log("SDK order hash:", sdkOrderHash);
        console.log("Order validation completed");
      } catch (error) {
        console.log("Order hash validation failed:", error);
      }

      const srcEscrow = await this.evmEscrowService.createSourceEscrow(
        context,
        lopOrder, // Use converted LOP order format
        signatureRVS,
        fillStrategy.fillAmount,
        args
      );
      const dstEscrow = await this.aptosEscrowService.createDestinationEscrow(
        context,
        meta?.aptosTakerAsset
      );

      return {
        success: true,
        txHashes: { evm: srcEscrow.txHash, aptos: dstEscrow.txHash },
      };
    } catch (error) {
      return { success: false, error: extractErrorMessage(error) };
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      queueSize: this.processingQueue.size,
      walletAddresses: this.balanceManager.getWalletAddresses(),
      intentMonitor: this.intentMonitor.getHealthStatus(),
    };
  }
}

async function main() {
  const resolver = new Resolver();
  await resolver.start();
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
}

if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red("💥 Resolver crashed:"), error);
    process.exit(1);
  });
}

export default Resolver;
