/**
 * Resolver Main Entry Point
 */

import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import chalk from "chalk";
import { ethers } from "ethers";
import { EventEmitter } from "events";
import { loadResolverConfig } from "./config";
import { handleTransactionError } from "./lib/errorDecoder";
import { extractErrorMessage } from "./lib/utils";
import { AptosEscrowService } from "./services/AptosEscrowService";
import { BalanceManager } from "./services/BalanceManager";
import { EvmEscrowService } from "./services/EvmEscrowService";
import { IntentMonitor } from "./services/IntentMonitor";

import { ERC20_ABI, RESOLVER_ABI } from "./abis";
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
    console.log("Blockchain clients initialized");
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
    console.log("All services initialized");
  }

  private setupEventHandlers(): void {
    this.intentMonitor.on("newIntent", (intent: Intent) =>
      this.handleNewIntent(intent)
    );
    this.intentMonitor.on("error", (error) =>
      console.log("Intent monitor error", { error })
    );
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("Resolver starting...");
    await this.balanceManager.checkMinimumBalances();

    // Clear processed intents cache to allow reprocessing
    this.intentMonitor.clearProcessedCache();

    await this.intentMonitor.start();
    this.secretMonitor.start();
    this.recoveryMonitor.start();
    console.log(chalk.green("🚀 Resolver started successfully"));
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log("Resolver stopping...");
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
      console.log(`Failed to process intent ${intent.id}`, {
        error: extractErrorMessage(error),
      });
    } finally {
      this.processingQueue.delete(intent.id);
    }
  }

  private async processIntent(intent: Intent): Promise<void> {
    const startTime = Date.now();
    console.log(`Processing intent ${intent.id}`);
    // await this.intentMonitor.updateIntentStatus(intent.id, "processing");

    const profitability = await this.profitabilityAnalyzer.analyzeProfitability(
      intent
    );
    if (!profitability.profitable) {
      console.log(`Intent ${intent.id} not profitable`);
      return;
    }

    const balanceCheck = await this.balanceManager.checkBalances(intent);
    if (!balanceCheck.sufficient) {
      console.log(`Insufficient balance for intent ${intent.id}`);
      return;
    }

    // Create cross-chain order
    const orderResult = this.orderBuilder.createCrossChainOrder(intent);
    const crossChainOrder = orderResult.order;
    const secrets = orderResult.secrets;
    const meta = orderResult.meta;

    const executionContext: OrderExecutionContext = {
      intent,
      profitability,
      balanceCheck,
      orderHash: intent.orderHash || "0x", // Use orderHash from intent if available
      secret: secrets[0],
      secretHash: ethers.keccak256(secrets[0]),
    };

    const escrowResult = await this.createEscrows(
      executionContext,
      crossChainOrder,
      secrets,
      meta
    );

    const processingTime = Date.now() - startTime;
    if (escrowResult.success) {
      await this.intentMonitor.updateIntentStatus(intent.id, "completed", {
        txHashes: escrowResult.txHashes,
        processingTime,
      });
      this.emit("orderProcessed", {
        intentId: intent.id,
        success: true,
        txHashes: escrowResult.txHashes,
        processingTime,
      });
      console.log(`Intent ${intent.id} completed successfully`);
    } else {
      // await this.intentMonitor.updateIntentStatus(intent.id, "failed", {
      //   error: escrowResult.error,
      // });
      console.log(`Intent ${intent.id} failed`, { error: escrowResult.error });
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
        context.intent
      );

      // Get the actual token balance for the maker asset, not just ETH balance
      const tokenBalance = await this.balanceManager.getTokenBalance(
        context.intent.order.makerAsset
      );

      const signatureStr = context.intent.signature;

      const fillStrategy = this.orderBuilder.calculateFillStrategy(
        context.intent.order,
        tokenBalance
      );

      // Use the signedChainId for the prepareDeploySrc call
      const chainIdForDeployment =
        context.intent.signedChainId || context.intent.srcChain;

      // Use the prepareDeploySrc method which now handles plain orders
      // const deploySrcTx = this.evmEscrowService.prepareDeploySrc(
      //   Number(chainIdForDeployment),
      //   crossChainOrder,
      //   signatureStr,
      //   Sdk.TakerTraits.default()
      //     .setExtension(crossChainOrder.extension)
      //     .setAmountMode(Sdk.AmountMode.maker)
      //     .setAmountThreshold(crossChainOrder.takingAmount),
      //   fillStrategy.fillAmount,
      //   undefined, // hashLock
      //   context.intent.srcSafetyDeposit
      // );

      // Check resolver owner before generating transaction
      await this.evmEscrowService.getOwner();

      // Pre-flight checks for LOP token transfer
      const tokenAddr = crossChainOrder.makerAsset.toString();
      const makerAddr = crossChainOrder.maker.toString();
      const lopAddr = process.env.NEXT_PUBLIC_LOP_ADDRESS;

      console.log("🔍 Pre-flight LOP transfer checks:");
      console.log("  Token:", tokenAddr);
      console.log("  Maker:", makerAddr);
      console.log("  LOP:", lopAddr);
      console.log("  Fill Amount:", fillStrategy.fillAmount.toString());

      // Check token contract exists
      const tokenCode = await this.evmWallet.provider!.getCode(tokenAddr);
      console.log("  Token bytecode length:", tokenCode.length - 2, "bytes");

      if (tokenCode === "0x") {
        throw new Error(
          `Token contract at ${tokenAddr} has no bytecode - deploy token first`
        );
      }

      // Check maker balance
      const tokenContract = new ethers.Contract(
        tokenAddr,
        ERC20_ABI,
        this.evmWallet
      );
      const makerBalance = await tokenContract.balanceOf(makerAddr);
      console.log("  Maker balance:", makerBalance.toString());

      if (makerBalance < fillStrategy.fillAmount) {
        throw new Error(
          `Insufficient maker balance: ${makerBalance} < ${fillStrategy.fillAmount}`
        );
      }

      // Check LOP allowance
      const allowance = await tokenContract.allowance(makerAddr, lopAddr);
      console.log("  LOP allowance:", allowance.toString());

      if (allowance < fillStrategy.fillAmount) {
        console.log(
          "⚠️  Insufficient LOP allowance - attempting to approve..."
        );

        // Try to approve (this will fail if we're not the maker, but worth trying)
        const approveTx = await tokenContract.approve(
          lopAddr,
          ethers.MaxUint256
        );
        await approveTx.wait();
        console.log("✅ LOP approval successful");
      } else {
        console.log("✅ LOP allowance sufficient");
      }

      // Generate source escrow deployment transaction
      const deploySrcTx = this.evmEscrowService.generateSrcEscrowTX(
        crossChainOrder,
        signatureStr,
        fillStrategy.fillAmount,
        Number(chainIdForDeployment)
      );

      // Send the transaction with force options
      const tx = await this.evmWallet.sendTransaction({
        ...deploySrcTx,
        // Force transaction to be sent even if it might fail
        gasLimit: deploySrcTx.gasLimit || 500000, // Set explicit gas limit
        maxFeePerGas:
          deploySrcTx.maxFeePerGas || ethers.parseUnits("100", "gwei"), // High gas price
        maxPriorityFeePerGas:
          deploySrcTx.maxPriorityFeePerGas || ethers.parseUnits("2", "gwei"), // High priority fee
      });
      console.log("DeploySrc transaction sent:", tx.hash);

      // Wait for transaction confirmation but don't fail on revert
      try {
        const receipt = await tx.wait();
        if (receipt) {
          console.log("DeploySrc transaction confirmed:", {
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            status: receipt.status === 1 ? "success" : "failed",
          });
        }
      } catch (error) {
        console.log("DeploySrc transaction failed but was sent:", {
          txHash: tx.hash,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't throw - we want to see the transaction on explorer even if it fails
      }

      // console.log("tx", tx);
      return;
    } catch (error: any) {
      // console.log("Raw error:", {  // DO NOT DELETE - DEBUG
      //   message: error.message,
      //   data: error.data,
      //   code: error.code,
      //   reason: error.reason,
      // });

      // Decode custom errors if available
      if (error.data) {
        // console.log("Attempting to decode error data:", error.data);  // DO NOT DELETE - DEBUG

        // Manual error mapping for known errors (always check this first)
        const errorMap: { [key: string]: string } = {
          "0x5cd5d233": "InsufficientSafetyDeposit()",
          "0x118cdaa7": "OwnableUnauthorizedAccount(address)",
          "0x4d2301cc": "LengthMismatch()",
          "0x8f4a1c96": "NativeTokenSendingFailure()",
        };

        const manualErrorName = errorMap[error.data];
        if (manualErrorName) {
          console.log("Manual error mapping found:", manualErrorName); // DO NOT DELETE - DEBUG
        }

        try {
          const iface = new ethers.Interface(RESOLVER_ABI);
          const decodedError = iface.parseError(error.data);
          if (decodedError) {
            // console.log("ABI decoded error:", {  // DO NOT DELETE - DEBUG
            //   name: decodedError.name,
            //   args: decodedError.args,
            //   signature: decodedError.signature,
            // });
          } else {
            // console.log(  // DO NOT DELETE - DEBUG
            //   "Could not decode error with ABI, raw data:",
            //   error.data
            // );
          }
        } catch (decodeError) {
          // console.log("Failed to decode error with ABI:", decodeError);  // DO NOT DELETE - DEBUG
          // console.log("Raw error data:", error.data);  // DO NOT DELETE - DEBUG
        }
      } else {
        // console.log("No error data available for decoding");  // DO NOT DELETE - DEBUG
      }

      // Use comprehensive error decoder
      const errorAnalysis = handleTransactionError(error, "RESOLVER");
      console.log("\n" + "=".repeat(80));
      console.log("📊 COMPREHENSIVE ERROR ANALYSIS");
      console.log("=".repeat(80));
      console.log(errorAnalysis);
      console.log("=".repeat(80));

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
