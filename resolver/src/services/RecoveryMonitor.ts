import { ResolverConfig } from "../types";
import { AptosEscrowService } from "./AptosEscrowService";
import { EvmEscrowService } from "./EvmEscrowService";
import { createLogger } from "./Logger";

export class RecoveryMonitor {
  private logger = createLogger("RecoveryMonitor");
  private config: ResolverConfig;
  private evmEscrowService: EvmEscrowService;
  private aptosEscrowService: AptosEscrowService;
  private recoveryMonitorInterval: NodeJS.Timeout | null = null;

  constructor(
    config: ResolverConfig,
    evmEscrowService: EvmEscrowService,
    aptosEscrowService: AptosEscrowService
  ) {
    this.config = config;
    this.evmEscrowService = evmEscrowService;
    this.aptosEscrowService = aptosEscrowService;
  }

  public start(): void {
    const recoveryInterval = 60000;
    this.recoveryMonitorInterval = setInterval(
      () => this.checkForRecoveryOpportunities(),
      recoveryInterval
    );
    this.logger.info("Recovery monitoring started", { recoveryInterval });
  }

  public stop(): void {
    if (this.recoveryMonitorInterval) {
      clearInterval(this.recoveryMonitorInterval);
      this.recoveryMonitorInterval = null;
      this.logger.info("Recovery monitoring stopped");
    }
  }

  private async checkForRecoveryOpportunities(): Promise<void> {
    try {
      const response = await fetch(
        `${this.config.relayerApiUrl}/api/intents?status=expired`,
        {
          headers: { Authorization: `Bearer ${this.config.resolverApiKey}` },
        }
      );
      if (!response.ok) return;

      const expiredIntents = (await response.json()) as any[];
      for (const intent of expiredIntents) {
        await this.attemptRecovery(intent);
      }
    } catch (error: any) {
      this.logger.debug("Recovery check failed", { error: error.message });
    }
  }

  private async attemptRecovery(intent: any): Promise<void> {
    const order = intent.fusionOrder;
    const cancellationTime = order.srcTimelock + 7200;

    if (Math.floor(Date.now() / 1000) > cancellationTime) {
      this.logger.info("Attempting recovery for expired intent", {
        intentId: intent.id,
      });
      try {
        await this.evmEscrowService.cancelSourceEscrow(intent);
        await this.aptosEscrowService.cancelDestinationEscrow(intent);
        this.logger.info("Recovery completed for intent", {
          intentId: intent.id,
        });
      } catch (error: any) {
        this.logger.error("Recovery attempt failed", {
          intentId: intent.id,
          error: error.message,
        });
      }
    }
  }
}
