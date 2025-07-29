// Fusion+ Intent Monitor with Dual-Chain State Machine
// Tracks orders across EVM (source) and Aptos (destination) chains

import { ethers } from 'ethers';

export interface OrderState {
  orderHash: string;
  srcEscrow?: {
    address: string;
    chainId: number;
    blockNumber: number;
    confirmed: boolean;
  };
  dstEscrow?: {
    address: string;
    chainId: number;
    blockNumber: number;
    confirmed: boolean;
  };
  finalityTs?: number;
  secretShared: boolean;
  status: 'pending' | 'src_created' | 'dst_created' | 'both_confirmed' | 'finalized' | 'completed';
  createdAt: number;
  updatedAt: number;
}

export interface FinalityConfig {
  evmConfirmations: number;
  aptosConfirmations: number;
  finalityLockDuration: number; // seconds
}

export interface ChainConfig {
  rpcUrl: string;
  factoryAddress: string;
  startBlock?: number;
}

export interface MonitorConfig {
  evmChain: ChainConfig;
  aptosChain: ChainConfig;
  finality: FinalityConfig;
  secretBroadcastUrl?: string; // Redis pub/sub endpoint
}

/**
 * Dual-chain intent monitor for Fusion+ orders
 * Tracks escrow creation on both chains and manages secret release
 */
export class IntentMonitor {
  private config: MonitorConfig;
  private orderStates: Map<string, OrderState> = new Map();
  private evmProvider: ethers.JsonRpcProvider;
  private evmFactory: ethers.Contract;
  private isRunning: boolean = false;

  constructor(config: MonitorConfig) {
    this.config = config;
    this.evmProvider = new ethers.JsonRpcProvider(config.evmChain.rpcUrl);
    
    const factoryAbi = [
      "event EscrowCreatedSrc(bytes32 indexed orderHash, address indexed escrow, bytes immutables)",
      "event DstEscrowCreated(address escrow, bytes32 hashlock, address taker)"
    ];
    
    this.evmFactory = new ethers.Contract(
      config.evmChain.factoryAddress,
      factoryAbi,
      this.evmProvider
    );
  }

  /**
   * Start monitoring both chains for escrow events
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('🚀 Starting Fusion+ Intent Monitor');
    console.log(`📡 EVM Chain: ${this.config.evmChain.rpcUrl}`);
    console.log(`🟦 Aptos Chain: ${this.config.aptosChain.rpcUrl}`);

    // Start EVM listeners
    await this.startEvmListeners();
    
    // Start Aptos listeners
    await this.startAptosListeners();
    
    // Start finality checker
    this.startFinalityChecker();

    console.log('✅ Intent Monitor is running');
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.evmFactory.removeAllListeners();
    console.log('🛑 Intent Monitor stopped');
  }

  /**
   * Start listening for EVM escrow events
   */
  private async startEvmListeners(): Promise<void> {
    // Listen for new EscrowCreatedSrc events from LOP integration
    this.evmFactory.on('EscrowCreatedSrc', async (
      orderHash: string,
      escrow: string,
      immutables: string,
      event: ethers.EventLog
    ) => {
      console.log(`📝 EVM Escrow Created: ${orderHash} -> ${escrow}`);
      
      await this.handleSrcEscrowCreated({
        orderHash,
        escrowAddress: escrow,
        blockNumber: event.blockNumber,
        chainId: (await this.evmProvider.getNetwork()).chainId
      });
    });

    // Listen for DstEscrowCreated events (when resolver creates dst escrow)
    this.evmFactory.on('DstEscrowCreated', async (
      escrow: string,
      hashlock: string,
      taker: string,
      event: ethers.EventLog
    ) => {
      console.log(`📝 EVM Dst Escrow Created: ${escrow}`);
      
      // Find matching order by hashlock
      const orderHash = await this.findOrderByHashlock(hashlock);
      if (orderHash) {
        await this.handleDstEscrowCreated({
          orderHash,
          escrowAddress: escrow,
          blockNumber: event.blockNumber,
          chainId: (await this.evmProvider.getNetwork()).chainId
        });
      }
    });

    console.log('👂 EVM listeners active');
  }

  /**
   * Start listening for Aptos escrow events
   */
  private async startAptosListeners(): Promise<void> {
    // TODO: Implement Aptos event listening
    // This will listen for escrow::EscrowCreated events on Aptos
    
    console.log('👂 Aptos listeners active (stub)');
  }

  /**
   * Handle source escrow creation
   */
  private async handleSrcEscrowCreated(params: {
    orderHash: string;
    escrowAddress: string;
    blockNumber: number;
    chainId: bigint;
  }): Promise<void> {
    const state = this.getOrCreateOrderState(params.orderHash);
    
    state.srcEscrow = {
      address: params.escrowAddress,
      chainId: Number(params.chainId),
      blockNumber: params.blockNumber,
      confirmed: false
    };
    
    state.status = 'src_created';
    state.updatedAt = Date.now();
    
    this.orderStates.set(params.orderHash, state);
    
    await this.checkForCompletion(params.orderHash);
  }

