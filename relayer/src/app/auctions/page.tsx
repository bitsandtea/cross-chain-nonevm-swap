"use client";

import { getPriceDecayService } from "@/lib/priceDecayService";
import { AuctionPriceCurve, FusionPlusIntent } from "@/lib/types";
import { useEffect, useState } from "react";

interface AuctionData extends AuctionPriceCurve {
  intent: FusionPlusIntent;
}

export default function AuctionsPage() {
  const [auctions, setAuctions] = useState<AuctionData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAuctions() {
      try {
        // Get all intents
        const intentsResponse = await fetch("/api/intents");
        const intentsData = await intentsResponse.json();
        const intents: FusionPlusIntent[] = intentsData.intents || [];

        // Get price decay service data
        const priceDecayService = getPriceDecayService();
        const priceCurves = priceDecayService.getAllPriceCurves();

        // Combine intent data with auction data
        const auctionData: AuctionData[] = [];

        for (const curve of priceCurves) {
          const intent = intents.find((i) => i.id === curve.intentId);
          if (intent && intent.status === "pending") {
            auctionData.push({
              ...curve,
              intent,
            });
          }
        }

        setAuctions(auctionData);
      } catch (error) {
        console.error("Failed to load auctions:", error);
      } finally {
        setLoading(false);
      }
    }

    loadAuctions();

    // Refresh every 5 seconds
    const interval = setInterval(loadAuctions, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-lg">Loading auctions...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Live Dutch Auctions</h1>

      {auctions.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-xl text-gray-600">No active auctions</div>
        </div>
      ) : (
        <div className="grid gap-6">
          {auctions.map((auction) => (
            <div
              key={auction.intent.id}
              className="border rounded-lg p-6 bg-white shadow-sm"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold">
                    Fusion+ Order #{auction.intent.id.slice(0, 8)}...
                  </h3>
                  <div className="text-sm text-gray-600">
                    {auction.intent.fusionOrder.maker.slice(0, 10)}...
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-blue-600">
                    ${auction.currentPrice.toFixed(2)}
                  </div>
                  <div className="text-sm text-gray-500">Current Price</div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-600">Making Amount</div>
                  <div className="font-medium">
                    {parseFloat(auction.intent.fusionOrder.makingAmount) / 1e18}{" "}
                    tokens
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Taking Amount</div>
                  <div className="font-medium">
                    {parseFloat(auction.intent.fusionOrder.takingAmount) / 1e18}{" "}
                    tokens
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Start Price</div>
                  <div className="font-medium">
                    ${auction.startPrice.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Min Price</div>
                  <div className="font-medium">
                    ${auction.minPrice.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="mt-4 bg-gray-100 rounded-lg p-3">
                <div className="flex justify-between text-sm">
                  <span>Auction Progress</span>
                  <span>
                    {((Date.now() - auction.startTime) / 1000).toFixed(0)}s
                    elapsed
                  </span>
                </div>
                <div className="w-full bg-gray-300 rounded-full h-2 mt-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-1000"
                    style={{
                      width: `${Math.min(
                        100,
                        ((Date.now() - auction.startTime) /
                          (auction.decayPeriod * 1000)) *
                          100
                      )}%`,
                    }}
                  ></div>
                </div>
              </div>

              <div className="mt-4 text-xs text-gray-500">
                Chains: {auction.intent.fusionOrder.srcChain} →{" "}
                {auction.intent.fusionOrder.dstChain} | Timelock:{" "}
                {auction.intent.fusionOrder.srcTimelock}s →{" "}
                {auction.intent.fusionOrder.dstTimelock}s
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
