import { ethers } from "ethers";
import { OrderExecutionContext, ResolverConfig } from "../types";
import { createLogger } from "./Logger";
import { OrderBuilder } from "./OrderBuilder";

export class EvmEscrowService {
  private logger = createLogger("EvmEscrowService");
  private config: ResolverConfig;
  private evmWallet: ethers.Wallet;
  private resolver: ethers.Contract;

  constructor(config: ResolverConfig, evmWallet: ethers.Wallet) {
    this.config = config;
    this.evmWallet = evmWallet;

    const resolverAbi = [
      "function deploySrc(tuple(address maker, address makerAsset, address takerAsset, uint256 makingAmount, uint256 takingAmount, address receiver, address allowedSender, bytes makerAssetData, bytes takerAssetData, bytes getMakerAmount, bytes getTakerAmount, bytes predicate, bytes permit, bytes interaction) order, bytes32 r, bytes32 vs, uint256 fillAmount, bytes args) external payable",
      "event SrcEscrowDeployed(bytes32 indexed orderHash, address indexed escrowAddr, uint256 fillAmount, uint256 safetyDeposit)",
      "function withdraw(bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external",
      "function cancel(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external",
    ];
    this.resolver = new ethers.Contract(
      this.config.resolverContractAddress,
      resolverAbi,
      this.evmWallet
    );
  }

  public async createSourceEscrow(
    context: OrderExecutionContext,
    lopOrder: any,
    signature: { r: string; vs: string },
    fillAmount: bigint,
    args: string
  ): Promise<{ txHash: string; address: string }> {
    const { intent } = context;
    this.logger.info("Creating source escrow via Resolver", {
      intentId: intent.id,
      orderHash: context.orderHash,
      resolverAddress: this.config.resolverContractAddress,
      fillAmount: fillAmount.toString(),
      safetyDeposit: intent.fusionOrder.srcSafetyDeposit,
    });

    try {
      const gasEstimate = await this.resolver.deploySrc.estimateGas(
        lopOrder,
        signature.r,
        signature.vs,
        fillAmount,
        args,
        { value: intent.fusionOrder.srcSafetyDeposit }
      );
      const gasLimit = Math.floor(Number(gasEstimate) * this.config.gasBuffer);

      const tx = await this.resolver.deploySrc(
        lopOrder,
        signature.r,
        signature.vs,
        fillAmount,
        args,
        { value: intent.fusionOrder.srcSafetyDeposit, gasLimit: gasLimit }
      );

      const receipt = await tx.wait(
        parseInt(process.env.EVM_CONFIRMATIONS || "2")
      );

      const eventSignature = ethers.id(
        "SrcEscrowDeployed(bytes32,address,uint256,uint256)"
      );
      const event = receipt.logs.find(
        (log: any) => log.topics[0] === eventSignature
      );
      if (!event) throw new Error("SrcEscrowDeployed event not found");

      const parsedLog = this.resolver.interface.parseLog(event);
      if (!parsedLog)
        throw new Error("Failed to parse SrcEscrowDeployed event");

      const escrowAddress = parsedLog.args.escrowAddr;
      this.logger.info("EVM source escrow created successfully", {
        intentId: intent.id,
        txHash: tx.hash,
        escrowAddress,
      });

      return { txHash: tx.hash, address: escrowAddress };
    } catch (error: any) {
      this.logger.error("Failed to create source escrow", {
        intentId: intent.id,
        error: error.message,
      });
      throw new Error(`Source escrow creation failed: ${error.message}`);
    }
  }

  public async withdrawFromSourceEscrow(
    orderHash: string,
    secret: string,
    intent: any
  ): Promise<{ txHash: string }> {
    const order = intent.fusionOrder;
    const escrowAddress = intent.evmEscrow;
    if (!escrowAddress) {
      throw new Error(`No EVM escrow address found for intent ${intent.id}`);
    }

    const escrowAbi = [
      "function withdraw(bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external",
    ];
    const escrow = new ethers.Contract(
      escrowAddress,
      escrowAbi,
      this.evmWallet
    );

    const immutables = this.buildImmutables(orderHash, intent);

    const tx = await escrow.withdraw(secret, immutables);
    await tx.wait();

    this.logger.info("Source escrow withdrawn", {
      intentId: intent.id,
      txHash: tx.hash,
    });
    return { txHash: tx.hash };
  }

  public async cancelSourceEscrow(intent: any): Promise<{ txHash: string }> {
    const escrowAddress = intent.evmEscrow;
    if (!escrowAddress) {
      throw new Error(`No EVM escrow address found for intent ${intent.id}`);
    }

    const escrowAbi = [
      "function cancel(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external",
    ];
    const escrow = new ethers.Contract(
      escrowAddress,
      escrowAbi,
      this.evmWallet
    );
    const immutables = this.buildImmutables(intent.orderHash, intent);

    const tx = await escrow.cancel(immutables);
    await tx.wait();

    this.logger.info("Source escrow cancelled", {
      intentId: intent.id,
      txHash: tx.hash,
    });
    return { txHash: tx.hash };
  }

  private buildImmutables(orderHash: string, intent: any) {
    const order = intent.fusionOrder;
    const crossChainOrder = new OrderBuilder(
      this.config,
      this.evmWallet
    ).createCrossChainOrder(intent).order;

    return {
      orderHash,
      hashlock: intent.secretHash,
      maker: order.maker,
      taker: this.evmWallet.address,
      token: order.makerAsset,
      amount: order.makingAmount,
      safetyDeposit: order.srcSafetyDeposit,
      timelocks: crossChainOrder.timeLocks.encode(),
    };
  }
}