  /**
   * Handle destination escrow creation
   */
  private async handleDstEscrowCreated(params: {
    orderHash: string;
    escrowAddress: string;
    blockNumber: number;
    chainId: bigint;
  }): Promise<void> {
    const state = this.getOrCreateOrderState(params.orderHash);
    
    state.dstEscrow = {
      address: params.escrowAddress,
      chainId: Number(params.chainId),
      blockNumber: params.blockNumber,
      confirmed: false
    };
    
    if (state.status === 'src_created') {
      state.status = 'both_confirmed';
    } else {
      state.status = 'dst_created';
    }
    
    state.updatedAt = Date.now();
    this.orderStates.set(params.orderHash, state);
    
    await this.checkForCompletion(params.orderHash);
  }

  /**
   * Start finality checker that runs periodically
   */
  private startFinalityChecker(): void {
    const checkInterval = 30000; // 30 seconds
    
    setInterval(async () => {
      if (!this.isRunning) return;
      
      for (const [orderHash, state] of this.orderStates) {
        if (state.status === 'both_confirmed' && !state.secretShared) {
          await this.checkFinality(orderHash);
        }
      }
    }, checkInterval);
  }

  /**
   * Check if both escrows have sufficient finality
   */
  private async checkFinality(orderHash: string): Promise<void> {
    const state = this.orderStates.get(orderHash);
    if (!state || !state.srcEscrow || !state.dstEscrow) return;

    const currentBlock = await this.evmProvider.getBlockNumber();
    
    // Check EVM finality
    const evmConfirmed = (currentBlock - state.srcEscrow.blockNumber) >= 
                        this.config.finality.evmConfirmations;
    
    // Check Aptos finality (stub)
    const aptosConfirmed = true; // TODO: Implement Aptos confirmation checking
    
    if (evmConfirmed && aptosConfirmed) {
      // Check finality lock
      const finalityLockPassed = state.finalityTs ? 
        (Date.now() / 1000 - state.finalityTs) >= this.config.finality.finalityLockDuration :
        true; // No lock set means immediate
      
      if (finalityLockPassed) {
        await this.releaseSecret(orderHash);
      }
    }
  }

  /**
   * Release secret for order
   */
  private async releaseSecret(orderHash: string): Promise<void> {
    const state = this.orderStates.get(orderHash);
    if (!state || state.secretShared) return;

    console.log(`🔐 Releasing secret for order: ${orderHash}`);
    
    // TODO: Implement Aptos emit_secret_shared call
    // This would call the Aptos contract to emit the secret
    
    // Broadcast secret via Redis pub/sub to resolvers
    if (this.config.secretBroadcastUrl) {
      await this.broadcastSecret(orderHash, 'secret_placeholder');
    }
    
    state.secretShared = true;
    state.status = 'finalized';
    state.updatedAt = Date.now();
    
    this.orderStates.set(orderHash, state);
  }

  /**
   * Broadcast secret to resolvers via Redis pub/sub
   */
  private async broadcastSecret(orderHash: string, secret: string): Promise<void> {
    try {
      // TODO: Implement Redis pub/sub broadcasting
      console.log(`📡 Broadcasting secret for ${orderHash}: ${secret}`);
    } catch (error) {
      console.error('Failed to broadcast secret:', error);
    }
  }

  /**
   * Find order hash by hashlock
   */
  private async findOrderByHashlock(hashlock: string): Promise<string | null> {
    // TODO: Implement hashlock -> orderHash mapping
    // This would query the database or maintain a mapping
    return null;
  }

  /**
   * Get or create order state
   */
  private getOrCreateOrderState(orderHash: string): OrderState {
    const existing = this.orderStates.get(orderHash);
    if (existing) return existing;

    const newState: OrderState = {
      orderHash,
      secretShared: false,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return newState;
  }

  /**
   * Check if order can be completed
   */
  private async checkForCompletion(orderHash: string): Promise<void> {
    const state = this.orderStates.get(orderHash);
    if (!state) return;

    if (state.srcEscrow && state.dstEscrow && !state.secretShared) {
      state.status = 'both_confirmed';
      await this.checkFinality(orderHash);
    }
  }

  /**
   * Get current state of all orders
   */
  public getOrderStates(): Map<string, OrderState> {
    return new Map(this.orderStates);
  }

  /**
   * Get state of specific order
   */
  public getOrderState(orderHash: string): OrderState | undefined {
    return this.orderStates.get(orderHash);
  }
}