// Fusion+ Resolver Bot
// Watches relayer API for open orders and executes profitable fills

import { ethers } from 'ethers';
import { buildFusionPlusOrder, LOPOrderWithData, estimateFusionPlusGas } from './orderBuilder';
import { getTokenPrices } from './priceService';

export interface ResolverConfig {
  rpcUrl: string;
  privateKey: string;
  resolverAddress: string;
  lopAddress: string;
  factoryAddress: string;
  dutchAuctionLibAddress: string;
  relayerApiUrl: string;
  minProfitBasisPoints: number; // e.g., 50 = 0.5%
  maxGasPrice: bigint;
  safetyDepositRatio: number; // e.g., 0.1 = 10% of order value
}

export interface OpenOrder {
  id: string;
  orderHash: string;
  maker: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: string;
  minTakingAmount: string;
  startRate: string;
  endRate: string;
  startTimestamp: number;
  duration: number;
  expiration: number;
  signature: string;
}

export interface ProfitabilityResult {
  profitable: boolean;
  expectedProfit: bigint;
  fillAmount: bigint;
  safetyDeposit: bigint;
  gasEstimate: bigint;
  gasCost: bigint;
}

/**
 * Resolver bot that monitors orders and executes profitable fills
 */
export class ResolverBot {
  private config: ResolverConfig;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private resolver: ethers.Contract;
  private isRunning: boolean = false;
  private pollInterval: number = 10000; // 10 seconds

  constructor(config: ResolverConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    
    const resolverAbi = [
      "function deploySrc(tuple(uint256 salt, address maker, address receiver, address makerAsset, address takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes32 sig, uint256 fillAmount, uint256 takerTraits, bytes calldata args) external payable",
      "function deployDst(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) dstImmutables, uint256 srcCancellationTimestamp) external payable"
    ];
    
    this.resolver = new ethers.Contract(config.resolverAddress, resolverAbi, this.wallet);
  }

  /**
   * Start the resolver bot
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('🤖 Starting Resolver Bot');
    console.log(`📡 RPC: ${this.config.rpcUrl}`);
    console.log(`🏭 Resolver: ${this.config.resolverAddress}`);
    console.log(`💰 Min Profit: ${this.config.minProfitBasisPoints}bps`);

    this.startOrderPolling();
  }

  /**
   * Stop the resolver bot
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    console.log('🛑 Resolver Bot stopped');
  }

  /**
   * Start polling for open orders
   */
  private startOrderPolling(): void {
    const poll = async () => {
      if (!this.isRunning) return;

      try {
        await this.checkAndFillOrders();
      } catch (error) {
        console.error('Error in order polling:', error);
      }

      if (this.isRunning) {
        setTimeout(poll, this.pollInterval);
      }
    };

    poll();
  }

  /**
   * Check for profitable orders and execute fills
   */
  private async checkAndFillOrders(): Promise<void> {
    const orders = await this.fetchOpenOrders();
    
    for (const order of orders) {
      try {
        const profitability = await this.analyzeProfitability(order);
        
        if (profitability.profitable) {
          console.log(`💡 Profitable order found: ${order.id}`);
          console.log(`📈 Expected profit: ${ethers.formatEther(profitability.expectedProfit)} ETH`);
          
          await this.executeOrder(order, profitability);
        }
      } catch (error) {
        console.error(`Error analyzing order ${order.id}:`, error);
      }
    }
  }

  /**
   * Fetch open orders from relayer API
   */
  private async fetchOpenOrders(): Promise<OpenOrder[]> {
    try {
      const response = await fetch(`${this.config.relayerApiUrl}/api/orders?status=open`);
      const data = await response.json();
      return data.orders || [];
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      return [];
    }
  }

