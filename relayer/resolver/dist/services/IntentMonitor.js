"use strict";
/**
 * Intent Monitor Service
 * Polls the relayer API for new intents and queues them for processing
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentMonitor = void 0;
const axios_1 = __importDefault(require("axios"));
const events_1 = require("events");
const utils_1 = require("../lib/utils");
const Logger_1 = require("./Logger");
class IntentMonitor extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.logger = (0, Logger_1.createLogger)("IntentMonitor");
        this.isRunning = false;
        this.processedIntents = new Set();
        this.lastPollTime = 0;
        this.config = config;
    }
    /**
     * Start monitoring for new intents
     */
    async start() {
        if (this.isRunning) {
            this.logger.warn("Intent monitor is already running");
            return;
        }
        this.isRunning = true;
        this.logger.info("Starting intent monitor", {
            relayerUrl: this.config.relayerApiUrl,
            pollInterval: this.config.pollIntervalMs,
        });
        // Start the polling loop
        this.pollLoop().catch((error) => {
            this.logger.error("Poll loop error:", (0, utils_1.extractErrorMessage)(error));
            this.emit("error", error);
        });
    }
    /**
     * Stop monitoring
     */
    stop() {
        this.isRunning = false;
        this.logger.info("Stopping intent monitor");
    }
    /**
     * Main polling loop
     */
    async pollLoop() {
        while (this.isRunning) {
            try {
                await this.pollForIntents();
                await (0, utils_1.sleep)(this.config.pollIntervalMs);
            }
            catch (error) {
                this.logger.error("Error in poll loop:", (0, utils_1.extractErrorMessage)(error));
                await (0, utils_1.sleep)(this.config.pollIntervalMs * 2); // Back off on error
            }
        }
    }
    /**
     * Poll the relayer API for new intents
     */
    async pollForIntents() {
        try {
            const intents = await (0, utils_1.retryAsync)(() => this.fetchIntents(), 3, 1000);
            const newIntents = intents.filter((intent) => !this.processedIntents.has(intent.id) && intent.status === "pending");
            if (newIntents.length > 0) {
                this.logger.info(`Found ${newIntents.length} new intents`);
                for (const intent of newIntents) {
                    this.processedIntents.add(intent.id);
                    this.emit("newIntent", intent);
                }
            }
            this.lastPollTime = Date.now();
        }
        catch (error) {
            this.logger.error("Failed to poll for intents:", (0, utils_1.extractErrorMessage)(error));
            throw error;
        }
    }
    /**
     * Fetch intents from the relayer API
     */
    async fetchIntents() {
        const response = await axios_1.default.get(`${this.config.relayerApiUrl}/api/intents`, {
            timeout: 10000,
            headers: {
                "Content-Type": "application/json",
            },
        });
        if (response.status !== 200) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        // Assuming the API returns { intents: Intent[] }
        const data = response.data;
        if (!Array.isArray(data.intents)) {
            throw new Error("Invalid response format: expected intents array");
        }
        return data.intents.map((intent) => this.validateIntent(intent));
    }
    /**
     * Validate intent structure
     */
    validateIntent(intent) {
        if (typeof intent !== "object" || intent === null) {
            throw new Error("Invalid intent: not an object");
        }
        const i = intent;
        if (typeof i.id !== "string") {
            throw new Error("Invalid intent: missing or invalid id");
        }
        if (typeof i.fusionOrder !== "object" || i.fusionOrder === null) {
            throw new Error("Invalid intent: missing or invalid fusionOrder");
        }
        if (typeof i.signature !== "string") {
            throw new Error("Invalid intent: missing or invalid signature");
        }
        if (typeof i.nonce !== "number") {
            throw new Error("Invalid intent: missing or invalid nonce");
        }
        if (typeof i.status !== "string") {
            throw new Error("Invalid intent: missing or invalid status");
        }
        return {
            id: i.id,
            fusionOrder: i.fusionOrder, // Type assertion - validation happens in processor
            signature: i.signature,
            nonce: i.nonce,
            status: i.status,
            createdAt: typeof i.createdAt === "number" ? i.createdAt : Date.now(),
            updatedAt: typeof i.updatedAt === "number" ? i.updatedAt : Date.now(),
        };
    }
    /**
     * Update intent status in the relayer
     */
    async updateIntentStatus(intentId, status, metadata) {
        try {
            await (0, utils_1.retryAsync)(async () => {
                const response = await axios_1.default.patch(`${this.config.relayerApiUrl}/api/intents/${intentId}`, {
                    status,
                    ...metadata,
                }, {
                    timeout: 5000,
                    headers: {
                        "Content-Type": "application/json",
                    },
                });
                if (response.status !== 200) {
                    throw new Error(`Failed to update intent status: ${response.status}`);
                }
            }, 3, 1000);
            this.logger.debug(`Updated intent ${intentId} status to ${status}`);
        }
        catch (error) {
            this.logger.error(`Failed to update intent ${intentId} status:`, (0, utils_1.extractErrorMessage)(error));
            throw error;
        }
    }
    /**
     * Get health status
     */
    getHealthStatus() {
        const now = Date.now();
        const timeSinceLastPoll = now - this.lastPollTime;
        const healthy = this.isRunning && timeSinceLastPoll < this.config.pollIntervalMs * 3;
        return {
            healthy,
            lastPoll: this.lastPollTime,
            processedCount: this.processedIntents.size,
        };
    }
    /**
     * Clear processed intents cache (for memory management)
     */
    clearProcessedCache() {
        const oldSize = this.processedIntents.size;
        this.processedIntents.clear();
        this.logger.info(`Cleared processed intents cache (${oldSize} entries)`);
    }
}
exports.IntentMonitor = IntentMonitor;
//# sourceMappingURL=IntentMonitor.js.map