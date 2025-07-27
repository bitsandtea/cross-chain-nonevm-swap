#!/usr/bin/env ts-node

import { ethers } from "ethers";
import {
  DstImmutablesComplement,
  ListenerConfig,
  SrcImmutables,
  createEscrowContract,
  createFactoryContract,
  getConfigFromEnv,
  isEventLog,
  processDstEscrowCreatedEvent,
  processSrcEscrowCreatedEvent,
  saveEvent,
  updateEscrowWithCompleteData,
} from "../src/lib/escrowUtils";
import { getDatabase } from "../src/lib/simpleDatabase";

class EscrowEventListener {
  private provider: ethers.JsonRpcProvider;
  private factoryContract: ethers.Contract;
  private config: ListenerConfig;
  private isListening: boolean = false;
  private lastProcessedBlock: number;
  private monitoredEscrows: Set<string> = new Set();

  constructor(config: ListenerConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.lastProcessedBlock = config.startBlock || 0;
    this.factoryContract = createFactoryContract(
      config.factoryAddress,
      this.provider
    );
  }

  async start(): Promise<void> {
    if (this.isListening) return;

    this.isListening = true;
    console.log("🚀 Starting Event Listener");
    console.log("=".repeat(50));
    console.log(`📡 RPC URL: ${this.config.rpcUrl}`);
    console.log(`🏭 Factory Address: ${this.config.factoryAddress}`);
    console.log(`⛓️  Chain ID: ${this.config.chainId}`);
    console.log(`📦 Start Block: ${this.lastProcessedBlock || "latest"}`);

    try {
      // Test connection
      const currentBlock = await this.provider.getBlockNumber();
      console.log(`✅ Connected! Current block: ${currentBlock}`);

      // Get current block if not specified
      if (this.lastProcessedBlock === 0) {
        this.lastProcessedBlock = currentBlock;
        console.log(`📍 Starting from block: ${this.lastProcessedBlock}`);
      }
    } catch (error) {
      console.error("❌ Failed to connect to RPC:", error);
      return;
    }

    console.log("\n👂 Setting up event listeners...");

    // Start listening for new blocks
    this.provider.on("block", async (blockNumber: number) => {
      await this.processNewBlocks(blockNumber);
    });

    // Listen for SrcEscrowCreated events
    this.factoryContract.on(
      "SrcEscrowCreated",
      async (
        srcImmutables: SrcImmutables,
        dstImmutablesComplement: DstImmutablesComplement,
        event: ethers.EventLog
      ) => {
        const escrowEvent = await processSrcEscrowCreatedEvent(
          srcImmutables,
          dstImmutablesComplement,
          event,
          this.config.chainId,
          this.factoryContract
        );

        console.log("New source escrow created:", escrowEvent);
        await saveEvent(escrowEvent);

        // Start monitoring this escrow
        if (escrowEvent.escrowAddress) {
          await this.startMonitoringEscrow(escrowEvent.escrowAddress);
        }
      }
    );

    // Listen for DstEscrowCreated events
    this.factoryContract.on(
      "DstEscrowCreated",
      async (
        escrow: string,
        hashlock: string,
        taker: bigint,
        event: ethers.EventLog
      ) => {
        console.log("🔍 RAW DstEscrowCreated event data:", {
          escrow,
          hashlock,
          taker: taker.toString(),
          args: event.args,
          topics: event.topics,
          data: event.data,
        });

        const escrowEvent = await processDstEscrowCreatedEvent(
          escrow,
          hashlock,
          taker,
          event,
          this.config.chainId
        );

        console.log("New destination escrow created:", escrowEvent);
        await saveEvent(escrowEvent);

        // Start monitoring this escrow
        await this.startMonitoringEscrow(escrow);
      }
    );

    console.log("✅ Event listeners active! Watching for:");
    console.log("   - SrcEscrowCreated events");
    console.log("   - DstEscrowCreated events");
    console.log("   - New blocks for historical events");
    console.log(
      "   - Individual escrow events (withdrawals, cancellations, rescues)"
    );
    console.log("\n🔍 Waiting for events... (Ctrl+C to stop)");
  }

