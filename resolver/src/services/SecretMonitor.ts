import { ResolverConfig } from "../types";
import { AptosEscrowService } from "./AptosEscrowService";
import { EvmEscrowService } from "./EvmEscrowService";
import { IntentMonitor } from "./IntentMonitor";
import { createLogger } from "./Logger";

export class SecretMonitor {
  private logger = createLogger("SecretMonitor");
  private config: ResolverConfig;
  private evmEscrowService: EvmEscrowService;
  private aptosEscrowService: AptosEscrowService;
  private intentMonitor: IntentMonitor;
  private secretMonitorInterval: NodeJS.Timeout | null = null;

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
  }

  public start(): void {
    const pollInterval = this.config.pollIntervalMs;
    this.secretMonitorInterval = setInterval(
      () => this.checkForSharedSecrets(),
      pollInterval
    );
    this.logger.info("Secret monitoring started", { pollInterval });
  }

  public stop(): void {
    if (this.secretMonitorInterval) {
      clearInterval(this.secretMonitorInterval);
      this.secretMonitorInterval = null;
      this.logger.info("Secret monitoring stopped");
    }
  }

  private async checkForSharedSecrets(): Promise<void> {
    try {
      const response = await fetch(`${this.config.relayerApiUrl}/api/secrets`, {
        headers: { Authorization: `Bearer ${this.config.resolverApiKey}` },
      });
      if (!response.ok) return;

      const secrets = (await response.json()) as any[];
      for (const secretData of secrets) {
        if (secretData.action === "secret_shared") {
          await this.executeWithdrawals(secretData);
        }
      }
    } catch (error: any) {
      this.logger.debug("Secret check failed", { error: error.message });
    }
  }

  private async executeWithdrawals(secretData: any): Promise<void> {
    const { orderHash, secret, intentId } = secretData;
    this.logger.info("Executing withdrawals for shared secret", {
      orderHash,
      intentId,
    });

    try {
      const intent = await this.intentMonitor.getIntentById(intentId);
      if (!intent) throw new Error(`Intent ${intentId} not found`);

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
        dstWithdrawalTx: dstWithdrawal.txHash,
        srcWithdrawalTx: srcWithdrawal.txHash,
      });
      this.logger.info("Withdrawal sequence completed", {
        orderHash,
        intentId,
      });
    } catch (error: any) {
      this.logger.error("Withdrawal sequence failed", {
        orderHash,
        intentId,
        error: error.message,
      });
    }
  }
}
