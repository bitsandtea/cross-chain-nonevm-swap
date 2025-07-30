/**
 * Dual-Chain Tracking for Fusion+ LOP Integration
 * Monitors EVM EscrowCreatedSrc and Aptos EscrowCreated events
 */

import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { ethers } from "ethers";
import { EventEmitter } from "events";
import { db, saveDatabase } from "./database";

export interface EscrowEvent {
  orderHash: string;
  escrowAddress: string;
  chain: "evm" | "aptos";
  blockNumber: number;
  timestamp: number;
  immutables?: any;
}

export interface DualChainState {
  orderHash: string;
  srcEscrow?: EscrowEvent;
  dstEscrow?: EscrowEvent;
  finalityTs?: number;
  secretShared: boolean;
  status: "pending" | "ready" | "completed" | "failed";
}

export class DualChainTracker extends EventEmitter {
  private evmProvider: ethers.Provider;
  private aptosClient: Aptos;
  private escrowStates = new Map<string, DualChainState>();
  private isRunning = false;
  private aptosReconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private processedEvents = new Set<string>();

  // Contract addresses and ABIs
  private escrowFactoryAddress: string;
  private aptosFactoryAddress: string;
  private escrowFactoryABI = [
    "event EscrowCreatedSrc(bytes32 indexed orderHash, address indexed escrowAddr, bytes immutables)",
    "event SrcEscrowCreated(tuple(bytes32,bytes32,address,address,address,uint256,uint256,tuple(uint256)) srcImmutables, tuple(address,uint256,address,uint256,uint256) dstImmutablesComplement)",
  ];

  constructor(
    evmRpcUrl: string,
    escrowFactoryAddress: string,
    aptosRpcUrl?: string,
    aptosFactoryAddress?: string
  ) {
    super();
    this.evmProvider = new ethers.JsonRpcProvider(evmRpcUrl);
    this.escrowFactoryAddress = escrowFactoryAddress;

    // Initialize Aptos client
    const aptosNetwork = aptosRpcUrl?.includes("testnet")
      ? Network.TESTNET
      : Network.MAINNET;
    this.aptosClient = new Aptos(
      new AptosConfig({
        network: aptosNetwork,
        fullnode: aptosRpcUrl,
      })
    );
    this.aptosFactoryAddress = aptosFactoryAddress || "";
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Start EVM event listening
    await this.startEVMListener();

    // Start Aptos event listening
    await this.startAptosListener();

    console.log("DualChainTracker started");
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    console.log("DualChainTracker stopped");
  }

  private async startEVMListener(): Promise<void> {
    const factory = new ethers.Contract(
      this.escrowFactoryAddress,
      this.escrowFactoryABI,
      this.evmProvider
    );

    // Listen for EscrowCreatedSrc events (new LOP integration)
    factory.on(
      "EscrowCreatedSrc",
      async (
        orderHash: string,
        escrowAddr: string,
        immutables: string,
        event: any
      ) => {
        const escrowEvent: EscrowEvent = {
          orderHash,
          escrowAddress: escrowAddr,
          chain: "evm",
          blockNumber: event.blockNumber,
          timestamp: Date.now(),
          immutables,
        };

        await this.handleEscrowEvent(escrowEvent);
      }
    );

    // Also listen for legacy SrcEscrowCreated events for compatibility
    factory.on(
      "SrcEscrowCreated",
      async (srcImmutables: any, dstImmutablesComplement: any, event: any) => {
        const orderHash = srcImmutables.orderHash;
        const escrowEvent: EscrowEvent = {
          orderHash,
          escrowAddress: event.address, // Will need to compute from immutables
          chain: "evm",
          blockNumber: event.blockNumber,
          timestamp: Date.now(),
          immutables: srcImmutables,
        };

        await this.handleEscrowEvent(escrowEvent);
      }
    );

    console.log("EVM event listener started");
  }

  private async startAptosListener(): Promise<void> {
    if (!this.aptosFactoryAddress) {
      console.log("Aptos listener skipped - no factory address configured");
      return;
    }

    try {
      console.log("Starting Aptos event listener...");

      // Subscribe to EscrowCreated events from the factory module
      await this.setupAptosEventSubscription();

      console.log("Aptos event listener started successfully");
    } catch (error) {
      console.error("Failed to start Aptos listener:", error);
      await this.handleAptosReconnection();
    }
  }

  private async setupAptosEventSubscription(): Promise<void> {
    try {
      // Subscribe to module events for EscrowCreated
      const eventFilter = `${this.aptosFactoryAddress}::escrow::EscrowCreated`;

      // Poll for events periodically (Aptos doesn't have real-time WebSocket events)
      this.startAptosEventPolling();
    } catch (error) {
      console.error("Failed to setup Aptos event subscription:", error);
      throw error;
    }
  }

  private startAptosEventPolling(): void {
    const pollInterval = 5000; // Poll every 5 seconds

    const poll = async () => {
      if (!this.isRunning) return;

      try {
        await this.pollAptosEvents();
      } catch (error) {
        console.error("Error polling Aptos events:", error);
      }

      // Continue polling
      setTimeout(poll, pollInterval);
    };

    poll();
  }

