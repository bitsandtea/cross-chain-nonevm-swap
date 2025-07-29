// Price decay service for Dutch auctions
import {
  AuctionPriceCurve,
  CurrentAuctionPrice,
  FusionPlusIntent,
} from "./types";

class PriceDecayService {
  private priceCurves: Map<string, AuctionPriceCurve> = new Map();

  // Add a new Dutch auction to track
  addDutchAuction(intent: FusionPlusIntent | Record<string, unknown>): void {
    // Support both FusionPlusIntent and legacy format for compatibility
    const isFusionIntent = "fusionOrder" in intent;

    if (isFusionIntent) {
      // Handle Fusion+ intent
      const fusionIntent = intent as FusionPlusIntent;
      if (fusionIntent.fusionOrder.startRate !== "0") {
        const curve: AuctionPriceCurve = {
          intentId: fusionIntent.id,
          startPrice: parseFloat(fusionIntent.fusionOrder.startRate),
          endPrice: parseFloat(fusionIntent.fusionOrder.endRate),
          duration: fusionIntent.fusionOrder.auctionDuration,
          startTime: fusionIntent.fusionOrder.auctionStartTime,
          status: "active",
        };
        this.priceCurves.set(fusionIntent.id, curve);
        console.log(
          `🎯 Started tracking Fusion+ Dutch auction: ${fusionIntent.id}`
        );
      }
    } else {
      // Handle legacy format for backward compatibility
      if (
        intent.auctionType === "dutch" &&
        intent.status === "pending" &&
        intent.startPrice &&
        intent.minPrice
      ) {
        const curve: AuctionPriceCurve = {
          intentId: intent.id,
          startPrice: parseFloat(intent.startPrice),
          currentPrice: parseFloat(intent.startPrice),
          minPrice: parseFloat(intent.minPrice),
          decayRate: intent.decayRate || 200,
          decayPeriod: intent.decayPeriod || 3600,
          startTime: intent.createdAt,
          lastUpdated: Date.now(),
        };
        this.priceCurves.set(intent.id, curve);
        console.log(`🎯 Started tracking Dutch auction: ${intent.id}`);
      }
    }
  }

  // Remove a price curve (when auction ends or is cancelled)
  removePriceCurve(intentId: string): void {
    const existed = this.priceCurves.delete(intentId);
    if (existed) {
      console.log(`🗑️ Stopped tracking auction: ${intentId}`);
    }
  }

  // Update all active price curves
  updateAllPrices(): void {
    const now = Date.now();
    for (const [intentId, curve] of this.priceCurves.entries()) {
      const timeElapsed = (now - curve.startTime) / 1000; // Convert to seconds

      if (timeElapsed >= curve.decayPeriod) {
        // Auction period ended, price should be at minimum
        curve.currentPrice = curve.minPrice;
      } else {
        // Calculate exponential decay
        const progress = timeElapsed / curve.decayPeriod;
        const decayFactor = Math.exp((-curve.decayRate * progress) / 10000);
        const priceRange = curve.startPrice - curve.minPrice;
        curve.currentPrice = curve.minPrice + priceRange * decayFactor;
      }

      curve.lastUpdated = now;
    }
  }

  // Get current price for a specific auction
  getCurrentPrice(intentId: string): CurrentAuctionPrice | null {
    const curve = this.priceCurves.get(intentId);
    if (!curve) return null;

    this.updatePriceCurve(curve);

    const timeElapsed = (Date.now() - curve.startTime) / 1000;
    const isActive = timeElapsed < curve.decayPeriod;

    return {
      intentId,
      originalStartPrice: curve.startPrice,
      currentPrice: curve.currentPrice,
      minPrice: curve.minPrice,
      timeElapsed,
      isActive,
    };
  }

  // Get all current auction prices
  getAllCurrentPrices(): CurrentAuctionPrice[] {
    this.updateAllPrices();
    return Array.from(this.priceCurves.values()).map((curve) => {
      const timeElapsed = (Date.now() - curve.startTime) / 1000;
      const isActive = timeElapsed < curve.decayPeriod;

      return {
        intentId: curve.intentId,
        originalStartPrice: curve.startPrice,
        currentPrice: curve.currentPrice,
        minPrice: curve.minPrice,
        timeElapsed,
        isActive,
      };
    });
  }

  // Get all price curves
  getAllPriceCurves(): AuctionPriceCurve[] {
    this.updateAllPrices();
    return Array.from(this.priceCurves.values());
  }

  // Get auction statistics
  getAuctionStats() {
    const curves = Array.from(this.priceCurves.values());
    const now = Date.now();

    const activeCurves = curves.filter((curve) => {
      const timeElapsed = (now - curve.startTime) / 1000;
      return timeElapsed < curve.decayPeriod;
    }).length;

    const totalTimeElapsed = curves.reduce((sum, curve) => {
      return sum + (now - curve.startTime) / 1000;
    }, 0);

    return {
      activeCurves,
      totalTracked: curves.length,
      averageTimeElapsed:
        curves.length > 0 ? totalTimeElapsed / curves.length : 0,
    };
  }

  // Update a single price curve
  private updatePriceCurve(curve: AuctionPriceCurve): void {
    const now = Date.now();
    const timeElapsed = (now - curve.startTime) / 1000;

    if (timeElapsed >= curve.decayPeriod) {
      curve.currentPrice = curve.minPrice;
    } else {
      const progress = timeElapsed / curve.decayPeriod;
      const decayFactor = Math.exp((-curve.decayRate * progress) / 10000);
      const priceRange = curve.startPrice - curve.minPrice;
      curve.currentPrice = curve.minPrice + priceRange * decayFactor;
    }

    curve.lastUpdated = now;
  }

  // Clear all price curves (useful for testing)
  clearAll(): void {
    this.priceCurves.clear();
    console.log("🧹 Cleared all price curves");
  }

  // Get total number of tracked auctions
  getTrackedCount(): number {
    return this.priceCurves.size;
  }
}

// Singleton instance
let priceDecayServiceInstance: PriceDecayService | null = null;

export function getPriceDecayService(): PriceDecayService {
  if (!priceDecayServiceInstance) {
    priceDecayServiceInstance = new PriceDecayService();

    // Start the price update interval (every 1 second)
    setInterval(() => {
      priceDecayServiceInstance?.updateAllPrices();
    }, 1000);

    console.log("🚀 Price decay service initialized");
  }
  return priceDecayServiceInstance;
}
