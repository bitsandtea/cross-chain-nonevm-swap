import { Account, Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { OrderExecutionContext, ResolverConfig } from "../types";
import { createLogger } from "./Logger";

export class AptosEscrowService {
  private logger = createLogger("AptosEscrowService");
  private config: ResolverConfig;
  private aptosClient: Aptos;
  private aptosAccount: Account;

  constructor(config: ResolverConfig, aptosAccount: Account) {
    this.config = config;
    this.aptosAccount = aptosAccount;
    const aptosConfig = new AptosConfig({ network: Network.TESTNET });
    this.aptosClient = new Aptos(aptosConfig);
  }

  // Extract module address for type_arguments from Aptos asset address
  private extractAptosModuleAddress(address: string): string {
    // Testnet format: extract module address from "0x...::module::SYMBOL"
    if (address.includes("::")) {
      return address.split("::")[0] + "::" + address.split("::")[1];
    }
    // Mainnet format: already a module address
    return address;
  }

  public async createDestinationEscrow(
    context: OrderExecutionContext,
    aptosTakerAsset?: string
  ): Promise<{ txHash: string; address: string }> {
    const { intent, secretHash } = context;
    const order = intent.fusionOrder;

    // Use the original Aptos asset address if provided, fallback to order.takerAsset
    const actualTakerAsset = aptosTakerAsset || order.takerAsset;
    const moduleAddress = this.extractAptosModuleAddress(actualTakerAsset);

    this.logger.info("Creating destination escrow on Aptos", {
      intentId: intent.id,
      aptosFactory: this.config.aptosEscrowFactoryAddress,
      originalTakerAsset: actualTakerAsset,
      moduleAddress,
    });

    const secretHashBytes = Array.from(Buffer.from(secretHash.slice(2), "hex"));
    const timelocksArray = this.buildTimelocksArray(order);

    const payload = {
      function: `${this.config.aptosEscrowFactoryAddress}::escrow::create_escrow`,
      type_arguments: [moduleAddress],
      arguments: [
        order.dstEscrowTarget,
        this.aptosAccount.accountAddress.toString(),
        order.takingAmount,
        order.dstSafetyDeposit,
        secretHashBytes,
        timelocksArray,
        false,
        [],
        1,
      ],
    };

    const transaction = await this.aptosClient.transaction.build.simple({
      sender: this.aptosAccount.accountAddress,
      data: {
        function: payload.function as `${string}::${string}::${string}`,
        typeArguments: payload.type_arguments,
        functionArguments: payload.arguments,
      },
    });

    const signedTx = this.aptosClient.transaction.sign({
      signer: this.aptosAccount,
      transaction,
    });
    const result = await this.aptosClient.transaction.submit.simple({
      transaction,
      senderAuthenticator: signedTx,
    });
    await this.aptosClient.waitForTransaction({
      transactionHash: result.hash,
      options: { checkSuccess: true },
    });

    const txDetails = await this.aptosClient.getTransactionByHash({
      transactionHash: result.hash,
    });

    let escrowAddress: string | undefined;
    if ("events" in txDetails && txDetails.events) {
      for (const event of txDetails.events) {
        if (event.type.includes("::escrow::EscrowCreated")) {
          escrowAddress = event.data.escrow_address;
          break;
        }
      }
    }
    if (!escrowAddress) {
      throw new Error(
        "Could not extract escrow address from Aptos transaction"
      );
    }

    this.logger.info("Aptos destination escrow created", {
      intentId: intent.id,
      txHash: result.hash,
      escrowAddress,
    });
    return { txHash: result.hash, address: escrowAddress };
  }

  public async withdrawFromDestinationEscrow(
    orderHash: string,
    secret: string,
    intent: any
  ): Promise<{ txHash: string }> {
    const order = intent.fusionOrder;
    const moduleAddress = this.extractAptosModuleAddress(order.takerAsset);
    const payload = {
      function: `${this.config.aptosEscrowFactoryAddress}::escrow::withdraw`,
      type_arguments: [moduleAddress],
      arguments: [
        Array.from(Buffer.from(secret.slice(2), "hex")),
        orderHash,
        intent.secretHash,
        order.dstEscrowTarget,
        this.aptosAccount.accountAddress.toString(),
        order.takerAsset,
        order.takingAmount,
        order.dstSafetyDeposit,
        this.buildTimelocksArray(order).map((t) => t.toString()),
      ],
    };

    const tx = await this.submitAptosTx(payload);
    this.logger.info("Destination escrow withdrawn", {
      intentId: intent.id,
      txHash: tx.hash,
    });
    return { txHash: tx.hash };
  }

  public async cancelDestinationEscrow(
    intent: any
  ): Promise<{ txHash: string }> {
    const order = intent.fusionOrder;
    const moduleAddress = this.extractAptosModuleAddress(order.takerAsset);
    const payload = {
      function: `${this.config.aptosEscrowFactoryAddress}::escrow::cancel`,
      type_arguments: [moduleAddress],
      arguments: [
        intent.orderHash,
        intent.secretHash,
        order.dstEscrowTarget,
        this.aptosAccount.accountAddress.toString(),
        order.takerAsset,
        order.takingAmount,
        order.dstSafetyDeposit,
        this.buildTimelocksArray(order).map((t) => t.toString()),
      ],
    };

    const tx = await this.submitAptosTx(payload);
    this.logger.info("Destination escrow cancelled", {
      intentId: intent.id,
      txHash: tx.hash,
    });
    return { txHash: tx.hash };
  }

  private buildTimelocksArray(order: any): number[] {
    return [
      order.finalityLock,
      order.dstTimelock,
      order.dstTimelock + 3600,
      order.dstTimelock + 7200,
      order.dstTimelock + 10800,
    ];
  }

  private async submitAptosTx(payload: any) {
    const transaction = await this.aptosClient.transaction.build.simple({
      sender: this.aptosAccount.accountAddress,
      data: {
        function: payload.function as `${string}::${string}::${string}`,
        typeArguments: payload.type_arguments,
        functionArguments: payload.arguments,
      },
    });
    const signedTx = this.aptosClient.transaction.sign({
      signer: this.aptosAccount,
      transaction,
    });
    const result = await this.aptosClient.transaction.submit.simple({
      transaction,
      senderAuthenticator: signedTx,
    });
    await this.aptosClient.waitForTransaction({
      transactionHash: result.hash,
      options: { checkSuccess: true },
    });
    return result;
  }
}
