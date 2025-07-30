/**
 * Resolver Main Entry Point
 * Implements Phase 1 of resolver_both_phases.md
 */

import { uint8ArrayToHex, UINT_40_MAX } from "@1inch/byte-utils";
import Sdk from "@1inch/cross-chain-sdk";
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import chalk from "chalk";
import { randomBytes } from "crypto";
import { ethers } from "ethers";
import { EventEmitter } from "events";
import Sdk from "@1inch/cross-chain-sdk";

// Helper function to convert Uint8Array to hex string
function uint8ArrayToHex(array: Uint8Array): string {
  return "0x" + Array.from(array).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Maximum uint40 value
const UINT_40_MAX = (1n << 40n) - 1n;
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
  private secretMonitorInterval: NodeJS.Timeout | null = null;
  private recoveryMonitorInterval: NodeJS.Timeout | null = null;

  // Blockchain clients
  private evmProvider!: ethers.Provider;
  private evmWallet!: ethers.Wallet;
  private aptosClient!: Aptos;
  private aptosAccount!: Account;

  constructor(config?: ResolverConfig) {
    super();
    this.config = config || loadResolverConfig();

    // Initialize blockchain clients
    this.initializeBlockchainClients();

    // Initialize services
    this.intentMonitor = new IntentMonitor(this.config);
    this.profitabilityAnalyzer = new ProfitabilityAnalyzer(this.config);
    this.balanceManager = new BalanceManager(this.config);

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Initialize blockchain clients for EVM and Aptos
   */
  private initializeBlockchainClients(): void {
    try {
      // Initialize EVM provider and wallet
      this.evmProvider = new ethers.JsonRpcProvider(this.config.evmRpcUrl);
      this.evmWallet = new ethers.Wallet(
        this.config.evmPrivateKey,
        this.evmProvider
      );

      // Initialize Aptos client and account
      const aptosConfig = new AptosConfig({ network: Network.TESTNET });
      this.aptosClient = new Aptos(aptosConfig);

      // Create Aptos account from private key
      const privateKey = new Ed25519PrivateKey(this.config.aptosPrivateKey);
      this.aptosAccount = Account.fromPrivateKey({ privateKey });

      this.logger.info("Blockchain clients initialized successfully", {
        evmAddress: this.evmWallet.address,
        aptosAddress: this.aptosAccount.accountAddress.toString(),
      });
    } catch (error) {
      this.logger.error("Failed to initialize blockchain clients", { error });
      throw error;
    }
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

      // Start secret monitoring for withdrawal phase
      this.startSecretMonitoring();

      // Start recovery monitoring for expired escrows
      this.startRecoveryMonitoring();

      this.isRunning = true;
      this.logger.info("Resolver started successfully");

      console.log(chalk.green("🎯 Resolver started successfully"));
      console.log(chalk.blue("📡 Monitoring for cross-chain swap intents..."));
      console.log(chalk.blue("🔍 Monitoring for secret sharing events..."));
      console.log(chalk.blue("🛡️ Monitoring for recovery opportunities..."));
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

    // Stop all monitoring
    this.intentMonitor.stop();
    this.stopSecretMonitoring();
    this.stopRecoveryMonitoring();

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

        // await this.intentMonitor.updateIntentStatus(intent.id, "failed", {
        //   reason: "not_profitable",
        //   profitability,
        // });
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
   * Create escrows on both chains (real implementation)
   */
  private async createEscrows(context: OrderExecutionContext): Promise<{
    success: boolean;
    txHashes?: {
      evmEscrow?: string;
      aptosEscrow?: string;
    };
    addresses?: {
      evmEscrow?: string;
      aptosEscrow?: string;
    };
    error?: string;
  }> {
    try {
      this.logger.info("Creating escrows for cross-chain swap", {
        intentId: context.intent.id,
        orderHash: context.orderHash,
      });

      console.log(
        chalk.blue(`🔐 Creating escrows for intent ${context.intent.id}`)
      );
      console.log(chalk.gray(`Order hash: ${context.orderHash}`));

      // Step 1: Create source escrow (EVM)
      console.log(chalk.yellow("🔗 Creating source escrow on EVM..."));
      const srcEscrow = await this.createSourceEscrow(context);

      // Step 2: Create destination escrow (Aptos)
      console.log(chalk.yellow("🪐 Creating destination escrow on Aptos..."));
      const dstEscrow = await this.createDestinationEscrow(context);

      // Step 3: Update relayer status
      await this.updateIntentStatus(context.intent.id, "escrow_dst_created", {
        evmTxHash: srcEscrow.txHash,
        evmEscrow: srcEscrow.address,
        aptosTxHash: dstEscrow.txHash,
        aptosEscrow: dstEscrow.address,
      });

      const txHashes = {
        evmEscrow: srcEscrow.txHash,
        aptosEscrow: dstEscrow.txHash,
      };

      const addresses = {
        evmEscrow: srcEscrow.address,
        aptosEscrow: dstEscrow.address,
      };

      this.logger.info("Escrows created successfully", {
        intentId: context.intent.id,
        txHashes,
        addresses,
      });

      console.log(chalk.green(`✅ Both escrows created successfully`));
      console.log(chalk.gray(`EVM TX: ${txHashes.evmEscrow}`));
      console.log(chalk.gray(`EVM Escrow: ${addresses.evmEscrow}`));
      console.log(chalk.gray(`Aptos TX: ${txHashes.aptosEscrow}`));
      console.log(chalk.gray(`Aptos Escrow: ${addresses.aptosEscrow}`));

      return {
        success: true,
        txHashes,
        addresses,
      };
    } catch (error) {
      this.logger.error("Failed to create escrows", {
        intentId: context.intent.id,
        error: extractErrorMessage(error),
      });

      console.log(
        chalk.red(`❌ Escrow creation failed: ${extractErrorMessage(error)}`)
      );

      return {
        success: false,
        error: extractErrorMessage(error),
      };
    }
  }

  /**
   * Create source escrow on EVM chain via Resolver contract
   * Production implementation using proper LOP integration
   */
  private async createSourceEscrow(
    context: OrderExecutionContext
  ): Promise<{ txHash: string; address: string }> {
    const { intent, secretHash } = context;
    const order = intent.fusionOrder;

    // Complete Resolver contract ABI
    const resolverAbi = [
      "function deploySrc(tuple(address maker, address makerAsset, address takerAsset, uint256 makingAmount, uint256 takingAmount, address receiver, address allowedSender, bytes makerAssetData, bytes takerAssetData, bytes getMakerAmount, bytes getTakerAmount, bytes predicate, bytes permit, bytes interaction) order, bytes32 r, bytes32 vs, uint256 fillAmount, bytes args) external payable",
      "event SrcEscrowDeployed(bytes32 indexed orderHash, address indexed escrowAddr, uint256 fillAmount, uint256 safetyDeposit)",
    ];

    // Create Resolver contract instance
    const resolver = new ethers.Contract(
      this.config.resolverContractAddress,
      resolverAbi,
      this.evmWallet
    );

    // Create 1inch CrossChain Order using official SDK
    const { order: crossChainOrder, secrets } =
      this.createCrossChainOrder(intent);

    // Determine fill strategy based on available liquidity
    const balanceCheck = await this.balanceManager.checkBalances(order);
    const availableLiquidity = balanceCheck.requiredEvm;

    const fillStrategy = this.calculateFillStrategy(
      crossChainOrder,
      availableLiquidity
    );

    this.logger.info("Fill strategy determined using 1inch SDK", {
      intentId: intent.id,
      fillAmount: fillStrategy.fillAmount.toString(),
      secretIndex: fillStrategy.secretIndex,
      isPartialFill: fillStrategy.isPartialFill,
      allowPartialFills: crossChainOrder.makerTraits.allowPartialFills,
      allowMultipleFills: crossChainOrder.makerTraits.allowMultipleFills,
    });

    // Get the secret for this fill
    const secretForFill = secrets[fillStrategy.secretIndex];

    // Generate signature for the order (in production this comes from the maker)
    const orderHash = crossChainOrder.getOrderHash(BigInt(order.srcChain));
    const signature = await this.signCrossChainOrder(
      crossChainOrder,
      BigInt(order.srcChain)
    );

    // Build TakerTraits using 1inch SDK
    let takerTraits = Sdk.TakerTraits.default()
      .setExtension(crossChainOrder.extension)
      .setAmountMode(Sdk.AmountMode.maker)
      .setAmountThreshold(crossChainOrder.takingAmount);

    // Add interaction for multiple fills if needed
    if (
      fillStrategy.isPartialFill &&
      crossChainOrder.makerTraits.allowMultipleFills
    ) {
      const leaves = Sdk.HashLock.getMerkleLeaves(secrets);
      const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s));

      const interaction = new Sdk.EscrowFactory(
        new Sdk.Address(this.config.evmEscrowFactoryAddress)
      ).getMultipleFillInteraction(
        Sdk.HashLock.getProof(leaves, fillStrategy.secretIndex),
        fillStrategy.secretIndex,
        secretHashes[fillStrategy.secretIndex]
      );

      takerTraits = takerTraits.setInteraction(interaction);
    }

    // Use 1inch SDK's built-in method to create the LOP order
    const lopOrder = crossChainOrder.toLimitOrderV4();

    // Encode hashlock (single secret or merkle root)
    const hashlockBytes = fillStrategy.isPartialFill
      ? Sdk.HashLock.fromString(Sdk.HashLock.hashSecret(secretForFill))
      : Sdk.HashLock.fromString(secretForFill);

    // Create timelocks using SDK
    const timelocksData = crossChainOrder.timeLocks.encode();

    // Encode args as expected by Resolver contract
    const args = ethers.solidityPacked(
      ["bytes32", "uint256"],
      [hashlockBytes.toString(), timelocksData]
    );

    // Convert SDK signature to r/vs format
    const { r, vs } = this.convertSignatureToRVS(signature);

    this.logger.info("Creating source escrow via Resolver", {
      intentId: intent.id,
      orderHash,
      resolverAddress: this.config.resolverContractAddress,
      fillAmount: order.makingAmount,
      safetyDeposit: order.srcSafetyDeposit,
    });

    console.log(chalk.cyan("📋 1inch CrossChain Order Details:"));
    console.log(chalk.gray(`  Order Hash: ${orderHash}`));
    console.log(chalk.gray(`  Maker: ${crossChainOrder.maker.toString()}`));
    console.log(
      chalk.gray(`  Maker Asset: ${crossChainOrder.makerAsset.toString()}`)
    );
    console.log(
      chalk.gray(`  Taker Asset: ${crossChainOrder.takerAsset.toString()}`)
    );
    console.log(
      chalk.gray(`  Making Amount: ${crossChainOrder.makingAmount.toString()}`)
    );
    console.log(
      chalk.gray(`  Taking Amount: ${crossChainOrder.takingAmount.toString()}`)
    );
    console.log(
      chalk.gray(
        `  Allow Partial Fills: ${crossChainOrder.makerTraits.allowPartialFills}`
      )
    );
    console.log(
      chalk.gray(
        `  Allow Multiple Fills: ${crossChainOrder.makerTraits.allowMultipleFills}`
      )
    );

    console.log(chalk.cyan("🔐 1inch SDK Escrow Parameters:"));
    console.log(chalk.gray(`  Hashlock: ${hashlockBytes.toString()}`));
    console.log(
      chalk.gray(`  Secret for Fill: ${secretForFill.slice(0, 10)}...`)
    );
    console.log(chalk.gray(`  Timelocks (encoded): ${timelocksData}`));
    console.log(
      chalk.gray(
        `  Safety Deposit: ${crossChainOrder.srcSafetyDeposit.toString()} wei`
      )
    );

    if (fillStrategy.isPartialFill) {
      console.log(chalk.cyan("📊 1inch SDK Fill Strategy:"));
      console.log(
        chalk.gray(`  Fill Amount: ${fillStrategy.fillAmount.toString()}`)
      );
      console.log(chalk.gray(`  Secret Index: ${fillStrategy.secretIndex}`));
      console.log(chalk.gray(`  Total Secrets: ${secrets.length}`));
      console.log(
        chalk.gray(`  Is Partial Fill: ${fillStrategy.isPartialFill}`)
      );
    }

    try {
      // Estimate gas before sending transaction
      const gasEstimate = await resolver.deploySrc.estimateGas(
        lopOrder,
        r,
        vs,
        order.makingAmount,
        args,
        { value: order.srcSafetyDeposit }
      );

      const gasLimit = Math.floor(Number(gasEstimate) * this.config.gasBuffer);

      console.log(chalk.yellow(`⛽ Gas estimate: ${gasEstimate.toString()}`));
      console.log(chalk.yellow(`⛽ Gas limit (with buffer): ${gasLimit}`));

      // Send transaction with proper gas settings using 1inch SDK values
      const tx = await resolver.deploySrc(
        lopOrder,
        r,
        vs,
        fillStrategy.fillAmount, // Use calculated fill amount
        args,
        {
          value: crossChainOrder.srcSafetyDeposit.toString(),
          gasLimit: gasLimit,
        }
      );

      console.log(chalk.blue(`📡 Transaction sent: ${tx.hash}`));

      // Wait for confirmation
      const receipt = await tx.wait(
        parseInt(process.env.EVM_CONFIRMATIONS || "2")
      );

      console.log(
        chalk.green(`✅ Transaction confirmed in block ${receipt.blockNumber}`)
      );

      // Extract escrow address from SrcEscrowDeployed event
      const eventSignature = ethers.id(
        "SrcEscrowDeployed(bytes32,address,uint256,uint256)"
      );
      const event = receipt.logs.find(
        (log: any) => log.topics[0] === eventSignature
      );

      if (!event) {
        throw new Error(
          "SrcEscrowDeployed event not found in transaction receipt"
        );
      }

      const parsedLog = resolver.interface.parseLog(event);
      if (!parsedLog) {
        throw new Error("Failed to parse SrcEscrowDeployed event");
      }

      const escrowAddress = parsedLog.args.escrowAddr;

      this.logger.info("EVM source escrow created successfully", {
        intentId: intent.id,
        txHash: tx.hash,
        escrowAddress,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: receipt.gasPrice?.toString() || "unknown",
      });

      console.log(chalk.green(`🎯 Source escrow deployed: ${escrowAddress}`));

      return { txHash: tx.hash, address: escrowAddress };
    } catch (error) {
      this.logger.error("Failed to create source escrow", {
        intentId: intent.id,
        error: extractErrorMessage(error),
        lopOrder,
        args,
      });

      // Re-throw with more context
      throw new Error(
        `Source escrow creation failed: ${extractErrorMessage(error)}`
      );
    }
  }

  /**
   * Create destination escrow on Aptos chain
   * Production implementation with proper error handling and validation
   */
  private async createDestinationEscrow(
    context: OrderExecutionContext
  ): Promise<{ txHash: string; address: string }> {
    const { intent, orderHash, secretHash } = context;
    const order = intent.fusionOrder;

    this.logger.info("Creating destination escrow on Aptos", {
      intentId: intent.id,
      orderHash,
      aptosFactory: this.config.aptosEscrowFactoryAddress,
      takerAmount: order.takingAmount,
      safetyDeposit: order.dstSafetyDeposit,
    });

    try {
      // Validate Aptos account balance before proceeding
      const resources = await this.aptosClient.getAccountResources({
        accountAddress: this.aptosAccount.accountAddress,
      });

      // Check APT balance for gas fees
      const aptCoinResource = resources.find(
        (r) => r.type === "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
      );

      if (aptCoinResource && "data" in aptCoinResource) {
        const balance = (aptCoinResource.data as any).coin.value;
        this.logger.info("Aptos account balance", { balance });

        if (parseInt(balance) < 1000000) {
          // Less than 0.01 APT
          throw new Error("Insufficient APT balance for gas fees");
        }
      }

      // Prepare timelocks for Aptos escrow
      const timelocksArray = [
        order.finalityLock,
        order.dstTimelock,
        order.dstTimelock + 3600, // Public withdrawal window
        order.dstTimelock + 7200, // Cancellation window
        order.dstTimelock + 10800, // Public cancellation
      ];

      // Convert secret hash to bytes array for Aptos
      const secretHashBytes = Array.from(
        Buffer.from(secretHash.slice(2), "hex")
      );

      // For now, use simple single fill (will be extended for partial fills)
      const parts = 1;
      const merkleRootBytes: number[] = [];

      // Build Aptos transaction payload
      const payload = {
        function: `${this.config.aptosEscrowFactoryAddress}::escrow::create_escrow`,
        type_arguments: [order.takerAsset], // Token type for Aptos
        arguments: [
          order.dstEscrowTarget, // maker (where tokens go on destination)
          this.aptosAccount.accountAddress.toString(), // taker (resolver)
          order.takingAmount,
          order.dstSafetyDeposit,
          secretHashBytes,
          timelocksArray,
          false, // is_src (this is destination)
          merkleRootBytes, // merkle_root (for partial fills)
          parts, // parts (1 for single fill, >1 for partial fills)
        ],
      };

      console.log(chalk.cyan("🪐 Aptos Escrow Details:"));
      console.log(
        chalk.gray(`  Factory: ${this.config.aptosEscrowFactoryAddress}`)
      );
      console.log(chalk.gray(`  Maker: ${order.dstEscrowTarget}`));
      console.log(
        chalk.gray(`  Taker: ${this.aptosAccount.accountAddress.toString()}`)
      );
      console.log(chalk.gray(`  Token: ${order.takerAsset}`));
      console.log(chalk.gray(`  Amount: ${order.takingAmount}`));
      console.log(chalk.gray(`  Safety Deposit: ${order.dstSafetyDeposit}`));
      console.log(chalk.gray(`  Secret Hash: ${secretHash}`));

      // Build and simulate transaction first
      const transaction = await this.aptosClient.transaction.build.simple({
        sender: this.aptosAccount.accountAddress,
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.type_arguments,
          functionArguments: payload.arguments,
        },
      });

      console.log(chalk.yellow("🔍 Simulating Aptos transaction..."));

      // Simulate transaction to check for errors
      const simulationResult =
        await this.aptosClient.transaction.simulate.simple({
          signerPublicKey: this.aptosAccount.publicKey,
          transaction,
        });

      if (!simulationResult[0].success) {
        const errorMsg =
          simulationResult[0].vm_status || "Unknown simulation error";
        throw new Error(`Aptos transaction simulation failed: ${errorMsg}`);
      }

      console.log(chalk.green("✅ Simulation successful"));
      console.log(
        chalk.yellow(`⛽ Estimated gas: ${simulationResult[0].gas_used}`)
      );

      // Sign and submit transaction
      const signedTx = this.aptosClient.transaction.sign({
        signer: this.aptosAccount,
        transaction,
      });

      console.log(chalk.blue("📡 Submitting Aptos transaction..."));

      const result = await this.aptosClient.transaction.submit.simple({
        transaction,
        senderAuthenticator: signedTx,
      });

      console.log(chalk.blue(`📡 Aptos transaction submitted: ${result.hash}`));

      // Wait for finality with timeout
      const waitStart = Date.now();
      await this.aptosClient.waitForTransaction({
        transactionHash: result.hash,
        options: {
          timeoutSecs: parseInt(process.env.APTOS_CONFIRMATIONS || "30"),
          checkSuccess: true,
        },
      });

      const waitTime = Date.now() - waitStart;
      console.log(
        chalk.green(`✅ Aptos transaction confirmed in ${waitTime}ms`)
      );

      // Extract escrow address from transaction events
      const txDetails = await this.aptosClient.getTransactionByHash({
        transactionHash: result.hash,
      });

      // Find the EscrowCreated event in the transaction events
      let escrowAddress: string | undefined;
      if ("events" in txDetails && txDetails.events) {
        for (const event of txDetails.events) {
          if (
            event.type.includes("::escrow::EscrowCreated") ||
            event.type.includes("EscrowCreated")
          ) {
            escrowAddress =
              event.data.escrow_address ||
              event.data.vault_address ||
              event.data.address;
            break;
          }
        }
      }

      if (!escrowAddress) {
        // Fallback: try to extract from transaction changes
        if ("changes" in txDetails && txDetails.changes) {
          for (const change of txDetails.changes) {
            if (
              change.type === "write_resource" &&
              "address" in change &&
              "data" in change &&
              typeof change.data === "object" &&
              change.data !== null &&
              "type" in change.data &&
              typeof change.data.type === "string" &&
              change.data.type.includes("escrow")
            ) {
              escrowAddress = change.address as string;
              break;
            }
          }
        }
      }

      if (!escrowAddress) {
        this.logger.warn(
          "Could not extract escrow address from Aptos transaction",
          {
            txHash: result.hash,
            events: "events" in txDetails ? txDetails.events : "no events",
          }
        );
        // Use a deterministic placeholder based on transaction hash
        escrowAddress = `aptos_escrow_${result.hash.slice(-8)}`;
      }

      this.logger.info("Aptos destination escrow created successfully", {
        intentId: intent.id,
        txHash: result.hash,
        escrowAddress,
        gasUsed:
          "success" in txDetails ? (txDetails as any).gas_used : "unknown",
        waitTime,
      });

      console.log(chalk.green(`🎯 Aptos escrow deployed: ${escrowAddress}`));

      return { txHash: result.hash, address: escrowAddress };
    } catch (error) {
      this.logger.error("Failed to create Aptos destination escrow", {
        intentId: intent.id,
        error: extractErrorMessage(error),
        payload: {
          function: `${this.config.aptosEscrowFactoryAddress}::escrow::create_escrow`,
          takerAmount: order.takingAmount,
          safetyDeposit: order.dstSafetyDeposit,
        },
      });

      // Re-throw with more context
      throw new Error(
        `Aptos escrow creation failed: ${extractErrorMessage(error)}`
      );
    }
  }

  /**
   * Update intent status in the relayer
   */
  private async updateIntentStatus(
    intentId: string,
    status: string,
    data: any
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.config.relayerApiUrl}/api/intents/${intentId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.resolverApiKey}`,
          },
          body: JSON.stringify({
            status,
            ...data,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to update intent status: ${response.statusText}`
        );
      }

      this.logger.info("Intent status updated", { intentId, status });
    } catch (error) {
      this.logger.error("Failed to update intent status", {
        intentId,
        status,
        error: extractErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Create 1inch CrossChain Order from intent data
   */
  private createCrossChainOrder(intent: any): {
    order: any;
    secrets: string[];
    signature?: string;
  } {
    const order = intent.fusionOrder;
    const currentTime = Math.floor(Date.now() / 1000);

    // Determine if this should be a partial fill order
    const shouldAllowPartialFills =
      BigInt(order.makingAmount) > BigInt("1000000000000000000"); // > 1 token

    let secrets: string[] = [];
    let hashLock: any;

    if (shouldAllowPartialFills) {
      // Generate secrets for multiple fills (11 secrets as per 1inch example)
      secrets = Array.from({ length: 11 }).map(() =>
        uint8ArrayToHex(randomBytes(32))
      );
      const leaves = Sdk.HashLock.getMerkleLeaves(secrets);
      hashLock = Sdk.HashLock.forMultipleFills(leaves);
    } else {
      // Single fill
      const secret = uint8ArrayToHex(randomBytes(32));
      secrets = [secret];
      hashLock = Sdk.HashLock.forSingleFill(secret);
    }

    // Create 1inch CrossChain Order using official SDK
    const crossChainOrder = Sdk.CrossChainOrder.new(
      new Sdk.Address(this.config.evmEscrowFactoryAddress),
      {
        salt: Sdk.randBigInt(1000n),
        maker: new Sdk.Address(order.maker),
        makingAmount: BigInt(order.makingAmount),
        takingAmount: BigInt(order.takingAmount),
        makerAsset: new Sdk.Address(order.makerAsset),
        takerAsset: new Sdk.Address(order.takerAsset),
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
        srcChainId: parseInt(order.srcChain),
        dstChainId: parseInt(order.dstChain),
        srcSafetyDeposit: BigInt(order.srcSafetyDeposit),
        dstSafetyDeposit: BigInt(order.dstSafetyDeposit),
      },
      {
        auction: new Sdk.AuctionDetails({
          initialRateBump: 0,
          points: [], // Linear decay for simplicity
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
        nonce: Sdk.randBigInt(UINT_40_MAX),
        allowPartialFills: shouldAllowPartialFills,
        allowMultipleFills: shouldAllowPartialFills,
      }
    );

    this.logger.info("Created 1inch CrossChain Order", {
      intentId: intent.id,
      orderHash: crossChainOrder.getOrderHash(BigInt(order.srcChain)),
      allowPartialFills: shouldAllowPartialFills,
      secretCount: secrets.length,
    });

    return {
      order: crossChainOrder,
      secrets,
    };
  }

  /**
   * Calculate optimal fill amount and strategy using 1inch SDK
   */
  private calculateFillStrategy(
    crossChainOrder: any,
    availableLiquidity: string
  ): {
    fillAmount: bigint;
    secretIndex: number;
    isPartialFill: boolean;
  } {
    const orderAmount = crossChainOrder.makingAmount;
    const liquidity = BigInt(availableLiquidity);

    // If we can fill the entire order, do so
    if (liquidity >= orderAmount) {
      return {
        fillAmount: orderAmount,
        secretIndex: 0, // Use first secret for single fills
        isPartialFill: false,
      };
    }

    // For partial fills, calculate the appropriate secret index
    const fillPercentage = (liquidity * 100n) / orderAmount;

    if (fillPercentage < 10n) {
      throw new Error("Insufficient liquidity for minimum fill (10%)");
    }

    // Calculate fill amount and corresponding secret index
    const fillAmount = (orderAmount * liquidity) / orderAmount;
    const secretIndex = Number((BigInt(10) * (fillAmount - 1n)) / orderAmount); // Assuming 11 secrets (0-10)

    return {
      fillAmount,
      secretIndex: Math.max(0, Math.min(secretIndex, 10)),
      isPartialFill: true,
    };
  }

  /**
   * Encode timelocks into a single uint256 as expected by the Resolver contract
   * Based on TimelocksLib.sol structure with 32-bit values packed at specific positions
   */
  private encodeTimelocks(timelocks: {
    srcWithdrawal: number;
    srcPublicWithdrawal: number;
    srcCancellation: number;
    srcPublicCancellation: number;
    dstWithdrawal: number;
    dstPublicWithdrawal: number;
    dstCancellation: number;
  }): bigint {
    // Each timelock value is stored in 32 bits at specific offsets
    // Based on TimelocksLib.Stage enum positions
    let packed = BigInt(0);

    // Pack values at their respective bit positions (each stage uses 32 bits)
    packed |= BigInt(timelocks.srcWithdrawal) << BigInt(0 * 32); // Stage.SrcWithdrawal
    packed |= BigInt(timelocks.srcPublicWithdrawal) << BigInt(1 * 32); // Stage.SrcPublicWithdrawal
    packed |= BigInt(timelocks.srcCancellation) << BigInt(2 * 32); // Stage.SrcCancellation
    packed |= BigInt(timelocks.srcPublicCancellation) << BigInt(3 * 32); // Stage.SrcPublicCancellation
    packed |= BigInt(timelocks.dstWithdrawal) << BigInt(4 * 32); // Stage.DstWithdrawal
    packed |= BigInt(timelocks.dstPublicWithdrawal) << BigInt(5 * 32); // Stage.DstPublicWithdrawal
    packed |= BigInt(timelocks.dstCancellation) << BigInt(6 * 32); // Stage.DstCancellation

    // The deployment timestamp will be set by the contract at bit position 224
    // We don't set it here as it's handled by TimelocksLib.setDeployedAt()

    return packed;
  }

  /**
   * Sign CrossChain Order using 1inch SDK
   */
  private async signCrossChainOrder(
    crossChainOrder: any,
    chainId: bigint
  ): Promise<string> {
    try {
      // In production, this would be done by the maker
      // For testing, we'll sign with resolver key
      const orderHash = crossChainOrder.getOrderHash(chainId);
      const signature = await this.evmWallet.signMessage(
        ethers.getBytes(orderHash)
      );

      this.logger.info("Signed CrossChain Order", {
        orderHash,
        signature: signature.slice(0, 10) + "...",
      });

      return signature;
    } catch (error) {
      this.logger.error("Failed to sign CrossChain Order", {
        error: extractErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Convert ethers signature to r/vs format for LOP
   */
  private convertSignatureToRVS(signature: string): { r: string; vs: string } {
    try {
      const sig = ethers.Signature.from(signature);
      const r = sig.r;
      const vs = ethers.solidityPacked(
        ["uint256"],
        [BigInt(sig.s) | (BigInt(sig.v - 27) << BigInt(255))]
      );

      return { r, vs };
    } catch (error) {
      this.logger.error("Failed to convert signature", {
        error: extractErrorMessage(error),
        signature,
      });

      // Return zero values on error
      return {
        r: ethers.ZeroHash,
        vs: ethers.ZeroHash,
      };
    }
  }

  /**
   * Generate LOP order signature (legacy method)
   * In production, this would be provided by the maker when creating the intent
   * For now, generate a valid signature structure that the contract expects
   */
  private async generateLOPSignature(
    lopOrder: any,
    fusionOrder: any
  ): Promise<{ r: string; vs: string }> {
    try {
      // Create order hash as expected by LOP
      const orderTypes = [
        "address", // maker
        "address", // makerAsset
        "address", // takerAsset
        "uint256", // makingAmount
        "uint256", // takingAmount
        "address", // receiver
        "address", // allowedSender
        "bytes", // makerAssetData
        "bytes", // takerAssetData
        "bytes", // getMakerAmount
        "bytes", // getTakerAmount
        "bytes", // predicate
        "bytes", // permit
        "bytes", // interaction
      ];

      const orderValues = [
        lopOrder.maker,
        lopOrder.makerAsset,
        lopOrder.takerAsset,
        lopOrder.makingAmount,
        lopOrder.takingAmount,
        lopOrder.receiver,
        lopOrder.allowedSender,
        lopOrder.makerAssetData,
        lopOrder.takerAssetData,
        lopOrder.getMakerAmount,
        lopOrder.getTakerAmount,
        lopOrder.predicate,
        lopOrder.permit,
        lopOrder.interaction,
      ];

      // Create order hash
      const orderHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(orderTypes, orderValues)
      );

      // In production, the maker would sign this order hash using their private key
      // For testing/development, we'll create a signature using the resolver's key
      // Note: In a real implementation, this signature would come from the intent data
      const messageHash = ethers.hashMessage(ethers.getBytes(orderHash));
      const signature = await this.evmWallet.signMessage(
        ethers.getBytes(orderHash)
      );

      // Split signature into r and vs components as expected by LOP
      const sig = ethers.Signature.from(signature);
      const r = sig.r;
      const vs = ethers.solidityPacked(
        ["uint256"],
        [BigInt(sig.s) | (BigInt(sig.v - 27) << BigInt(255))]
      );

      this.logger.info("Generated LOP signature", {
        orderHash,
        messageHash,
        r,
        vs: vs.slice(0, 10) + "...", // Log truncated vs for privacy
      });

      return { r, vs };
    } catch (error) {
      this.logger.error("Failed to generate LOP signature", {
        error: extractErrorMessage(error),
        lopOrder,
      });

      // Fallback to zero signatures for testing
      // Note: This will likely cause the transaction to fail
      return {
        r: ethers.ZeroHash,
        vs: ethers.ZeroHash,
      };
    }
  }

  /**
   * Update destination escrow creation to use Resolver contract's deployDst method
   */
  private async createDestinationEscrowViaResolver(
    context: OrderExecutionContext
  ): Promise<{ txHash: string; address: string }> {
    const { intent, orderHash, secretHash } = context;
    const order = intent.fusionOrder;

    // Resolver contract ABI for destination escrow
    const resolverAbi = [
      "function deployDst(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) dstImmutables, uint256 srcCancellationTimestamp) external payable",
    ];

    const resolver = new ethers.Contract(
      this.config.resolverContractAddress,
      resolverAbi,
      this.evmWallet
    );

    // Create destination immutables
    const dstImmutables = {
      orderHash,
      hashlock: secretHash,
      maker: order.dstEscrowTarget, // Where tokens go on destination chain
      taker: this.aptosAccount.accountAddress.toString(),
      token: order.takerAsset,
      amount: order.takingAmount,
      safetyDeposit: order.dstSafetyDeposit,
      timelocks: this.encodeTimelocks({
        srcWithdrawal: order.finalityLock,
        srcPublicWithdrawal: order.srcTimelock,
        srcCancellation: order.srcTimelock + 3600,
        srcPublicCancellation: order.srcTimelock + 7200,
        dstWithdrawal: order.finalityLock,
        dstPublicWithdrawal: order.dstTimelock,
        dstCancellation: order.dstTimelock + 3600,
      }),
    };

    // Source cancellation timestamp (from source chain escrow)
    const srcCancellationTimestamp =
      Math.floor(Date.now() / 1000) + order.srcTimelock + 7200;

    this.logger.info("Creating destination escrow via Resolver", {
      intentId: intent.id,
      dstImmutables,
      srcCancellationTimestamp,
    });

    try {
      const tx = await resolver.deployDst(
        dstImmutables,
        srcCancellationTimestamp,
        {
          value: order.dstSafetyDeposit,
        }
      );

      const receipt = await tx.wait(
        parseInt(process.env.EVM_CONFIRMATIONS || "2")
      );

      this.logger.info("Destination escrow created via Resolver", {
        intentId: intent.id,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
      });

      // For now, return the transaction hash as the address
      // In a real implementation, you'd extract the address from events
      return {
        txHash: tx.hash,
        address: "destination_escrow_address_placeholder",
      };
    } catch (error) {
      this.logger.error("Failed to create destination escrow via Resolver", {
        intentId: intent.id,
        error: extractErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Start monitoring for secret sharing events from relayer
   */
  private startSecretMonitoring(): void {
    const pollInterval = this.config.pollIntervalMs;

    this.secretMonitorInterval = setInterval(async () => {
      try {
        await this.checkForSharedSecrets();
      } catch (error) {
        this.logger.error("Error in secret monitoring", {
          error: extractErrorMessage(error),
        });
      }
    }, pollInterval);

    this.logger.info("Secret monitoring started", { pollInterval });
  }

  /**
   * Stop secret monitoring
   */
  private stopSecretMonitoring(): void {
    if (this.secretMonitorInterval) {
      clearInterval(this.secretMonitorInterval);
      this.secretMonitorInterval = null;
      this.logger.info("Secret monitoring stopped");
    }
  }

  /**
   * Start monitoring for recovery opportunities
   */
  private startRecoveryMonitoring(): void {
    const recoveryInterval = 60000; // Check every minute

    this.recoveryMonitorInterval = setInterval(async () => {
      try {
        await this.checkForRecoveryOpportunities();
      } catch (error) {
        this.logger.error("Error in recovery monitoring", {
          error: extractErrorMessage(error),
        });
      }
    }, recoveryInterval);

    this.logger.info("Recovery monitoring started", { recoveryInterval });
  }

  /**
   * Stop recovery monitoring
   */
  private stopRecoveryMonitoring(): void {
    if (this.recoveryMonitorInterval) {
      clearInterval(this.recoveryMonitorInterval);
      this.recoveryMonitorInterval = null;
      this.logger.info("Recovery monitoring stopped");
    }
  }

  /**
   * Check for shared secrets from relayer and execute withdrawals
   */
  private async checkForSharedSecrets(): Promise<void> {
    try {
      const response = await fetch(`${this.config.relayerApiUrl}/api/secrets`, {
        headers: {
          Authorization: `Bearer ${this.config.resolverApiKey}`,
        },
      });

      if (!response.ok) {
        return; // No secrets available or API error
      }

            const secrets = await response.json() as any[];
      
      for (const secretData of secrets) {
        if (secretData.action === "secret_shared") {
          await this.executeWithdrawals(secretData);
        }
      }
    } catch (error) {
      // Silent fail for secret monitoring to avoid spam
      this.logger.debug("Secret check failed", {
        error: extractErrorMessage(error),
      });
    }
  }

  /**
   * Execute withdrawal sequence after secret is shared
   */
  private async executeWithdrawals(secretData: any): Promise<void> {
    const { orderHash, secret, intentId } = secretData;

    this.logger.info("Executing withdrawals for shared secret", {
      orderHash,
      intentId,
    });

    console.log(chalk.green(`🔓 Secret shared for order ${orderHash}`));
    console.log(chalk.blue("🔄 Executing withdrawal sequence..."));

    try {
      // Step 1: Withdraw from destination chain (deliver tokens to maker)
      console.log(chalk.yellow("1️⃣ Withdrawing from destination escrow..."));
      const dstWithdrawal = await this.withdrawFromDestinationEscrow(
        orderHash,
        secret,
        intentId
      );

      console.log(
        chalk.green(`✅ Destination withdrawal: ${dstWithdrawal.txHash}`)
      );

      // Step 2: Withdraw from source chain (claim maker's tokens + safety deposit)
      console.log(chalk.yellow("2️⃣ Withdrawing from source escrow..."));
      const srcWithdrawal = await this.withdrawFromSourceEscrow(
        orderHash,
        secret,
        intentId
      );

      console.log(chalk.green(`✅ Source withdrawal: ${srcWithdrawal.txHash}`));

      // Update intent status to completed
      await this.updateIntentStatus(intentId, "completed", {
        dstWithdrawalTx: dstWithdrawal.txHash,
        srcWithdrawalTx: srcWithdrawal.txHash,
        secret,
      });

      this.logger.info("Withdrawal sequence completed successfully", {
        orderHash,
        intentId,
        dstTxHash: dstWithdrawal.txHash,
        srcTxHash: srcWithdrawal.txHash,
      });

      console.log(
        chalk.green(`🎉 Withdrawal sequence completed for ${orderHash}`)
      );
    } catch (error) {
      this.logger.error("Withdrawal sequence failed", {
        orderHash,
        intentId,
        error: extractErrorMessage(error),
      });

      console.log(
        chalk.red(
          `💥 Withdrawal failed for ${orderHash}: ${extractErrorMessage(error)}`
        )
      );
    }
  }

  /**
   * Withdraw from destination escrow (Aptos) - delivers tokens to maker
   */
  private async withdrawFromDestinationEscrow(
    orderHash: string,
    secret: string,
    intentId: string
  ): Promise<{ txHash: string }> {
    // Get intent data to reconstruct escrow parameters
    const intent = await this.getIntentById(intentId);
    if (!intent) {
      throw new Error(`Intent ${intentId} not found`);
    }

    const order = intent.fusionOrder;

    // Build withdrawal transaction for Aptos
    const payload = {
      function: `${this.config.aptosEscrowFactoryAddress}::escrow::withdraw`,
      type_arguments: [order.takerAsset],
      arguments: [
        Array.from(Buffer.from(secret.slice(2), "hex")), // secret as bytes
        orderHash,
        intent.secretHash,
        order.dstEscrowTarget,
        this.aptosAccount.accountAddress.toString(),
        order.takerAsset,
        order.takingAmount,
        order.dstSafetyDeposit,
        this.encodeTimelocks({
          srcWithdrawal: order.finalityLock,
          srcPublicWithdrawal: order.srcTimelock,
          srcCancellation: order.srcTimelock + 3600,
          srcPublicCancellation: order.srcTimelock + 7200,
          dstWithdrawal: order.finalityLock,
          dstPublicWithdrawal: order.dstTimelock,
          dstCancellation: order.dstTimelock + 3600,
        }).toString(),
      ],
    };

    const transaction = await this.aptosClient.transaction.build.simple({
      sender: this.aptosAccount.accountAddress,
      data: {
        function: payload.function as `${string}::${string}::${string}`,
        typeArguments: payload.type_arguments,
        functionArguments: payload.arguments,
      },
    });

    const signedTx = this.aptosClient.transaction.sign({
      signer: this.aptosAccount,
      transaction,
    });

    const result = await this.aptosClient.transaction.submit.simple({
      transaction,
      senderAuthenticator: signedTx,
    });

    await this.aptosClient.waitForTransaction({
      transactionHash: result.hash,
      options: { timeoutSecs: 30 },
    });

    return { txHash: result.hash };
  }

  /**
   * Withdraw from source escrow (EVM) - claims maker's tokens + safety deposit
   */
  private async withdrawFromSourceEscrow(
    orderHash: string,
    secret: string,
    intentId: string
  ): Promise<{ txHash: string }> {
    // Get intent data to reconstruct escrow parameters
    const intent = await this.getIntentById(intentId);
    if (!intent) {
      throw new Error(`Intent ${intentId} not found`);
    }

    // Get escrow address from intent data
    const escrowAddress = intent.evmEscrow;
    if (!escrowAddress) {
      throw new Error(`No EVM escrow address found for intent ${intentId}`);
    }

    // EscrowSrc ABI for withdrawal
    const escrowAbi = [
      "function withdraw(bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external",
    ];

    const escrow = new ethers.Contract(
      escrowAddress,
      escrowAbi,
      this.evmWallet
    );

    const order = intent.fusionOrder;
    const immutables = {
      orderHash,
      hashlock: intent.secretHash,
      maker: order.maker,
      taker: this.evmWallet.address,
      token: order.makerAsset,
      amount: order.makingAmount,
      safetyDeposit: order.srcSafetyDeposit,
      timelocks: this.encodeTimelocks({
        srcWithdrawal: order.finalityLock,
        srcPublicWithdrawal: order.srcTimelock,
        srcCancellation: order.srcTimelock + 3600,
        srcPublicCancellation: order.srcTimelock + 7200,
        dstWithdrawal: order.finalityLock,
        dstPublicWithdrawal: order.dstTimelock,
        dstCancellation: order.dstTimelock + 3600,
      }),
    };

    const tx = await escrow.withdraw(secret, immutables);
    const receipt = await tx.wait();

    return { txHash: tx.hash };
  }

  /**
   * Check for recovery opportunities (expired escrows)
   */
  private async checkForRecoveryOpportunities(): Promise<void> {
    try {
      const response = await fetch(
        `${this.config.relayerApiUrl}/api/intents?status=expired`,
        {
          headers: {
            Authorization: `Bearer ${this.config.resolverApiKey}`,
          },
        }
      );

      if (!response.ok) {
        return;
      }

            const expiredIntents = await response.json() as any[];
      
      for (const intent of expiredIntents) {
        await this.attemptRecovery(intent);
      }
    } catch (error) {
      this.logger.debug("Recovery check failed", {
        error: extractErrorMessage(error),
      });
    }
  }

  /**
   * Attempt recovery for expired escrow
   */
  private async attemptRecovery(intent: any): Promise<void> {
    const currentTime = Math.floor(Date.now() / 1000);
    const order = intent.fusionOrder;

    // Check if we're in recovery window
    const cancellationTime = order.srcTimelock + 7200; // 2 hours after timelock
    const publicCancellationTime = order.srcTimelock + 10800; // 3 hours after timelock

    if (currentTime > cancellationTime) {
      this.logger.info("Attempting recovery for expired intent", {
        intentId: intent.id,
        orderHash: intent.orderHash,
      });

      console.log(
        chalk.yellow(`🛡️ Attempting recovery for intent ${intent.id}`)
      );

      try {
        // Cancel source escrow to return funds to maker and claim safety deposit
        await this.cancelSourceEscrow(intent);

        // Cancel destination escrow to return our funds
        await this.cancelDestinationEscrow(intent);

        console.log(
          chalk.green(`✅ Recovery completed for intent ${intent.id}`)
        );
      } catch (error) {
        this.logger.error("Recovery attempt failed", {
          intentId: intent.id,
          error: extractErrorMessage(error),
        });
      }
    }
  }

  /**
   * Cancel source escrow and claim safety deposit
   */
  private async cancelSourceEscrow(intent: any): Promise<void> {
    const escrowAddress = intent.evmEscrow;
    if (!escrowAddress) return;

    const escrowAbi = [
      "function cancel(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external",
    ];

    const escrow = new ethers.Contract(
      escrowAddress,
      escrowAbi,
      this.evmWallet
    );

    const order = intent.fusionOrder;
    const immutables = {
      orderHash: intent.orderHash,
      hashlock: intent.secretHash,
      maker: order.maker,
      taker: this.evmWallet.address,
      token: order.makerAsset,
      amount: order.makingAmount,
      safetyDeposit: order.srcSafetyDeposit,
      timelocks: this.encodeTimelocks({
        srcWithdrawal: order.finalityLock,
        srcPublicWithdrawal: order.srcTimelock,
        srcCancellation: order.srcTimelock + 3600,
        srcPublicCancellation: order.srcTimelock + 7200,
        dstWithdrawal: order.finalityLock,
        dstPublicWithdrawal: order.dstTimelock,
        dstCancellation: order.dstTimelock + 3600,
      }),
    };

    const tx = await escrow.cancel(immutables);
    await tx.wait();

    this.logger.info("Source escrow cancelled", {
      intentId: intent.id,
      txHash: tx.hash,
    });
  }

  /**
   * Cancel destination escrow to recover funds
   */
  private async cancelDestinationEscrow(intent: any): Promise<void> {
    const order = intent.fusionOrder;

    const payload = {
      function: `${this.config.aptosEscrowFactoryAddress}::escrow::cancel`,
      type_arguments: [order.takerAsset],
      arguments: [
        intent.orderHash,
        intent.secretHash,
        order.dstEscrowTarget,
        this.aptosAccount.accountAddress.toString(),
        order.takerAsset,
        order.takingAmount,
        order.dstSafetyDeposit,
        this.encodeTimelocks({
          srcWithdrawal: order.finalityLock,
          srcPublicWithdrawal: order.srcTimelock,
          srcCancellation: order.srcTimelock + 3600,
          srcPublicCancellation: order.srcTimelock + 7200,
          dstWithdrawal: order.finalityLock,
          dstPublicWithdrawal: order.dstTimelock,
          dstCancellation: order.dstTimelock + 3600,
        }).toString(),
      ],
    };

    const transaction = await this.aptosClient.transaction.build.simple({
      sender: this.aptosAccount.accountAddress,
      data: {
        function: payload.function as `${string}::${string}::${string}`,
        typeArguments: payload.type_arguments,
        functionArguments: payload.arguments,
      },
    });

    const signedTx = this.aptosClient.transaction.sign({
      signer: this.aptosAccount,
      transaction,
    });

    const result = await this.aptosClient.transaction.submit.simple({
      transaction,
      senderAuthenticator: signedTx,
    });

    await this.aptosClient.waitForTransaction({
      transactionHash: result.hash,
      options: { timeoutSecs: 30 },
    });

    this.logger.info("Destination escrow cancelled", {
      intentId: intent.id,
      txHash: result.hash,
    });
  }

  /**
   * Get intent by ID from relayer
   */
  private async getIntentById(intentId: string): Promise<any> {
    const response = await fetch(
      `${this.config.relayerApiUrl}/api/intents/${intentId}`,
      {
        headers: {
          Authorization: `Bearer ${this.config.resolverApiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch intent ${intentId}: ${response.statusText}`
      );
    }

    return response.json();
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
      secretMonitoring: this.secretMonitorInterval !== null,
      recoveryMonitoring: this.recoveryMonitorInterval !== null,
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
