/**
 * Intent Monitor Service
 * Enhanced for LOP integration with API-based secret polling
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
  private processedSecrets = new Set<string>();
  private lastPollTime = 0;

  constructor(config: ResolverConfig) {
    super();
    this.config = config;
  }

  /**
   * Start monitoring for new intents and secrets
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
  async stop(): Promise<void> {
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
        await this.pollForSecrets();
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
   * Poll the relayer API for new secrets
   */
  private async pollForSecrets(): Promise<void> {
    try {
      const response = await axios.get(
        `${this.config.relayerApiUrl}/api/secrets`,
        {
          headers: {
            Authorization: `Bearer ${this.config.resolverApiKey}`,
          },
          timeout: 5000,
        }
      );

      const secrets = response.data.secrets || [];

      for (const secret of secrets) {
        // Skip if already processed
        if (this.processedSecrets.has(secret.orderHash)) {
          continue;
        }

        this.processedSecrets.add(secret.orderHash);

        // Mark as processed in relayer
        await axios.patch(
          `${this.config.relayerApiUrl}/api/secrets`,
          { orderHash: secret.orderHash },
          {
            headers: {
              Authorization: `Bearer ${this.config.resolverApiKey}`,
            },
            timeout: 5000,
          }
        );

        // Emit secret shared event
        this.logger.info(`Secret received for order ${secret.orderHash}`);
        this.emit("secretShared", secret);
      }
    } catch (error) {
      this.logger.error(
        "Failed to poll for secrets:",
        extractErrorMessage(error)
      );
      // Don't throw - secrets polling is non-critical
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
          console.log(`🔧 [IntentMonitor] Making PATCH request...`);

          try {
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

            console.log(
              `🔧 [IntentMonitor] Response status: ${response.status}`
            );
            console.log(`🔧 [IntentMonitor] Response data:`, response.data);

            if (response.status !== 200) {
              throw new Error(
                `Failed to update intent status: ${response.status}`
              );
            }
          } catch (error: any) {
            // Check if this is a 400 error with "Invalid status transition" where currentStatus === newStatus
            if (
              error.response?.status === 400 &&
              error.response?.data?.error === "Invalid status transition" &&
              error.response?.data?.currentStatus === status
            ) {
              console.log(
                `🔧 [IntentMonitor] Intent ${intentId} already has status '${status}', treating as success`
              );
              return; // Exit successfully - no need to update
            }

            // Re-throw other errors for retry logic
            throw error;
          }
        },
        3,
        1000
      );

      console.log(
        `✅ [IntentMonitor] Successfully updated intent ${intentId} status to ${status}`
      );
      this.logger.debug(`Updated intent ${intentId} status to ${status}`);
    } catch (error) {
      console.log(
        `❌ [IntentMonitor] Failed to update intent ${intentId} status:`,
        error
      );
      console.log(`❌ [IntentMonitor] Error details:`, {
        message: (error as any).message,
        code: (error as any).code,
        response: (error as any).response?.data,
        status: (error as any).response?.status,
      });

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
   * Clear processed intents and secrets cache (for memory management)
   */
  clearProcessedCache(): void {
    const oldIntentsSize = this.processedIntents.size;
    const oldSecretsSize = this.processedSecrets.size;
    this.processedIntents.clear();
    this.processedSecrets.clear();
    this.logger.info(
      `Cleared processed cache: ${oldIntentsSize} intents, ${oldSecretsSize} secrets`
    );
  }
}
