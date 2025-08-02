import { ResolverConfig } from "../types";
import { AptosEscrowService } from "./AptosEscrowService";
import { EvmEscrowService } from "./EvmEscrowService";

export class RecoveryMonitor {
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
    console.log("Recovery monitoring started", { recoveryInterval });
  }

  public stop(): void {
    if (this.recoveryMonitorInterval) {
      clearInterval(this.recoveryMonitorInterval);
      this.recoveryMonitorInterval = null;
      console.log("Recovery monitoring stopped");
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

      const data = await response.json();
      let expiredIntents: any[] = [];

      // Handle different response formats
      if (Array.isArray(data)) {
        expiredIntents = data;
      } else if (data && Array.isArray((data as any).intents)) {
        expiredIntents = (data as any).intents;
      } else if (data && (data as any).intents) {
        console.log("Unexpected expired intents response format:", data);
        return;
      }

      for (const intent of expiredIntents) {
        await this.attemptRecovery(intent);
      }
    } catch (error: any) {
      console.log("Recovery check failed", { error: error.message });
    }
  }

  private async attemptRecovery(intent: any): Promise<void> {
    const cancellationTime = intent.srcTimelock + 7200;

    if (Math.floor(Date.now() / 1000) > cancellationTime) {
      console.log("Attempting recovery for expired intent", {
        intentId: intent.id,
      });
      try {
        await this.evmEscrowService.cancelSourceEscrow(intent);
        await this.aptosEscrowService.cancelDestinationEscrow(intent);
        console.log("Recovery completed for intent", {
          intentId: intent.id,
        });
      } catch (error: any) {
        console.log("Recovery attempt failed", {
          intentId: intent.id,
          error: error.message,
        });
      }
    }
  }
}
