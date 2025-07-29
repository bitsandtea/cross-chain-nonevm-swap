/**
 * Intent Monitor Service
 * Polls the relayer API for new intents and queues them for processing
 */

import axios from "axios";
import { EventEmitter } from "events";
import { extractErrorMessage, retryAsync, sleep } from "../lib/utils";
import { Intent, ResolverConfig } from "../types";
import { createLogger } from "./Logger";

export class IntentMonitor extends EventEmitter {
  private config: ResolverConfig;
  private logger = createLogger("IntentMonitor");
  private isRunning = false;
  private processedIntents = new Set<string>();
  private lastPollTime = 0;

  constructor(config: ResolverConfig) {
    super();
    this.config = config;
  }

  /**
   * Start monitoring for new intents
   */
  async start(): Promise<void> {
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
      this.logger.error("Poll loop error:", extractErrorMessage(error));
      this.emit("error", error);
    });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.isRunning = false;
    this.logger.info("Stopping intent monitor");
  }

  /**
   * Main polling loop
   */
  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.pollForIntents();
        await sleep(this.config.pollIntervalMs);
      } catch (error) {
        this.logger.error("Error in poll loop:", extractErrorMessage(error));
        await sleep(this.config.pollIntervalMs * 2); // Back off on error
      }
    }
  }

  /**
   * Poll the relayer API for new intents
   */
  private async pollForIntents(): Promise<void> {
    try {
      const intents = await retryAsync(() => this.fetchIntents(), 3, 1000);

      const newIntents = intents.filter(
        (intent) =>
          !this.processedIntents.has(intent.id) && intent.status === "pending"
      );

      if (newIntents.length > 0) {
        this.logger.info(`Found ${newIntents.length} new intents`);

        for (const intent of newIntents) {
          this.processedIntents.add(intent.id);
          this.emit("newIntent", intent);
        }
      }

      this.lastPollTime = Date.now();
    } catch (error) {
      this.logger.error(
        "Failed to poll for intents:",
        extractErrorMessage(error)
      );
      throw error;
    }
  }

  /**
   * Fetch intents from the relayer API
   */
  private async fetchIntents(): Promise<Intent[]> {
    const response = await axios.get(
      `${this.config.relayerApiUrl}/api/intents`,
      {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    // Assuming the API returns { intents: Intent[] }
    const data = response.data;

    if (!Array.isArray(data.intents)) {
      throw new Error("Invalid response format: expected intents array");
    }

    return data.intents.map((intent: any) => this.validateIntent(intent));
  }

  /**
   * Validate intent structure
   */
  private validateIntent(intent: unknown): Intent {
    if (typeof intent !== "object" || intent === null) {
      throw new Error("Invalid intent: not an object");
    }

    const i = intent as Record<string, unknown>;

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
      fusionOrder: i.fusionOrder as any, // Type assertion - validation happens in processor
      signature: i.signature,
      nonce: i.nonce,
      status: i.status as any,
      createdAt: typeof i.createdAt === "number" ? i.createdAt : Date.now(),
      updatedAt: typeof i.updatedAt === "number" ? i.updatedAt : Date.now(),
    };
  }

  /**
   * Update intent status in the relayer
   */
  async updateIntentStatus(
    intentId: string,
    status: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      await retryAsync(
        async () => {
          const response = await axios.patch(
            `${this.config.relayerApiUrl}/api/intents/${intentId}`,
            {
              status,
              ...metadata,
            },
            {
              timeout: 5000,
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.config.resolverApiKey}`,
              },
            }
          );

          if (response.status !== 200) {
            throw new Error(
              `Failed to update intent status: ${response.status}`
            );
          }
        },
        3,
        1000
      );

      this.logger.debug(`Updated intent ${intentId} status to ${status}`);
    } catch (error) {
      this.logger.error(
        `Failed to update intent ${intentId} status:`,
        extractErrorMessage(error)
      );
      throw error;
    }
  }

  /**
   * Get health status
   */
  getHealthStatus(): {
    healthy: boolean;
    lastPoll: number;
    processedCount: number;
  } {
    const now = Date.now();
    const timeSinceLastPoll = now - this.lastPollTime;
    const healthy =
      this.isRunning && timeSinceLastPoll < this.config.pollIntervalMs * 3;

    return {
      healthy,
      lastPoll: this.lastPollTime,
      processedCount: this.processedIntents.size,
    };
  }

  /**
   * Clear processed intents cache (for memory management)
   */
  clearProcessedCache(): void {
    const oldSize = this.processedIntents.size;
    this.processedIntents.clear();
    this.logger.info(`Cleared processed intents cache (${oldSize} entries)`);
  }
}
