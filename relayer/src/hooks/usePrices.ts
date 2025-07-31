import { getAllTokens, TokenMapping } from "@/lib/tokenMapping";
import { useEffect, useState } from "react";

export function usePrices() {
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const availableTokens = getAllTokens().map((token: TokenMapping) => ({
    ...token,
    address: token.localAddress,
    chainId: token.localAddress.includes("::") ? 1000 : 1, // Aptos vs Ethereum
  }));

  const loadTokenPrices = async () => {
    setLoading(true);
    try {
      const tokens = availableTokens.map((token) => token.address);
      const tokensParam = tokens.join(",");
      const response = await fetch(
        `/api/prices?tokens=${encodeURIComponent(tokensParam)}`
      );
      const data = await response.json();
      setTokenPrices(data.prices || {});
    } catch (error) {
      console.error("Failed to load token prices:", error);
    } finally {
      setLoading(false);
    }
  };

  // Load prices on mount
  useEffect(() => {
    loadTokenPrices();
  }, []);

  return {
    tokenPrices,
    loading,
    loadTokenPrices,
  };
}
