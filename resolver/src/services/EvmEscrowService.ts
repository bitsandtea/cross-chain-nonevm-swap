import * as Sdk from "@1inch/cross-chain-sdk";
import { ethers, Signature, TransactionRequest } from "ethers";
import { ERC20_ABI, FACTORY_ABI, RESOLVER_ABI } from "../abis";
import { OrderExecutionContext, ResolverConfig } from "../types";
import { OrderBuilder } from "./OrderBuilder";

export class EvmEscrowService {
  private config: ResolverConfig;
  private evmWallet: ethers.Wallet;
  public resolver: ethers.Contract;
  public factory: ethers.Contract;

  constructor(config: ResolverConfig, evmWallet: ethers.Wallet) {
    this.config = config;
    this.evmWallet = evmWallet;

    this.resolver = new ethers.Contract(
      this.config.resolverContractAddress,
      RESOLVER_ABI,
      this.evmWallet
    );

    // Factory contract for computing escrow addresses
    this.factory = new ethers.Contract(
      this.config.evmEscrowFactoryAddress,
      FACTORY_ABI,
      this.evmWallet
    );
  }

  /**
   * Generate source escrow deployment transaction
   */
  public async getOwner(): Promise<string> {
    try {
      const owner = await this.resolver.owner();
      console.log("Resolver owner:", owner);
      console.log("Current signer:", this.evmWallet.address);
      console.log("Owner matches signer:", owner === this.evmWallet.address);
      return owner;
    } catch (error) {
      console.error("Failed to get owner:", error);
      throw error;
    }
  }

  public generateSrcEscrowTX(
    order: any,
    signature: string,
    fillAmount: bigint,
    chainId: number
  ): TransactionRequest {
    const { r, yParityAndS: vs } = Signature.from(signature);

    const takerTraits = Sdk.TakerTraits.default()
      .setExtension(order.extension)
      .setAmountMode(Sdk.AmountMode.maker)
      .setAmountThreshold(order.takingAmount);

    const { args, trait } = takerTraits.encode();

    // Use the HashLock object directly, not its string value
    const hashLock = order.escrowExtension?.hashLockInfo;

    /*

    console.log("toSrcImmutables parameters:", {
      chainId: BigInt(chainId),
      takerAddress: this.evmWallet.address,
      fillAmount: fillAmount.toString(),
      hashLock: hashLock,
    });

    /*

     order.toSrcImmutables(
      this.config.sourceChainId,
      new EvmAddress(new Address(this.config.resolverProxyAddress)),
      fillAmount,
      order.escrowExtension.hashLockInfo
    );
    */
    console.log("Order object debug:", {
      orderType: typeof order,
      hasToSrcImmutables: typeof order.toSrcImmutables === "function",
      orderKeys: Object.keys(order),
      orderInfo: order.orderInfo
        ? Object.keys(order.orderInfo)
        : "no orderInfo",
      escrowExtension: order.escrowExtension
        ? Object.keys(order.escrowExtension)
        : "no escrowExtension",
    });

    const immutables = order.toSrcImmutables(
      chainId,
      new Sdk.EvmAddress(new Sdk.Address(this.evmWallet.address)),
      fillAmount,
      hashLock
    );

    const safetyDeposit =
      order.escrowExtension?.srcSafetyDeposit || BigInt("10000000000000000"); // 0.01 ETH default
    const builtImmutables = immutables.build();
    if (builtImmutables.parameters == null) builtImmutables.parameters = "0x";
    const builtOrder = order.build();
    let encodedData;
    try {
      const amount = fillAmount;
      encodedData = this.resolver.interface.encodeFunctionData("deploySrc", [
        builtImmutables,
        builtOrder,
        r,
        vs,
        amount,
        trait,
        args,
      ]);
    } catch (error) {
      console.error("Encoding failed:", error);
      throw error;
    }

    return {
      to: this.config.resolverContractAddress,
      data: encodedData,
      value: safetyDeposit,
    };
  }

