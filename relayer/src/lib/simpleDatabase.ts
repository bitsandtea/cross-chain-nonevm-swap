import { promises as fs } from "fs";
import path from "path";

// Database schema types
export interface EscrowData {
  escrowAddress: string;
  hashlock: string;
  maker: string;
  taker: string;
  token: string;
  amount: string;
  safetyDeposit: string;
  timelocks: {
    deployedAt: number;
    srcWithdrawal: number;
    srcCancellation: number;
    dstWithdrawal: number;
    dstCancellation: number;
  };
  orderHash: string;
  chainId: number;
  status: "pending" | "funded" | "withdrawn" | "cancelled" | "rescued";
  createdAt: number;
  updatedAt: number;
}

export interface EscrowEvent {
  id: string;
  escrowAddress: string;
  type: "EscrowCreated" | "FundsClaimed" | "OrderCancelled" | "FundsRescued";
  hashlock: string;
  preimage?: string;
  blockNumber: number;
  transactionHash: string;
  chainId: number;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface DatabaseSchema {
  escrows: EscrowData[];
  events: EscrowEvent[];
  lastProcessedBlock: Record<number, number>; // chainId -> block number
}

const defaultData: DatabaseSchema = {
  escrows: [],
  events: [],
  lastProcessedBlock: {},
};

class SimpleDatabaseService {
  private dbPath: string;
  private data: DatabaseSchema;

  constructor() {
    this.dbPath = path.join(process.cwd(), "db", "escrow.json");
    this.data = { ...defaultData };
  }

  async initialize(): Promise<void> {
    try {
      const fileContent = await fs.readFile(this.dbPath, "utf-8");
      this.data = JSON.parse(fileContent);
    } catch (error) {
      // File doesn't exist or is invalid, use default data
      this.data = { ...defaultData };
      await this.saveToFile();
    }
  }

  private async saveToFile(): Promise<void> {
    await fs.writeFile(this.dbPath, JSON.stringify(this.data, null, 2));
  }

  // Escrow management
  async saveEscrow(escrow: EscrowData): Promise<void> {
    const existingIndex = this.data.escrows.findIndex(
      (e) =>
        e.escrowAddress === escrow.escrowAddress && e.chainId === escrow.chainId
    );

    if (existingIndex >= 0) {
      this.data.escrows[existingIndex] = {
        ...escrow,
        updatedAt: Date.now(),
      };
    } else {
      this.data.escrows.push({
        ...escrow,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    await this.saveToFile();
  }

  async getEscrow(
    escrowAddress: string,
    chainId: number
  ): Promise<EscrowData | undefined> {
    return this.data.escrows.find(
      (e) => e.escrowAddress === escrowAddress && e.chainId === chainId
    );
  }

  async getEscrowByHashlock(
    hashlock: string,
    chainId: number
  ): Promise<EscrowData | undefined> {
    return this.data.escrows.find(
      (e) => e.hashlock === hashlock && e.chainId === chainId
    );
  }

  async updateEscrowStatus(
    escrowAddress: string,
    chainId: number,
    status: EscrowData["status"]
  ): Promise<void> {
    const escrow = await this.getEscrow(escrowAddress, chainId);
    if (escrow) {
      escrow.status = status;
      escrow.updatedAt = Date.now();
      await this.saveEscrow(escrow);
    }
  }

  async getAllEscrows(): Promise<EscrowData[]> {
    return this.data.escrows;
  }

  async getAllEvents(): Promise<EscrowEvent[]> {
    return this.data.events;
  }

  // Event management
  async saveEvent(event: Omit<EscrowEvent, "id" | "timestamp">): Promise<void> {
    const eventId = `${event.chainId}-${event.transactionHash}-${event.blockNumber}`;

    // Check if event already exists
    const existingEvent = this.data.events.find((e) => e.id === eventId);
    if (existingEvent) {
      console.log(`⚠️ Event already exists: ${eventId}`);
      return;
    }

    const eventWithId: EscrowEvent = {
      ...event,
      id: eventId,
      timestamp: Date.now(),
    };

    this.data.events.push(eventWithId);
    await this.saveToFile();
  }

  async getEventsForEscrow(
    escrowAddress: string,
    chainId: number
  ): Promise<EscrowEvent[]> {
    return this.data.events.filter(
      (e) => e.escrowAddress === escrowAddress && e.chainId === chainId
    );
  }

  async getEventsByHashlock(
    hashlock: string,
    chainId: number
  ): Promise<EscrowEvent[]> {
    return this.data.events.filter(
      (e) => e.hashlock === hashlock && e.chainId === chainId
    );
  }

  // Block tracking
  async setLastProcessedBlock(
    chainId: number,
    blockNumber: number
  ): Promise<void> {
    this.data.lastProcessedBlock[chainId] = blockNumber;
    await this.saveToFile();
  }

  async getLastProcessedBlock(chainId: number): Promise<number> {
    return this.data.lastProcessedBlock[chainId] || 0;
  }

  // Utility methods
  async getEscrowsByStatus(
    status: EscrowData["status"]
  ): Promise<EscrowData[]> {
    return this.data.escrows.filter((e) => e.status === status);
  }

  async getEscrowsByChain(chainId: number): Promise<EscrowData[]> {
    return this.data.escrows.filter((e) => e.chainId === chainId);
  }
}

// Singleton instance
let databaseService: SimpleDatabaseService | null = null;

export async function getDatabase(): Promise<SimpleDatabaseService> {
  if (!databaseService) {
    databaseService = new SimpleDatabaseService();
    await databaseService.initialize();
  }
  return databaseService;
}

export { SimpleDatabaseService };