  /**
   * Analyze order profitability
   */
  private async analyzeProfitability(order: OpenOrder): Promise<ProfitabilityResult> {
    // Get current prices
    const prices = await getTokenPrices([order.makerAsset, order.takerAsset]);
    const makerPrice = parseFloat(prices[order.makerAsset] || '0');
    const takerPrice = parseFloat(prices[order.takerAsset] || '0');

    if (makerPrice === 0 || takerPrice === 0) {
      return {
        profitable: false,
        expectedProfit: 0n,
        fillAmount: 0n,
        safetyDeposit: 0n,
        gasEstimate: 0n,
        gasCost: 0n
      };
    }

    // Calculate current Dutch auction rate
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - order.startTimestamp;
    const progress = Math.min(elapsed / order.duration, 1);
    
    const startRate = BigInt(order.startRate);
    const endRate = BigInt(order.endRate);
    const currentRate = startRate + (endRate - startRate) * BigInt(Math.floor(progress * 1000)) / 1000n;

    // Calculate fill amount (could be partial)
    const makingAmount = BigInt(order.makingAmount);
    const fillAmount = makingAmount; // Full fill for simplicity

    // Calculate taking amount at current rate
    const takingAmount = fillAmount * currentRate / (10n ** 18n);

    // Calculate expected profit
    const makerValue = fillAmount * BigInt(Math.floor(makerPrice * 1e18)) / (10n ** 18n);
    const takerValue = takingAmount * BigInt(Math.floor(takerPrice * 1e18)) / (10n ** 18n);
    const grossProfit = makerValue > takerValue ? makerValue - takerValue : 0n;

    // Calculate costs
    const gasEstimate = estimateFusionPlusGas();
    const gasPrice = await this.provider.getFeeData().then(f => f.gasPrice || 0n);
    const gasCost = gasEstimate * gasPrice;

    // Calculate safety deposit
    const safetyDeposit = makerValue * BigInt(Math.floor(this.config.safetyDepositRatio * 1000)) / 1000n;

    // Calculate net profit
    const netProfit = grossProfit > gasCost ? grossProfit - gasCost : 0n;
    const minProfit = makerValue * BigInt(this.config.minProfitBasisPoints) / 10000n;

    const profitable = netProfit >= minProfit && gasPrice <= this.config.maxGasPrice;

    return {
      profitable,
      expectedProfit: netProfit,
      fillAmount,
      safetyDeposit,
      gasEstimate,
      gasCost
    };
  }

  /**
   * Execute a profitable order
   */
  private async executeOrder(order: OpenOrder, profitability: ProfitabilityResult): Promise<void> {
    try {
      console.log(`🚀 Executing order ${order.id}`);

      // Reconstruct the LOP order
      const lopOrder = {
        salt: BigInt(order.orderHash), // Simplified
        maker: order.maker,
        receiver: order.maker,
        makerAsset: order.makerAsset,
        takerAsset: order.takerAsset,
        makingAmount: BigInt(order.makingAmount),
        takingAmount: BigInt(order.minTakingAmount),
        makerTraits: 0n
      };

      // Set taker traits with _ARGS_HAS_TARGET bit
      const takerTraits = 1n << 251n;

      // Execute via resolver
      const tx = await this.resolver.deploySrc(
        lopOrder,
        order.signature,
        profitability.fillAmount,
        takerTraits,
        '0x', // args
        {
          value: profitability.safetyDeposit,
          gasLimit: profitability.gasEstimate,
        }
      );

      console.log(`✅ Order executed: ${tx.hash}`);
      console.log(`💰 Profit: ${ethers.formatEther(profitability.expectedProfit)} ETH`);

      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(`🎯 Confirmed at block: ${receipt.blockNumber}`);

    } catch (error) {
      console.error(`❌ Failed to execute order ${order.id}:`, error);
    }
  }

  /**
   * Get bot status
   */
  public getStatus(): {
    running: boolean;
    walletAddress: string;
    balance: Promise<string>;
  } {
    return {
      running: this.isRunning,
      walletAddress: this.wallet.address,
      balance: this.provider.getBalance(this.wallet.address).then(b => ethers.formatEther(b))
    };
  }
}