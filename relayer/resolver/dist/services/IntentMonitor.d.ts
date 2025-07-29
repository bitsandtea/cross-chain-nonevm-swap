/**
 * Intent Monitor Service
 * Polls the relayer API for new intents and queues them for processing
 */
import { EventEmitter } from "events";
import { ResolverConfig } from "../types";
export declare class IntentMonitor extends EventEmitter {
    private config;
    private logger;
    private isRunning;
    private processedIntents;
    private lastPollTime;
    constructor(config: ResolverConfig);
    /**
     * Start monitoring for new intents
     */
    start(): Promise<void>;
    /**
     * Stop monitoring
     */
    stop(): void;
    /**
     * Main polling loop
     */
    private pollLoop;
    /**
     * Poll the relayer API for new intents
     */
    private pollForIntents;
    /**
     * Fetch intents from the relayer API
     */
    private fetchIntents;
    /**
     * Validate intent structure
     */
    private validateIntent;
    /**
     * Update intent status in the relayer
     */
    updateIntentStatus(intentId: string, status: string, metadata?: Record<string, unknown>): Promise<void>;
    /**
     * Get health status
     */
    getHealthStatus(): {
        healthy: boolean;
        lastPoll: number;
        processedCount: number;
    };
    /**
     * Clear processed intents cache (for memory management)
     */
    clearProcessedCache(): void;
}
//# sourceMappingURL=IntentMonitor.d.ts.map