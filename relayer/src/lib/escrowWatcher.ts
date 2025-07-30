import { ethers } from "ethers";
import { db, saveDatabase } from "./database";
import { FusionPlusIntent } from "./types";

/**
 * EscrowWatcher monitors both source and destination chains for escrow creation
 * When both escrows are created and finality passed, it reveals the secret to resolvers
 */
export class EscrowWatcher {
  private isRunning = false;
  private watchInterval: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs = 15000; // 15 seconds

  constructor() {
    console.log("🔍 EscrowWatcher initialized");
  }

  /**
   * Start monitoring escrows
   */
  start(): void {
    if (this.isRunning) {
      console.log("⚠️ EscrowWatcher already running");
      return;
    }

    this.isRunning = true;
    console.log("🚀 Starting EscrowWatcher...");

    // Start polling
    this.watchInterval = setInterval(() => {
      this.checkEscrows().catch((error) => {
        console.error("❌ Error in EscrowWatcher:", error);
      });
    }, this.pollIntervalMs);

    // Run initial check
    this.checkEscrows().catch((error) => {
      console.error("❌ Error in initial EscrowWatcher check:", error);
    });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }

    console.log("🛑 EscrowWatcher stopped");
  }

  /**
   * Check all pending intents for escrow creation status
   */
  private async checkEscrows(): Promise<void> {
    try {
      await db.read();

      if (!db.data?.intents) {
        return;
      }

      // Get intents that need escrow monitoring
      const intentsToCheck = db.data.intents.filter(
        (intent) =>
          intent.status === "processing" ||
          intent.status === "escrow_src_created"
      );

      for (const intent of intentsToCheck) {
        await this.checkIntentEscrows(intent);
      }
    } catch (error) {
      console.error("Error checking escrows:", error);
    }
  }

  /**
   * Check escrow status for a specific intent
   */
  private async checkIntentEscrows(intent: FusionPlusIntent): Promise<void> {
    const currentTime = Math.floor(Date.now() / 1000);

    // Check if intent has expired
    if (intent.fusionOrder.expiration <= currentTime) {
      await this.markIntentExpired(intent);
      return;
    }

    // Check source chain escrow
    const srcEscrowExists = await this.checkSourceEscrow(intent);

    // Check destination chain escrow
    const dstEscrowExists = await this.checkDestinationEscrow(intent);

    // Update intent status based on escrow existence
    if (srcEscrowExists && dstEscrowExists) {
      // Both escrows exist - check finality and reveal secret
      await this.handleBothEscrowsCreated(intent);
    } else if (srcEscrowExists && intent.status !== "escrow_src_created") {
      // Only source escrow exists
      await this.updateIntentStatus(intent.id, "escrow_src_created");
    }
  }

  /**
   * Check if source chain escrow exists
   */
  private async checkSourceEscrow(intent: FusionPlusIntent): Promise<boolean> {
    try {
      // If we already have a src tx hash, consider it created
      if (intent.escrowSrcTxHash) {
        return await this.verifyTransaction(
          intent.escrowSrcTxHash,
          intent.fusionOrder.srcChain
        );
      }

      // TODO: Implement actual escrow contract verification
      // For now, return true if status indicates src escrow created
      return (
        intent.status === "escrow_src_created" ||
        intent.status === "escrow_dst_created"
      );
    } catch (error) {
      console.error(
        `Error checking source escrow for intent ${intent.id}:`,
        error
      );
      return false;
    }
  }

  /**
   * Check if destination chain escrow exists
   */
  private async checkDestinationEscrow(
    intent: FusionPlusIntent
  ): Promise<boolean> {
    try {
      // If we already have a dst tx hash, consider it created
      if (intent.escrowDstTxHash) {
        return await this.verifyTransaction(
          intent.escrowDstTxHash,
          intent.fusionOrder.dstChain
        );
      }

      // TODO: Implement actual escrow contract verification
      // For now, return true if status indicates dst escrow created
      return intent.status === "escrow_dst_created";
    } catch (error) {
      console.error(
        `Error checking destination escrow for intent ${intent.id}:`,
        error
      );
      return false;
    }
  }

  /**
   * Verify a transaction exists and is confirmed
   */
  private async verifyTransaction(
    txHash: string,
    chainId: number
  ): Promise<boolean> {
    try {
      if (chainId === 1000) {
        // Aptos chain - stub implementation
        // TODO: Implement Aptos transaction verification
        return true;
      }

      // EVM chain verification
      const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8545";
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      const receipt = await provider.getTransactionReceipt(txHash);
      return receipt?.status === 1;
    } catch (error) {
      console.error(`Error verifying transaction ${txHash}:`, error);
      return false;
    }
  }

  /**
   * Handle when both escrows are created - check finality and reveal secret
   */
  private async handleBothEscrowsCreated(
    intent: FusionPlusIntent
  ): Promise<void> {
    const currentTime = Math.floor(Date.now() / 1000);

    // Check if finality period has passed
    const finalityLockExpired = this.hasFinalityLockExpired(intent);

    if (finalityLockExpired) {
      console.log(
        `🔓 Finality lock expired for intent ${intent.id}, revealing secret`
      );
      await this.revealSecret(intent);
    } else {
      console.log(
        `⏳ Waiting for finality lock to expire for intent ${intent.id}`
      );
    }
  }

  /**
   * Check if finality lock period has expired
   */
  private hasFinalityLockExpired(intent: FusionPlusIntent): boolean {
    const currentTime = Math.floor(Date.now() / 1000);

    // Use the latest escrow creation time + finality lock
    const srcCreatedTime = intent.createdAt
      ? Math.floor(intent.createdAt / 1000)
      : currentTime;
    const finalityExpiry = srcCreatedTime + intent.fusionOrder.finalityLock;

    return currentTime >= finalityExpiry;
  }

  /**
   * Reveal secret to resolvers when both escrows are ready
   */
  private async revealSecret(intent: FusionPlusIntent): Promise<void> {
    try {
      // Update intent to secret_revealed status
      await this.updateIntentStatus(intent.id, "secret_revealed", {
        secretHash: intent.fusionOrder.secretHash,
        secretRevealedAt: Date.now(),
      });

      console.log(`🎯 Secret revealed for intent ${intent.id}`);

      // TODO: Implement actual secret distribution to resolvers
      // This would involve storing the actual secret and providing an endpoint
      // for authenticated resolvers to retrieve it
    } catch (error) {
      console.error(`Error revealing secret for intent ${intent.id}:`, error);
    }
  }

  /**
   * Mark an intent as expired
   */
  private async markIntentExpired(intent: FusionPlusIntent): Promise<void> {
    console.log(`⏰ Intent ${intent.id} has expired`);
    await this.updateIntentStatus(intent.id, "expired", {
      expiredAt: Date.now(),
      reason: "Intent deadline exceeded",
    });
  }

  /**
   * Update intent status in database
   */
  private async updateIntentStatus(
    intentId: string,
    status: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      await db.read();

      const intent = db.data?.intents?.find((i) => i.id === intentId);
      if (!intent) {
        console.error(`Intent ${intentId} not found`);
        return;
      }

      // Update intent
      intent.status = status as any;
      intent.updatedAt = Date.now();

      // Add metadata if provided
      if (metadata) {
        Object.assign(intent, metadata);
      }

      await saveDatabase();
      console.log(`✅ Updated intent ${intentId} status to ${status}`);
    } catch (error) {
      console.error(`Error updating intent ${intentId} status:`, error);
    }
  }
}

// Singleton instance
let escrowWatcherInstance: EscrowWatcher | null = null;

/**
 * Get the singleton EscrowWatcher instance
 */
export function getEscrowWatcher(): EscrowWatcher {
  if (!escrowWatcherInstance) {
    escrowWatcherInstance = new EscrowWatcher();
  }
  return escrowWatcherInstance;
}
