/**
 * Intent Monitor Service
 * Enhanced for LOP integration with API-based secret polling
 */

import axios from "axios";
import { EventEmitter } from "events";

import { extractErrorMessage, retryAsync, sleep } from "../lib/utils";
import { Intent, ResolverConfig } from "../types";

export class IntentMonitor extends EventEmitter {
  private config: ResolverConfig;
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
      return;
    }

    this.isRunning = true;
    // Start the polling loop
    this.pollLoop().catch((error) => {
      console.log("Poll loop error:", extractErrorMessage(error));
      this.emit("error", error);
    });
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    this.isRunning = false;
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

      const processableIntents = intents.filter(
        (intent) =>
          intent.status === "pending" ||
          intent.status === "open" ||
          intent.status === "processing"
      );

      const newIntents = processableIntents.filter(
        (intent) => !this.processedIntents.has(intent.id)
      );

      if (newIntents.length > 0) {
        console.log(`Found ${newIntents.length} new intents`);

        for (const intent of newIntents) {
          this.processedIntents.add(intent.id);
          this.emit("newIntent", intent);
        }
      } else {
        console.log(
          `No new intents found. Total intents: ${intents.length}, processable: ${processableIntents.length}, processed: ${this.processedIntents.size}`
        );
        if (intents.length > 0) {
          console.log(
            "Intent statuses:",
            intents.map((i) => ({ id: i.id, status: i.status }))
          );

          // If we have processable intents but they're already processed,
          // let's clear the cache to allow reprocessing (useful for testing)
          if (processableIntents.length > 0 && newIntents.length === 0) {
            const enableAutoReprocess =
              process.env.ENABLE_AUTO_REPROCESS === "true";
            if (enableAutoReprocess) {
              console.log(
                "🔄 Auto-reprocessing enabled - clearing processed cache"
              );
              this.clearProcessedCache();
            } else {
              console.log(
                "ℹ️ Auto-reprocessing disabled. Set ENABLE_AUTO_REPROCESS=true to enable"
              );
            }
          }
        }
      }

      this.lastPollTime = Date.now();
    } catch (error) {
      console.log("Failed to poll for intents:", extractErrorMessage(error));
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

      // Handle different response formats
      let secrets: any[] = [];
      if (response.data && Array.isArray(response.data)) {
        secrets = response.data;
      } else if (response.data && Array.isArray(response.data.secrets)) {
        secrets = response.data.secrets;
      } else if (response.data && response.data.secrets) {
        console.log("Unexpected secrets response format:", response.data);
        return;
      } else {
        // If no secrets found, just return without error
        console.log("No secrets found in API response");
        return;
      }

      console.log(`Secrets API response: ${secrets.length} secrets found`);

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
        console.log(`Secret received for order ${secret.orderHash}`);
        this.emit("secretShared", secret);
      }
    } catch (error) {
      console.log("Failed to poll for secrets:", extractErrorMessage(error));
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

    if (typeof i.orderHash !== "string") {
      throw new Error("Invalid intent: missing or invalid orderHash");
    }

    if (typeof i.order !== "object" || i.order === null) {
      throw new Error("Invalid intent: missing or invalid order");
    }

    if (typeof i.signature !== "string") {
      throw new Error("Invalid intent: missing or invalid signature");
    }

    if (typeof i.status !== "string") {
      throw new Error("Invalid intent: missing or invalid status");
    }

    return {
      id: i.id,
      orderHash: i.orderHash,
      order: i.order as any, // Type assertion - validation happens in processor
      signature: i.signature,
      status: i.status as any,
      createdAt: typeof i.createdAt === "number" ? i.createdAt : Date.now(),
      updatedAt: typeof i.updatedAt === "number" ? i.updatedAt : Date.now(),
      resolverClaims: Array.isArray(i.resolverClaims) ? i.resolverClaims : [],
      secretHash: typeof i.secretHash === "string" ? i.secretHash : "",
      auctionStartTime:
        typeof i.auctionStartTime === "number" ? i.auctionStartTime : 0,
      auctionDuration:
        typeof i.auctionDuration === "number" ? i.auctionDuration : 0,
      startRate: typeof i.startRate === "string" ? i.startRate : "1.0",
      endRate: typeof i.endRate === "string" ? i.endRate : "1.0",
      finalityLock: typeof i.finalityLock === "number" ? i.finalityLock : 0,
      fillThresholds: Array.isArray(i.fillThresholds) ? i.fillThresholds : [],
      expiration: typeof i.expiration === "number" ? i.expiration : 0,
      srcChain: typeof i.srcChain === "number" ? i.srcChain : 1,
      dstChain: typeof i.dstChain === "number" ? i.dstChain : 1000,
      srcTimelock: typeof i.srcTimelock === "number" ? i.srcTimelock : 120,
      dstTimelock: typeof i.dstTimelock === "number" ? i.dstTimelock : 100,
      srcSafetyDeposit:
        typeof i.srcSafetyDeposit === "string"
          ? i.srcSafetyDeposit
          : "10000000000000000",
      dstSafetyDeposit:
        typeof i.dstSafetyDeposit === "string"
          ? i.dstSafetyDeposit
          : "10000000000000000",
      srcEscrowTarget:
        typeof i.srcEscrowTarget === "string"
          ? i.srcEscrowTarget
          : "0x0000000000000000000000000000000000000000",
      dstEscrowTarget:
        typeof i.dstEscrowTarget === "string"
          ? i.dstEscrowTarget
          : "0x0000000000000000000000000000000000000000",
      // Preserve the encoded SDK order data
      sdkOrderEncoded:
        typeof i.sdkOrderEncoded === "string" ? i.sdkOrderEncoded : undefined,
      extension: i.extension,
      signedChainId:
        typeof i.signedChainId === "number" ? i.signedChainId : undefined,
    };
  }

  /**
   * Get intent by ID from the relayer
   */
  async getIntentById(intentId: string): Promise<Intent | null> {
    try {
      const response = await axios.get(
        `${this.config.relayerApiUrl}/api/intents/${intentId}`,
        {
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.resolverApiKey}`,
          },
        }
      );

      if (response.status === 404) {
        return null;
      }

      if (response.status !== 200) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      return this.validateIntent(response.data.intent);
    } catch (error) {
      console.log(
        `Failed to get intent ${intentId}:`,
        extractErrorMessage(error)
      );
      return null;
    }
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

            if (response.status !== 200) {
              throw new Error(
                `Failed to update intent status: ${response.status}`
              );
            }
          } catch (error: any) {
            // Check if this is a 400 error with "Invalid status transition"
            if (
              error.response?.status === 400 &&
              error.response?.data?.error === "Invalid status transition"
            ) {
              const currentStatus = error.response?.data?.currentStatus;
              const newStatus = error.response?.data?.newStatus;

              // If the current status is already what we want, treat as success
              if (currentStatus === status) {
                console.log(
                  `🔧 [IntentMonitor] Intent ${intentId} already has status '${status}', treating as success`
                );
                return; // Exit successfully - no need to update
              }

              // If the transition is not allowed, log and continue without throwing
              console.log(
                `⚠️ [IntentMonitor] Invalid status transition for intent ${intentId}: ${currentStatus} -> ${newStatus}. Allowed transitions: ${
                  error.response?.data?.validTransitions?.join(", ") || "none"
                }`
              );

              // For now, let's continue processing even if status update fails
              // This allows the resolver to work even if the relayer has strict status rules
              console.log(
                `🔄 [IntentMonitor] Continuing to process intent ${intentId} despite status update failure`
              );
              return; // Exit successfully - we'll continue processing
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
      console.log(`Updated intent ${intentId} status to ${status}`);
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

      console.log(
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
    this.processedIntents.clear();
    this.processedSecrets.clear();
  }

  /**
   * Manually trigger processing of an intent (for testing)
   */
  async reprocessIntent(intentId: string): Promise<void> {
    this.processedIntents.delete(intentId);
    console.log(`🔄 Marked intent ${intentId} for reprocessing`);
  }
}