  private async pollAptosEvents(): Promise<void> {
    try {
      // Get recent events from the factory module
      const events = await this.aptosClient.getModuleEventsByEventType({
        eventType: `${this.aptosFactoryAddress}::escrow::EscrowCreated`,
        options: {
          limit: 50, // Get last 50 events
          orderBy: [{ transaction_version: "desc" }],
        },
      });

      for (const event of events) {
        const eventKey = `${event.transaction_version}_${event.sequence_number}`;

        // Skip if already processed
        if (this.processedEvents.has(eventKey)) {
          continue;
        }

        this.processedEvents.add(eventKey);
        await this.handleAptosEscrowEvent(event);
      }
    } catch (error) {
      console.error("Failed to poll Aptos events:", error);
      throw error;
    }
  }

  private async handleAptosEscrowEvent(event: any): Promise<void> {
    try {
      // Parse event data according to the expected structure
      const eventData = event.data;

      const aptosEvent: EscrowEvent = {
        orderHash: eventData.order_hash,
        escrowAddress: eventData.escrow_address,
        chain: "aptos",
        blockNumber: parseInt(event.transaction_version),
        timestamp: Date.now(),
        immutables: eventData,
      };

      console.log("Received Aptos escrow event:", aptosEvent.orderHash);

      // Wait for finality before processing
      await this.waitForAptosFinality(aptosEvent);
    } catch (error) {
      console.error("Failed to handle Aptos escrow event:", error);
    }
  }

  private async waitForAptosFinality(event: EscrowEvent): Promise<void> {
    const finalityConfirmations = 12; // Default confirmations

    try {
      // Get current ledger version
      const ledgerInfo = await this.aptosClient.getLedgerInfo();
      const currentVersion = parseInt(ledgerInfo.ledger_version);
      const eventVersion = event.blockNumber;

      if (currentVersion - eventVersion >= finalityConfirmations) {
        // Event is already final
        await this.handleEscrowEvent(event);
      } else {
        // Wait for finality
        const remainingConfirmations =
          finalityConfirmations - (currentVersion - eventVersion);
        console.log(
          `Waiting for ${remainingConfirmations} more confirmations for Aptos event ${event.orderHash}`
        );

        // Schedule finality check
        setTimeout(async () => {
          await this.waitForAptosFinality(event);
        }, 10000); // Check again in 10 seconds
      }
    } catch (error) {
      console.error("Error waiting for Aptos finality:", error);
    }
  }

  private async handleAptosReconnection(): Promise<void> {
    if (this.aptosReconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max Aptos reconnection attempts reached");
      return;
    }

    this.aptosReconnectAttempts++;
    const delay = Math.pow(2, this.aptosReconnectAttempts) * 1000; // Exponential backoff

    console.log(
      `Attempting Aptos reconnection ${this.aptosReconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
    );

    setTimeout(async () => {
      try {
        await this.startAptosListener();
        this.aptosReconnectAttempts = 0; // Reset on successful reconnection
      } catch (error) {
        console.error("Aptos reconnection failed:", error);
        await this.handleAptosReconnection();
      }
    }, delay);
  }

  private async handleEscrowEvent(event: EscrowEvent): Promise<void> {
    let state = this.escrowStates.get(event.orderHash);

    if (!state) {
      state = {
        orderHash: event.orderHash,
        secretShared: false,
        status: "pending",
      };
      this.escrowStates.set(event.orderHash, state);
    }

    // Update state with escrow event
    if (event.chain === "evm") {
      state.srcEscrow = event;
    } else {
      state.dstEscrow = event;
    }

    // Check if both escrows are ready
    if (state.srcEscrow && state.dstEscrow && !state.secretShared) {
      await this.checkFinalityAndShareSecret(state);
    }

    this.emit("escrowEvent", event);
  }

  private async checkFinalityAndShareSecret(
    state: DualChainState
  ): Promise<void> {
    // Check if finality lock has passed
    const currentTime = Date.now();
    const finalityDelay = 300000; // 5 minutes default

    if (state.srcEscrow && state.dstEscrow) {
      const earliestFinality =
        Math.max(state.srcEscrow.timestamp, state.dstEscrow.timestamp) +
        finalityDelay;

      if (currentTime >= earliestFinality) {
        state.finalityTs = currentTime;
        state.status = "ready";

        // Share secret via lowdb storage
        await this.shareSecret(state.orderHash);

        state.secretShared = true;
        state.status = "completed";

        this.emit("secretShared", state);
      }
    }
  }

  private async shareSecret(orderHash: string): Promise<void> {
    try {
      // Store secret in lowdb for resolvers to consume
      const secretData = {
        orderHash,
        timestamp: Date.now(),
        action: "secret_shared" as const,
        processed: false,
      };

      // Ensure database is initialized
      if (!db.data) {
        await db.read();
      }

      // Add to secrets array
      db.data!.secrets.push(secretData);
      await saveDatabase();

      console.log(`Secret shared for order ${orderHash}`);
    } catch (error) {
      console.error(`Failed to share secret for order ${orderHash}:`, error);
    }
  }

  // Public methods for querying state
  public getEscrowState(orderHash: string): DualChainState | undefined {
    return this.escrowStates.get(orderHash);
  }

  public getAllStates(): DualChainState[] {
    return Array.from(this.escrowStates.values());
  }

  public getReadyStates(): DualChainState[] {
    return this.getAllStates().filter((state) => state.status === "ready");
  }
}
