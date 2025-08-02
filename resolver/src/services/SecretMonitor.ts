import { ethers } from "ethers";
import { ResolverConfig, SecretData } from "../types";
import { AptosEscrowService } from "./AptosEscrowService";
import { EvmEscrowService } from "./EvmEscrowService";
import { IntentMonitor } from "./IntentMonitor";

export class SecretMonitor {
  private config: ResolverConfig;
  private evmEscrowService: EvmEscrowService;
  private aptosEscrowService: AptosEscrowService;
  private intentMonitor: IntentMonitor;
  private secretMonitorInterval: NodeJS.Timeout | null = null;
  private evmProvider: ethers.Provider;
  private resolverContract: ethers.Contract;
  private processedOrderHashes = new Set<string>();

  constructor(
    config: ResolverConfig,
    evmEscrowService: EvmEscrowService,
    aptosEscrowService: AptosEscrowService,
    intentMonitor: IntentMonitor
  ) {
    this.config = config;
    this.evmEscrowService = evmEscrowService;
    this.aptosEscrowService = aptosEscrowService;
    this.intentMonitor = intentMonitor;

    // Initialize EVM provider and resolver contract for event listening
    this.evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
    const resolverAbi = [
      "event SrcEscrowDeployed(bytes32 indexed orderHash, address indexed escrowAddr, uint256 fillAmount, uint256 safetyDeposit)",
    ];
    this.resolverContract = new ethers.Contract(
      config.resolverContractAddress,
      resolverAbi,
      this.evmProvider
    );
  }

  public start(): void {
    const pollInterval = this.config.pollIntervalMs;
    this.secretMonitorInterval = setInterval(
      () => this.checkForSharedSecrets(),
      pollInterval
    );

    // Start listening for SrcEscrowDeployed events
    this.startEventListening();

    console.log("Secret monitoring started", { pollInterval });
  }

  public stop(): void {
    if (this.secretMonitorInterval) {
      clearInterval(this.secretMonitorInterval);
      this.secretMonitorInterval = null;
    }

    // Stop event listening with specific handler reference
    this.resolverContract.off(
      "SrcEscrowDeployed",
      this.onSrcEscrowDeployed.bind(this)
    );

    console.log("Secret monitoring stopped");
  }

  private async checkForSharedSecrets(): Promise<void> {
    try {
      const response = await fetch(`${this.config.relayerApiUrl}/api/secrets`, {
        headers: { Authorization: `Bearer ${this.config.resolverApiKey}` },
      });
      if (!response.ok) return;

      const data = await response.json();
      let secrets: SecretData[] = [];

      // Handle different response formats
      if (Array.isArray(data)) {
        secrets = data;
      } else if (data && Array.isArray((data as any).secrets)) {
        secrets = (data as any).secrets;
      } else if (data && (data as any).secrets) {
        console.log("Unexpected secrets response format:", data);
        return;
      } else {
        // If no secrets found, just return without error
        console.log("No secrets found in API response");
        return;
      }

      for (const secretData of secrets) {
        if (secretData.action === "secret_shared") {
          // Check for duplicates to avoid double processing
          if (this.processedOrderHashes.has(secretData.orderHash)) {
            console.log("Skipping already processed secret", {
              orderHash: secretData.orderHash,
            });
            continue;
          }
          this.processedOrderHashes.add(secretData.orderHash);
          await this.executeWithdrawals(secretData);
        }
      }
    } catch (error: any) {
      console.log("Secret check failed", { error: error.message });
    }
  }

  private async executeWithdrawals(secretData: SecretData): Promise<void> {
    const { orderHash, secret, intentId } = secretData;
    console.log("Executing withdrawals for shared secret", {
      orderHash,
      intentId,
    });

    try {
      const intent = await this.intentMonitor.getIntentById(intentId);
      if (!intent) throw new Error(`Intent ${intentId} not found`);

      // Phase 2: Create destination escrow now that secret is known
      console.log("Creating destination escrow on Aptos", { intentId });
      const dstEscrow =
        await this.aptosEscrowService.createDestinationEscrowRaw(
          intent,
          ethers.keccak256(secret),
          intent.order.takerAsset,
          intentId
        );

      // Update intent status after destination escrow creation
      await this.intentMonitor.updateIntentStatus(intentId, "escrow_deployed", {
        dstEscrowAddr: dstEscrow.address,
        dstEscrowTx: dstEscrow.txHash,
      });

      // Execute withdrawals
      const dstWithdrawal =
        await this.aptosEscrowService.withdrawFromDestinationEscrow(
          orderHash,
          secret,
          intent
        );
      const srcWithdrawal =
        await this.evmEscrowService.withdrawFromSourceEscrow(
          orderHash,
          secret,
          intent
        );

      await this.intentMonitor.updateIntentStatus(intentId, "completed", {
        dstEscrowTx: dstEscrow.txHash,
        dstWithdrawalTx: dstWithdrawal.txHash,
        srcWithdrawalTx: srcWithdrawal.txHash,
      });
      console.log("Complete flow executed successfully", {
        orderHash,
        intentId,
        dstEscrowTx: dstEscrow.txHash,
        dstWithdrawalTx: dstWithdrawal.txHash,
        srcWithdrawalTx: srcWithdrawal.txHash,
      });
    } catch (error: any) {
      console.log("Withdrawal sequence failed", {
        orderHash,
        intentId,
        error: error.message,
      });
    }
  }

  private startEventListening(): void {
    console.log("Starting SrcEscrowDeployed event listening");

    // Listen for SrcEscrowDeployed events
    this.resolverContract.on(
      "SrcEscrowDeployed",
      this.onSrcEscrowDeployed.bind(this)
    );

    console.log("Event listener registered for SrcEscrowDeployed");
  }

  private async onSrcEscrowDeployed(
    orderHash: string,
    escrowAddr: string,
    fillAmount: bigint,
    safetyDeposit: bigint,
    event: any
  ): Promise<void> {
    // Check for duplicates
    if (this.processedOrderHashes.has(orderHash)) {
      console.log("Skipping already processed order hash", { orderHash });
      return;
    }

    this.processedOrderHashes.add(orderHash);

    console.log("SrcEscrowDeployed event received", {
      orderHash,
      escrowAddr,
      fillAmount: fillAmount.toString(),
      safetyDeposit: safetyDeposit.toString(),
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
    });

    try {
      // Notify relayer about the escrow deployment
      await this.notifyRelayerOfEscrowDeployment(orderHash, escrowAddr);
    } catch (error: any) {
      console.log("Failed to notify relayer of escrow deployment", {
        orderHash,
        escrowAddr,
        error: error.message,
      });
    }
  }

  private async notifyRelayerOfEscrowDeployment(
    orderHash: string,
    escrowAddr: string
  ): Promise<void> {
    try {
      const response = await fetch(`${this.config.relayerApiUrl}/api/escrows`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.resolverApiKey}`,
        },
        body: JSON.stringify({
          orderHash,
          escrowAddr,
          timestamp: Math.floor(Date.now() / 1000),
          status: "deployed",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log("Successfully notified relayer of escrow deployment", {
        orderHash,
        escrowAddr,
      });
    } catch (error: any) {
      console.log("Failed to notify relayer", {
        orderHash,
        escrowAddr,
        error: error.message,
      });
      throw error;
    }
  }
}
