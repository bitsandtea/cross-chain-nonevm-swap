import { Account, Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { OrderExecutionContext, ResolverConfig } from "../types";

export class AptosEscrowService {
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
    return this.createDestinationEscrowRaw(
      intent,
      secretHash,
      aptosTakerAsset || intent.order.takerAsset,
      intent.id
    );
  }

  public async createDestinationEscrowRaw(
    intent: any,
    secretHash: string,
    aptosTakerAsset: string,
    intentId?: string
  ): Promise<{ txHash: string; address: string }> {
    // Use the original Aptos asset address if provided, fallback to intent.order.takerAsset
    const actualTakerAsset = aptosTakerAsset || intent.order.takerAsset;
    const moduleAddress = this.extractAptosModuleAddress(actualTakerAsset);

    console.log("Creating destination escrow on Aptos", {
      intentId,
      aptosFactory: this.config.aptosEscrowFactoryAddress,
      originalTakerAsset: actualTakerAsset,
      moduleAddress,
    });

    const secretHashBytes = Array.from(Buffer.from(secretHash.slice(2), "hex"));
    const timelocksArray = this.buildTimelocksArray(intent);

    const payload = {
      function: `${this.config.aptosEscrowFactoryAddress}::escrow::create_escrow`,
      type_arguments: [moduleAddress],
      arguments: [
        "0x0000000000000000000000000000000000000000", // MISSING: dstEscrowTarget
        this.aptosAccount.accountAddress.toString(),
        intent.order.takingAmount,
        "1000000000000000000", // MISSING: dstSafetyDeposit - using default
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

    console.log("Aptos destination escrow created", {
      intentId,
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
    const moduleAddress = this.extractAptosModuleAddress(
      intent.order.takerAsset
    );
    const payload = {
      function: `${this.config.aptosEscrowFactoryAddress}::escrow::withdraw`,
      type_arguments: [moduleAddress],
      arguments: [
        Array.from(Buffer.from(secret.slice(2), "hex")),
        orderHash,
        intent.secretHash,
        "0x0000000000000000000000000000000000000000", // MISSING: dstEscrowTarget
        this.aptosAccount.accountAddress.toString(),
        intent.order.takerAsset,
        intent.order.takingAmount,
        "1000000000000000000", // MISSING: dstSafetyDeposit
        this.buildTimelocksArray(intent).map((t) => t.toString()),
      ],
    };

    const tx = await this.submitAptosTx(payload);
    console.log("Destination escrow withdrawn", {
      intentId: intent.id,
      txHash: tx.hash,
    });
    return { txHash: tx.hash };
  }

  public async cancelDestinationEscrow(
    intent: any
  ): Promise<{ txHash: string }> {
    const moduleAddress = this.extractAptosModuleAddress(
      intent.order.takerAsset
    );
    const payload = {
      function: `${this.config.aptosEscrowFactoryAddress}::escrow::cancel`,
      type_arguments: [moduleAddress],
      arguments: [
        intent.orderHash,
        intent.secretHash,
        "0x0000000000000000000000000000000000000000", // MISSING: dstEscrowTarget
        this.aptosAccount.accountAddress.toString(),
        intent.order.takerAsset,
        intent.order.takingAmount,
        "1000000000000000000", // MISSING: dstSafetyDeposit
        this.buildTimelocksArray(intent).map((t) => t.toString()),
      ],
    };

    const tx = await this.submitAptosTx(payload);
    console.log("Destination escrow cancelled", {
      intentId: intent.id,
      txHash: tx.hash,
    });
    return { txHash: tx.hash };
  }

  private buildTimelocksArray(intent: any): number[] {
    // MISSING: dstTimelock not in new format, using auction timing as fallback
    const dstTimelock = intent.auctionStartTime + intent.auctionDuration;
    return [
      intent.finalityLock,
      dstTimelock,
      dstTimelock + 3600,
      dstTimelock + 7200,
      dstTimelock + 10800,
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
