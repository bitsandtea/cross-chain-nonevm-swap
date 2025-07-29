import { getPriceDecayService } from "./priceDecayService";

// Initialize all services when the application starts
let servicesInitialized = false;

export function initializeServices(): void {
  if (servicesInitialized) {
    return;
  }

  console.log("🚀 Initializing application services...");

  // Initialize price decay service
  const priceDecayService = getPriceDecayService();
  console.log("✅ Price decay service initialized");

  servicesInitialized = true;
  console.log("🎉 All services initialized successfully");
}

// Auto-initialize when this module is imported
initializeServices();
