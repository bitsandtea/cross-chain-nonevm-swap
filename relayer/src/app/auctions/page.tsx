"use client";

import { FusionPlusIntent } from "@/lib/types";
import { useEffect, useState } from "react";

export default function AuctionsPage() {
  const [intents, setIntents] = useState<FusionPlusIntent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadIntents() {
      try {
        // Get all Dutch auction intents
        const intentsResponse = await fetch("/api/intents");
        const intentsData = await intentsResponse.json();
        const allIntents: FusionPlusIntent[] = intentsData.intents || [];

        // Filter for Dutch auction orders
        const dutchAuctions = allIntents.filter(
          (intent) =>
            intent.fusionOrder.startRate !== "0" && intent.status === "pending"
        );

        setIntents(dutchAuctions);
      } catch (error) {
        console.error("Failed to load intents:", error);
      } finally {
        setLoading(false);
      }
    }

    loadIntents();

    // Refresh every 10 seconds
    const interval = setInterval(loadIntents, 10000);
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
      <h1 className="text-3xl font-bold mb-6">Dutch Auction Orders</h1>

      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h2 className="text-lg font-semibold text-blue-800 mb-2">
          How Dutch Auctions Work
        </h2>
        <p className="text-blue-700">
          Dutch auction pricing happens on-chain in the LOP contract after a
          resolver calls `deploySrc`. The price decays from start rate to end
          rate over the auction duration according to the encoded parameters.
        </p>
      </div>

      {intents.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-xl text-gray-600">No Dutch auction orders</div>
          <div className="text-gray-500 mt-2">
            Create a Dutch auction order to see it here
          </div>
        </div>
      ) : (
        <div className="grid gap-6">
          {intents.map((intent) => (
            <div
              key={intent.id}
              className="border rounded-lg p-6 bg-white shadow-sm"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold">
                    Fusion+ Order #{intent.id.slice(0, 8)}...
                  </h3>
                  <div className="text-sm text-gray-600">
                    {intent.fusionOrder.maker.slice(0, 10)}...
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium px-2 py-1 bg-yellow-100 text-yellow-800 rounded">
                    {intent.status.toUpperCase()}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-600">Making Amount</div>
                  <div className="font-medium">
                    {parseFloat(intent.fusionOrder.makingAmount) / 1e18} tokens
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Taking Amount</div>
                  <div className="font-medium">
                    {parseFloat(intent.fusionOrder.takingAmount) / 1e18} tokens
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Start Rate</div>
                  <div className="font-medium">
                    ${intent.fusionOrder.startRate}
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">End Rate</div>
                  <div className="font-medium">
                    ${intent.fusionOrder.endRate}
                  </div>
                </div>
              </div>

              <div className="mt-4 text-xs text-gray-500">
                Chains: {intent.fusionOrder.srcChain} →{" "}
                {intent.fusionOrder.dstChain} | Duration:{" "}
                {intent.fusionOrder.auctionDuration}s | Timelock:{" "}
                {intent.fusionOrder.srcTimelock}s →{" "}
                {intent.fusionOrder.dstTimelock}s
              </div>

              <div className="mt-2 text-xs text-blue-600">
                ⚡ Auction will start on-chain when resolver calls deploySrc
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
