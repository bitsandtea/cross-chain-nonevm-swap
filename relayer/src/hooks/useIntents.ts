import { FusionPlusIntent } from "@/lib/types";
import { ethers } from "ethers";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { ZERO_ADDRESS } from "../../config/env";

export type OrderFilter = "active" | "expired" | "filled" | "cancelled" | "all";

export function useIntents() {
  const [intents, setIntents] = useState<FusionPlusIntent[]>([]);
  const [loading, setLoading] = useState(false);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("active");

  const loadIntents = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/intents");
      const data = await response.json();
      setIntents(data.intents || []);
    } catch (error) {
      console.error("Failed to load intents:", error);
      toast.error("Failed to load intents");
    } finally {
      setLoading(false);
    }
  };

  const cancelIntent = async (intentId: string, nonce: number) => {
    try {
      if (typeof window.ethereum === "undefined") {
        throw new Error("MetaMask not found");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Get current network chain ID
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);

      // Create dynamic domain
      const domain = {
        name: "CrossChainFusionPlus",
        version: "1",
        chainId: currentChainId,
        verifyingContract: ZERO_ADDRESS,
      };

      const message = { intentId, nonce };
      const signature = await signer.signTypedData(
        domain,
        {
          IntentId: [{ name: "intentId", type: "string" }],
          Nonce: [{ name: "nonce", type: "uint256" }],
        },
        message
      );

      const response = await fetch(`/api/intents/${intentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      });

      if (response.ok) {
        toast.success("FUSION ORDER TERMINATED");
        loadIntents();
      } else {
        const error = await response.json();
        toast.error(error.error || "TERMINATION FAILED");
      }
    } catch (error) {
      console.error("Cancel error:", error);
      toast.error("TERMINATION FAILED");
    }
  };

  // Load intents on mount and set up auto-refresh
  useEffect(() => {
    loadIntents();

    // Setup auto-refresh
    const interval = setInterval(() => {
      loadIntents();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, []);

  // Filter intents based on selected filter
  const getFilteredIntents = () => {
    const now = Math.floor(Date.now() / 1000);

    return intents.filter((intent) => {
      switch (orderFilter) {
        case "active":
          return intent.status === "pending";
        case "expired":
          // Check if expiration has passed
          const expiration = intent.fusionOrder?.expiration;
          return expiration && parseInt(expiration.toString()) < now;
        case "filled":
          return intent.status === "filled" || intent.status === "completed";
        case "cancelled":
          return intent.status === "cancelled";
        case "all":
          return true;
        default:
          return true;
      }
    });
  };

  return {
    intents,
    loading,
    loadIntents,
    cancelIntent,
    orderFilter,
    setOrderFilter,
    getFilteredIntents,
  };
}