  async stop(): Promise<void> {
    this.isListening = false;
    this.provider.removeAllListeners();
    this.factoryContract.removeAllListeners();

    // Remove all escrow listeners
    for (const escrowAddress of this.monitoredEscrows) {
      try {
        const escrowContract = createEscrowContract(
          escrowAddress,
          this.provider
        );
        escrowContract.removeAllListeners();
      } catch (error) {
        console.error(
          `Error removing listeners for escrow ${escrowAddress}:`,
          error
        );
      }
    }

    console.log(`Stopped event listener for chain ${this.config.chainId}`);
  }

  private async startMonitoringEscrow(escrowAddress: string): Promise<void> {
    if (this.monitoredEscrows.has(escrowAddress)) {
      return; // Already monitoring
    }

    try {
      const escrowContract = createEscrowContract(escrowAddress, this.provider);

      // Fetch and update escrow data immediately
      await updateEscrowWithCompleteData(
        escrowAddress,
        this.config.chainId,
        this.provider
      );

      // Listen for EscrowWithdrawal events
      escrowContract.on(
        "EscrowWithdrawal",
        async (secret: string, event: ethers.EventLog) => {
          console.log(
            `💰 Escrow ${escrowAddress} withdrawal with secret:`,
            secret
          );

          // Get escrow data to include in event
          const db = await getDatabase();
          const escrow = await db.getEscrow(escrowAddress, this.config.chainId);

          const withdrawalEvent = {
            type: "FundsClaimed" as const,
            escrowAddress,
            maker: escrow?.maker || "",
            taker: escrow?.taker || "",
            token: escrow?.token || "",
            amount: escrow?.amount || "",
            hashlock: escrow?.hashlock || "",
            timelock: escrow?.timelocks?.srcWithdrawal || 0,
            preimage: secret,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            chainId: this.config.chainId,
          };

          await saveEvent(withdrawalEvent);
        }
      );

      // Listen for EscrowCancelled events
      escrowContract.on("EscrowCancelled", async (event: ethers.EventLog) => {
        console.log(`❌ Escrow ${escrowAddress} cancelled`);

        // Get escrow data to include in event
        const db = await getDatabase();
        const escrow = await db.getEscrow(escrowAddress, this.config.chainId);

        const cancellationEvent = {
          type: "OrderCancelled" as const,
          escrowAddress,
          maker: escrow?.maker || "",
          taker: escrow?.taker || "",
          token: escrow?.token || "",
          amount: escrow?.amount || "",
          hashlock: escrow?.hashlock || "",
          timelock: escrow?.timelocks?.srcCancellation || 0,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          chainId: this.config.chainId,
        };

        await saveEvent(cancellationEvent);
      });

      // Listen for FundsRescued events
      escrowContract.on(
        "FundsRescued",
        async (token: string, amount: bigint, event: ethers.EventLog) => {
          console.log(`🆘 Escrow ${escrowAddress} funds rescued:`, {
            token,
            amount: amount.toString(),
          });

          // Get escrow data to include in event
          const db = await getDatabase();
          const escrow = await db.getEscrow(escrowAddress, this.config.chainId);

          const rescueEvent = {
            type: "FundsRescued" as const,
            escrowAddress,
            maker: escrow?.maker || "",
            taker: escrow?.taker || "",
            token: escrow?.token || "",
            amount: escrow?.amount || "",
            hashlock: escrow?.hashlock || "",
            timelock: escrow?.timelocks?.srcCancellation || 0,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            chainId: this.config.chainId,
          };

          await saveEvent(rescueEvent);
        }
      );

      this.monitoredEscrows.add(escrowAddress);
      console.log(`📡 Started monitoring escrow: ${escrowAddress}`);
    } catch (error) {
      console.error(
        `Error setting up escrow monitoring for ${escrowAddress}:`,
        error
      );
    }
  }

