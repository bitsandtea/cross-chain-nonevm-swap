import { getEscrowWatcher } from "./escrowWatcher";
import { getRecoveryScheduler } from "./recoveryScheduler";

// Initialize all services when the application starts
let servicesInitialized = false;

export function initializeServices(): void {
  if (servicesInitialized) {
    return;
  }

  console.log("🚀 Initializing application services...");

  // Start EscrowWatcher
  const escrowWatcher = getEscrowWatcher();
  escrowWatcher.start();
  console.log("✅ EscrowWatcher service started");

  // Start RecoveryScheduler
  const recoveryScheduler = getRecoveryScheduler();
  recoveryScheduler.start();
  console.log("✅ RecoveryScheduler service started");

  // Dutch auction pricing is handled on-chain by LOP contract
  console.log("✅ Services initialized (Dutch auctions handled on-chain)");

  servicesInitialized = true;
  console.log("🎉 All services initialized successfully");
}

// Auto-initialize when this module is imported
initializeServices();
