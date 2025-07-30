import { db, saveDatabase } from "./database";
import { FusionPlusIntent } from "./types";

/**
 * RecoveryScheduler handles cleanup of expired intents and failed escrows
 * Implements Phase 4 (Recovery) of the Fusion+ protocol
 */
export class RecoveryScheduler {
  private isRunning = false;
  private schedulerInterval: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs = 30000; // 30 seconds

  constructor() {
    console.log("🔄 RecoveryScheduler initialized");
  }

  /**
   * Start the recovery scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.log("⚠️ RecoveryScheduler already running");
      return;
    }

    this.isRunning = true;
    console.log("🚀 Starting RecoveryScheduler...");

    // Start periodic checks
    this.schedulerInterval = setInterval(() => {
      this.checkForRecovery().catch((error) => {
        console.error("❌ Error in RecoveryScheduler:", error);
      });
    }, this.checkIntervalMs);

    // Run initial check
    this.checkForRecovery().catch((error) => {
      console.error("❌ Error in initial RecoveryScheduler check:", error);
    });
  }

  /**
   * Stop the recovery scheduler
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }

    console.log("🛑 RecoveryScheduler stopped");
  }

  /**
   * Check for intents that need recovery
   */
  private async checkForRecovery(): Promise<void> {
    try {
      await db.read();

      if (!db.data?.intents) {
        return;
      }

      const currentTime = Math.floor(Date.now() / 1000);

      // Find intents that need recovery
      const intentsNeedingRecovery = db.data.intents.filter((intent) =>
        this.needsRecovery(intent, currentTime)
      );

      for (const intent of intentsNeedingRecovery) {
        await this.handleRecovery(intent, currentTime);
      }

      if (intentsNeedingRecovery.length > 0) {
        await saveDatabase();
      }
    } catch (error) {
      console.error("Error in recovery check:", error);
    }
  }

  /**
   * Determine if an intent needs recovery
   */
  private needsRecovery(
    intent: FusionPlusIntent,
    currentTime: number
  ): boolean {
    // Skip if already in terminal state
    if (
      ["completed", "filled", "cancelled", "expired"].includes(intent.status)
    ) {
      return false;
    }

    // Check if intent has expired
    if (intent.fusionOrder.expiration <= currentTime) {
      return true;
    }

    // Check if timelock has expired for stuck intents
    if (this.hasTimelockExpired(intent, currentTime)) {
      return true;
    }

    // Check if intent has been stuck in processing for too long
    if (this.isStuckInProcessing(intent, currentTime)) {
      return true;
    }

    return false;
  }

  /**
   * Check if timelock has expired
   */
  private hasTimelockExpired(
    intent: FusionPlusIntent,
    currentTime: number
  ): boolean {
    // Only check timelock for intents with escrows created
    if (
      !["escrow_src_created", "escrow_dst_created", "secret_revealed"].includes(
        intent.status
      )
    ) {
      return false;
    }

    // Calculate timelock expiry based on creation time
    const creationTime = Math.floor(intent.createdAt / 1000);
    const maxTimelock = Math.max(
      intent.fusionOrder.srcTimelock,
      intent.fusionOrder.dstTimelock
    );

    const timelockExpiry =
      creationTime + maxTimelock + intent.fusionOrder.finalityLock;

    return currentTime >= timelockExpiry;
  }

  /**
   * Check if intent is stuck in processing state
   */
  private isStuckInProcessing(
    intent: FusionPlusIntent,
    currentTime: number
  ): boolean {
    // Consider stuck if in processing for more than 1 hour
    const stuckThresholdSeconds = 3600; // 1 hour
    const lastUpdateTime = Math.floor(intent.updatedAt / 1000);

    return (
      intent.status === "processing" &&
      currentTime - lastUpdateTime > stuckThresholdSeconds
    );
  }

  /**
   * Handle recovery for a specific intent
   */
  private async handleRecovery(
    intent: FusionPlusIntent,
    currentTime: number
  ): Promise<void> {
    const reasonForRecovery = this.getRecoveryReason(intent, currentTime);

    console.log(
      `🔄 Initiating recovery for intent ${intent.id}: ${reasonForRecovery}`
    );

    // Update intent status to expired/cancelled
    intent.status = "expired";
    intent.updatedAt = Date.now();
    intent.failureReason = reasonForRecovery;
    intent.phase = 4; // Recovery phase

    // TODO: In a full implementation, this would:
    // 1. Call contract functions to cancel escrows
    // 2. Return safety deposits to resolver
    // 3. Return locked assets to maker
    // 4. Emit recovery events for monitoring

    console.log(
      `✅ Intent ${intent.id} marked for recovery: ${reasonForRecovery}`
    );
  }

  /**
   * Get human-readable reason for recovery
   */
  private getRecoveryReason(
    intent: FusionPlusIntent,
    currentTime: number
  ): string {
    if (intent.fusionOrder.expiration <= currentTime) {
      return "Intent deadline expired";
    }

    if (this.hasTimelockExpired(intent, currentTime)) {
      return "Timelock expired";
    }

    if (this.isStuckInProcessing(intent, currentTime)) {
      return "Stuck in processing state";
    }

    return "Unknown recovery reason";
  }

  /**
   * Get recovery statistics
   */
  public async getRecoveryStats(): Promise<{
    totalRecovered: number;
    expiredIntents: number;
    timelockExpired: number;
    stuckInProcessing: number;
  }> {
    try {
      await db.read();

      if (!db.data?.intents) {
        return {
          totalRecovered: 0,
          expiredIntents: 0,
          timelockExpired: 0,
          stuckInProcessing: 0,
        };
      }

      const expiredIntents = db.data.intents.filter(
        (intent) => intent.status === "expired"
      );

      const stats = {
        totalRecovered: expiredIntents.length,
        expiredIntents: expiredIntents.filter((intent) =>
          intent.failureReason?.includes("deadline expired")
        ).length,
        timelockExpired: expiredIntents.filter((intent) =>
          intent.failureReason?.includes("Timelock expired")
        ).length,
        stuckInProcessing: expiredIntents.filter((intent) =>
          intent.failureReason?.includes("Stuck in processing")
        ).length,
      };

      return stats;
    } catch (error) {
      console.error("Error getting recovery stats:", error);
      return {
        totalRecovered: 0,
        expiredIntents: 0,
        timelockExpired: 0,
        stuckInProcessing: 0,
      };
    }
  }
}

// Singleton instance
let recoverySchedulerInstance: RecoveryScheduler | null = null;

/**
 * Get the singleton RecoveryScheduler instance
 */
export function getRecoveryScheduler(): RecoveryScheduler {
  if (!recoverySchedulerInstance) {
    recoverySchedulerInstance = new RecoveryScheduler();
  }
  return recoverySchedulerInstance;
}
