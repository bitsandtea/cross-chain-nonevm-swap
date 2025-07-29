"use strict";
/**
 * Resolver Main Entry Point
 * Implements Phase 1 of resolver_both_phases.md
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Resolver = void 0;
const events_1 = require("events");
const config_1 = require("./config");
const utils_1 = require("./lib/utils");
const BalanceManager_1 = require("./services/BalanceManager");
const IntentMonitor_1 = require("./services/IntentMonitor");
const Logger_1 = require("./services/Logger");
const ProfitabilityAnalyzer_1 = require("./services/ProfitabilityAnalyzer");
class Resolver extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.logger = (0, Logger_1.createLogger)("Resolver");
        this.isRunning = false;
        this.processingQueue = new Set();
        this.config = config || (0, config_1.loadResolverConfig)();
        // Initialize services
        this.intentMonitor = new IntentMonitor_1.IntentMonitor(this.config);
        this.profitabilityAnalyzer = new ProfitabilityAnalyzer_1.ProfitabilityAnalyzer(this.config);
        this.balanceManager = new BalanceManager_1.BalanceManager(this.config);
        // Setup event handlers
        this.setupEventHandlers();
    }
    /**
     * Start the resolver
     */
    async start() {
        if (this.isRunning) {
            this.logger.warn("Resolver is already running");
            return;
        }
        this.logger.info("Starting resolver", {
            evmWallet: this.balanceManager.getWalletAddresses().evm,
            aptosWallet: this.balanceManager.getWalletAddresses().aptos,
        });
        try {
            // Check initial balances
            const balanceCheck = await this.balanceManager.checkMinimumBalances();
            if (!balanceCheck.sufficient) {
                throw new Error(`Insufficient balances: EVM=${balanceCheck.balances.evm}, Aptos=${balanceCheck.balances.aptos}`);
            }
            this.logger.info("Balance check passed", balanceCheck.balances);
            // Start intent monitoring
            await this.intentMonitor.start();
            this.isRunning = true;
            this.logger.info("Resolver started successfully");
        }
        catch (error) {
            this.logger.error("Failed to start resolver:", (0, utils_1.extractErrorMessage)(error));
            throw error;
        }
    }
    /**
     * Stop the resolver
     */
    stop() {
        if (!this.isRunning) {
            return;
        }
        this.logger.info("Stopping resolver");
        this.intentMonitor.stop();
        this.isRunning = false;
        this.logger.info("Resolver stopped");
    }
    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        this.intentMonitor.on("newIntent", this.handleNewIntent.bind(this));
        this.intentMonitor.on("error", (error) => {
            this.logger.error("Intent monitor error:", (0, utils_1.extractErrorMessage)(error));
        });
    }
    /**
     * Handle new intent from the monitor
     */
    async handleNewIntent(intent) {
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
        }
        catch (error) {
            this.logger.error(`Failed to process intent ${intent.id}:`, (0, utils_1.extractErrorMessage)(error));
        }
        finally {
            this.processingQueue.delete(intent.id);
        }
    }
    /**
     * Process a single intent through Phase 1 flow
     */
    async processIntent(intent) {
        const startTime = Date.now();
        this.logger.info(`Processing intent ${intent.id}`, {
            maker: intent.fusionOrder.maker,
            srcChain: intent.fusionOrder.srcChain,
            dstChain: intent.fusionOrder.dstChain,
            makingAmount: intent.fusionOrder.makingAmount,
            takingAmount: intent.fusionOrder.takingAmount,
        });
        try {
            // Update status to processing
            await this.intentMonitor.updateIntentStatus(intent.id, "processing");
            // Step 1-2: Profitability analysis (1inch quote + cost calculation)
            const profitability = await this.profitabilityAnalyzer.analyzeProfitability(intent.fusionOrder);
            if (!profitability.profitable) {
                this.logger.info(`Intent ${intent.id} not profitable`, {
                    expectedProfit: profitability.expectedProfit,
                    error: profitability.error,
                });
                await this.intentMonitor.updateIntentStatus(intent.id, "failed", {
                    reason: "not_profitable",
                    profitability,
                });
                return;
            }
            // Step 3: Balance and liquidity checks
            const balanceCheck = await this.balanceManager.checkBalances(intent.fusionOrder);
            if (!balanceCheck.sufficient) {
                this.logger.warn(`Intent ${intent.id} insufficient balance`, {
                    balanceCheck,
                });
                await this.intentMonitor.updateIntentStatus(intent.id, "failed", {
                    reason: "insufficient_balance",
                    balanceCheck,
                });
                return;
            }
            // Step 4-5: Generate order parameters and order hash
            const secret = (0, utils_1.generateSecret)();
            const secretHash = (0, utils_1.hashSecret)(secret);
            const orderHash = this.generateOrderHash(intent.fusionOrder);
            const executionContext = {
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
                const event = {
                    intentId: intent.id,
                    success: true,
                    profit: profitability.expectedProfit,
                    txHashes: result.txHashes,
                    processingTime,
                };
                this.emit("orderProcessed", event);
                this.logger.info(`Intent ${intent.id} completed successfully`, {
                    processingTime,
                    profit: profitability.expectedProfit,
                });
            }
            else {
                await this.intentMonitor.updateIntentStatus(intent.id, "failed", {
                    reason: "escrow_creation_failed",
                    error: result.error,
                });
                this.logger.error(`Intent ${intent.id} escrow creation failed`, {
                    error: result.error,
                });
            }
        }
        catch (error) {
            const errorMessage = (0, utils_1.extractErrorMessage)(error);
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
    generateOrderHash(fusionOrder) {
        // Simplified hash generation for hackathon
        const hashInput = JSON.stringify({
            maker: fusionOrder.maker,
            makerAsset: fusionOrder.makerAsset,
            takerAsset: fusionOrder.takerAsset,
            makingAmount: fusionOrder.makingAmount,
            takingAmount: fusionOrder.takingAmount,
            salt: fusionOrder.salt,
        });
        return (0, utils_1.hashSecret)(hashInput);
    }
    /**
     * Create escrows on both chains (placeholder for hackathon)
     */
    async createEscrows(context) {
        try {
            this.logger.info("Creating escrows (placeholder implementation)", {
                intentId: context.intent.id,
                orderHash: context.orderHash,
            });
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
            return {
                success: true,
                txHashes,
            };
        }
        catch (error) {
            return {
                success: false,
                error: (0, utils_1.extractErrorMessage)(error),
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
exports.Resolver = Resolver;
/**
 * Main function to start the resolver
 */
async function main() {
    const resolver = new Resolver();
    // Handle graceful shutdown
    process.on("SIGINT", () => {
        console.log("\nShutting down resolver...");
        resolver.stop();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        console.log("\nShutting down resolver...");
        resolver.stop();
        process.exit(0);
    });
    try {
        await resolver.start();
        // Log status every 30 seconds
        setInterval(() => {
            const status = resolver.getStatus();
            console.log("Resolver Status:", JSON.stringify(status, null, 2));
        }, 30000);
    }
    catch (error) {
        console.error("Failed to start resolver:", error);
        process.exit(1);
    }
}
// Start the resolver if this file is run directly
if (require.main === module) {
    main().catch((error) => {
        console.error("Resolver crashed:", error);
        process.exit(1);
    });
}
exports.default = Resolver;
//# sourceMappingURL=index.js.map