  public async createSourceEscrow(
    context: OrderExecutionContext,
    crossChainOrder: any,
    lopOrder: any,
    signature: { r: string; vs: string },
    fillAmount: bigint,
    hashLock?: any
  ): Promise<{ txHash: string; address: string }> {
    const { intent } = context;
    console.log("Creating source escrow via Resolver", {
      intentId: intent.id,
      orderHash: context.orderHash,
      resolverAddress: this.config.resolverContractAddress,
      fillAmount: fillAmount.toString(),
      safetyDeposit: intent.srcSafetyDeposit,
    });

    try {
      // Get the hashLockInfo (bytes32) from the escrowExtension
      const hashLockInfo = crossChainOrder.inner?.escrowExtension?.hashLockInfo;

      console.log("HashLock resolution:", {
        providedHashLock: !!hashLock,
        resolvedHashLock: !!hashLockInfo,
        hashLockValue: hashLockInfo?.toString?.() || hashLockInfo,
      });

      const deployImmutables = crossChainOrder.toSrcImmutables(
        BigInt(context.intent.srcChain),
        new Sdk.Address(this.evmWallet.address),
        fillAmount,
        hashLockInfo
      );

      // Step 1b: Pre-compute escrow address using SDK immutables
      console.log("About to compute escrow address using SDK immutables", {
        factoryAddress: this.config.evmEscrowFactoryAddress,
      });

      let computedEscrowAddress: string;
      try {
        computedEscrowAddress = await this.factory.addressOfEscrowSrc(
          deployImmutables.build()
        );
        console.log("Computed escrow address", {
          address: computedEscrowAddress,
          intentId: intent.id,
        });
      } catch (error: any) {
        console.log("Failed to compute escrow address", {
          error: error.message,
        });
        throw error;
      }

      // Step 2: Determine safety deposit to forward
      const safetyDepositAmount = BigInt(intent.srcSafetyDeposit);

      // Step 2b: Check LOP allowance for maker tokens
      const tokenContract = new ethers.Contract(
        deployImmutables.token.toString(),
        ERC20_ABI,
        this.evmWallet
      );

      // Get LOP address from config or hardcode for testing
      const lopAddress = process.env.NEXT_PUBLIC_LOP_ADDRESS; // From transaction data
      const makerAddress = deployImmutables.maker.toString();

      const allowance = await tokenContract.allowance(makerAddress, lopAddress);
      const makerBalance = await tokenContract.balanceOf(makerAddress);

      console.log("LOP allowance check", {
        maker: makerAddress,
        lop: lopAddress,
        allowance: allowance.toString(),
        makerBalance: makerBalance.toString(),
        requiredAmount: deployImmutables.amount.toString(),
        hasEnoughAllowance: allowance >= deployImmutables.amount,
        hasEnoughBalance: makerBalance >= deployImmutables.amount,
      });

      if (allowance < deployImmutables.amount) {
        throw new Error(
          `Insufficient LOP allowance: ${allowance} < ${deployImmutables.amount}`
        );
      }

      if (makerBalance < deployImmutables.amount) {
        throw new Error(
          `Insufficient maker balance: ${makerBalance} < ${deployImmutables.amount}`
        );
      }

      // Step 3: Build takerTraits using 1inch SDK (following main.spec.ts pattern)
      let takerTraits = Sdk.TakerTraits.default()
        .setExtension(crossChainOrder.extension)
        .setAmountMode(Sdk.AmountMode.maker)
        .setAmountThreshold(BigInt(lopOrder.takingAmount));

      // For multiple fills, add interaction using EscrowFactory
      if (crossChainOrder.multipleFillsAllowed) {
        // TODO: Implement multiple fill interaction when needed
        // const interaction = new Sdk.EscrowFactory(new Sdk.Address(this.config.evmEscrowFactoryAddress))
        //   .getMultipleFillInteraction(proof, idx, secretHash);
        // takerTraits = takerTraits.setInteraction(interaction);
        console.log(
          "Multiple fills not yet implemented - using single fill pattern"
        );
      }

      // Extract args and trait from takerTraits encoding for deploySrc call
      const { args: postInteractionArgs, trait: takerTraitsValue } =
        takerTraits.encode();

      // Step 3b: DEBUG - Validate postInteraction data and lopArgs
      console.log("🔍 DEBUG: Validating escrow deployment parameters...");

      // Step 4: Use SDK methods for order
      const orderTuple = crossChainOrder.toOrder();

      console.log(
        "🚀 Attempting escrow deployment with validated parameters..."
      );

      const gasEstimate = await this.resolver.deploySrc.estimateGas(
        deployImmutables.build(),
        orderTuple,
        signature.r,
        signature.vs,
        fillAmount,
        takerTraitsValue,
        postInteractionArgs,
        { value: safetyDepositAmount }
      );
      const gasLimit = Math.floor(Number(gasEstimate) * this.config.gasBuffer);

      const tx = await this.resolver.deploySrc(
        deployImmutables.build(),
        orderTuple,
        signature.r,
        signature.vs,
        fillAmount,
        takerTraitsValue,
        postInteractionArgs,
        { value: safetyDepositAmount, gasLimit: gasLimit }
      );

      const receipt = await tx.wait(
        parseInt(process.env.EVM_CONFIRMATIONS || "2")
      );

      // Step 5: Parse event to get escrow address
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

      // Verify the address matches our computation
      if (escrowAddress.toLowerCase() !== computedEscrowAddress.toLowerCase()) {
        console.log("Escrow address mismatch", {
          computed: computedEscrowAddress,
          actual: escrowAddress,
        });
      }

      console.log("EVM source escrow created successfully", {
        intentId: intent.id,
        txHash: tx.hash,
        escrowAddress,
        computedAddress: computedEscrowAddress,
      });

      return { txHash: tx.hash, address: escrowAddress };
    } catch (error: any) {
      console.log("Failed to create source escrow", {
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
    const order = intent.order;
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

    console.log("Source escrow withdrawn", {
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

    console.log("Source escrow cancelled", {
      intentId: intent.id,
      txHash: tx.hash,
    });
    return { txHash: tx.hash };
  }

  private buildImmutables(orderHash: string, intent: any) {
    const order = intent.order;
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