  private async processNewBlocks(latestBlock: number): Promise<void> {
    try {
      // Process blocks in batches to avoid rate limits
      const batchSize = 10;
      const fromBlock = this.lastProcessedBlock + 1;
      const toBlock = Math.min(fromBlock + batchSize - 1, latestBlock);

      if (fromBlock > toBlock) return;

      // Get SrcEscrowCreated events
      const srcEvents = await this.factoryContract.queryFilter(
        "SrcEscrowCreated",
        fromBlock,
        toBlock
      );

      for (const event of srcEvents) {
        if (!isEventLog(event)) continue;

        const srcImmutables = event.args[0] as SrcImmutables;
        const dstImmutablesComplement = event
          .args[1] as DstImmutablesComplement;
        const escrowEvent = await processSrcEscrowCreatedEvent(
          srcImmutables,
          dstImmutablesComplement,
          event,
          this.config.chainId,
          this.factoryContract
        );

        console.log("Historical source escrow found:", escrowEvent);
        await saveEvent(escrowEvent);

        // Start monitoring this escrow
        if (escrowEvent.escrowAddress) {
          await this.startMonitoringEscrow(escrowEvent.escrowAddress);
        }
      }

      // Get DstEscrowCreated events
      const dstEvents = await this.factoryContract.queryFilter(
        "DstEscrowCreated",
        fromBlock,
        toBlock
      );

      for (const event of dstEvents) {
        if (!isEventLog(event)) continue;

        const escrowEvent = await processDstEscrowCreatedEvent(
          event.args[0] as string, // escrow address
          event.args[1] as string, // hashlock
          event.args[2] as bigint, // taker
          event,
          this.config.chainId
        );

        console.log("Historical destination escrow found:", escrowEvent);
        await saveEvent(escrowEvent);

        // Start monitoring this escrow
        await this.startMonitoringEscrow(escrowEvent.escrowAddress);
      }

      // Process individual escrow events for monitored escrows
      for (const escrowAddress of this.monitoredEscrows) {
        await this.processEscrowEvents(escrowAddress, fromBlock, toBlock);
      }

      this.lastProcessedBlock = toBlock;

      // Save last processed block to database
      const db = await getDatabase();
      await db.setLastProcessedBlock(
        this.config.chainId,
        this.lastProcessedBlock
      );
    } catch (error) {
      console.error("Error processing blocks:", error);
    }
  }

  private async processEscrowEvents(
    escrowAddress: string,
    fromBlock: number,
    toBlock: number
  ): Promise<void> {
    try {
      const escrowContract = createEscrowContract(escrowAddress, this.provider);

      // Get EscrowWithdrawal events
      const withdrawalEvents = await escrowContract.queryFilter(
        "EscrowWithdrawal",
        fromBlock,
        toBlock
      );
      for (const event of withdrawalEvents) {
        if (!isEventLog(event)) continue;

        const secret = event.args[0] as string;
        console.log(
          `💰 Historical withdrawal for escrow ${escrowAddress}:`,
          secret
        );

        const withdrawalEvent = {
          type: "FundsClaimed" as const,
          escrowAddress,
          maker: "",
          taker: "",
          token: "",
          amount: "",
          hashlock: "",
          timelock: 0,
          preimage: secret,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          chainId: this.config.chainId,
        };

        await saveEvent(withdrawalEvent);
      }

      // Get EscrowCancelled events
      const cancellationEvents = await escrowContract.queryFilter(
        "EscrowCancelled",
        fromBlock,
        toBlock
      );
      for (const event of cancellationEvents) {
        if (!isEventLog(event)) continue;

        console.log(`❌ Historical cancellation for escrow ${escrowAddress}`);

        const cancellationEvent = {
          type: "OrderCancelled" as const,
          escrowAddress,
          maker: "",
          taker: "",
          token: "",
          amount: "",
          hashlock: "",
          timelock: 0,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          chainId: this.config.chainId,
        };

        await saveEvent(cancellationEvent);
      }

      // Get FundsRescued events
      const rescueEvents = await escrowContract.queryFilter(
        "FundsRescued",
        fromBlock,
        toBlock
      );
      for (const event of rescueEvents) {
        if (!isEventLog(event)) continue;

        const token = event.args[0] as string;
        const amount = event.args[1] as bigint;
        console.log(`🆘 Historical rescue for escrow ${escrowAddress}:`, {
          token,
          amount: amount.toString(),
        });

        const rescueEvent = {
          type: "FundsRescued" as const,
          escrowAddress,
          maker: "",
          taker: "",
          token: "",
          amount: "",
          hashlock: "",
          timelock: 0,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          chainId: this.config.chainId,
        };

        await saveEvent(rescueEvent);
      }
    } catch (error) {
      console.error(
        `Error processing events for escrow ${escrowAddress}:`,
        error
      );
    }
  }

  async getLatestBlock(): Promise<number> {
    return await this.provider.getBlockNumber();
  }
}

// Main function
async function main() {
  const config = getConfigFromEnv();
  const listener = new EscrowEventListener(config);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await listener.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("Shutting down...");
    await listener.stop();
    process.exit(0);
  });

  await listener.start();
}

if (require.main === module) {
  main().catch(console.error);
}

export { EscrowEventListener };
