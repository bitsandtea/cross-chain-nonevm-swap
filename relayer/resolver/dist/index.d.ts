/**
 * Resolver Main Entry Point
 * Implements Phase 1 of resolver_both_phases.md
 */
import { EventEmitter } from "events";
import { ResolverConfig } from "./types";
export declare class Resolver extends EventEmitter {
    private config;
    private logger;
    private intentMonitor;
    private profitabilityAnalyzer;
    private balanceManager;
    private isRunning;
    private processingQueue;
    constructor(config?: ResolverConfig);
    /**
     * Start the resolver
     */
    start(): Promise<void>;
    /**
     * Stop the resolver
     */
    stop(): void;
    /**
     * Setup event handlers
     */
    private setupEventHandlers;
    /**
     * Handle new intent from the monitor
     */
    private handleNewIntent;
    /**
     * Process a single intent through Phase 1 flow
     */
    private processIntent;
    /**
     * Generate order hash (simplified)
     */
    private generateOrderHash;
    /**
     * Create escrows on both chains (placeholder for hackathon)
     */
    private createEscrows;
    /**
     * Get resolver status
     */
    getStatus(): {
        isRunning: boolean;
        queueSize: number;
        walletAddresses: {
            evm: string;
            aptos: string;
        };
        intentMonitor: {
            healthy: boolean;
            lastPoll: number;
            processedCount: number;
        };
    };
}
export default Resolver;
//# sourceMappingURL=index.d.ts.map