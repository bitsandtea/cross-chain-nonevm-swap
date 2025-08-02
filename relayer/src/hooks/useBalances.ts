import { getAllTokens, TokenMapping } from "@/lib/tokenMapping";
import { useEffect, useState } from "react";

interface UserBalance {
  [tokenAddress: string]: string; // Raw balance in wei/smallest unit
}

export function useBalances(account: string, formData: any) {
  const [userBalances, setUserBalances] = useState<UserBalance>({});
  const [loading, setLoading] = useState(false);

  const availableTokens = getAllTokens().map((token: TokenMapping) => ({
    ...token,
    address: token.localAddress,
    chainId: token.localAddress.includes("::") ? 1000 : 1, // Aptos vs Ethereum
  }));

  const loadUserBalances = async (address: string) => {
    if (!address) return;

    setLoading(true);
    try {
      const balances: UserBalance = {};
      if (formData.sellToken) {
        const selectedToken = availableTokens.find(
          (token) => token.address === formData.sellToken
        );

        if (selectedToken && selectedToken.chainId === 1) {
          // Ethereum tokens
          try {
            const response = await fetch(
              `/api/balances?address=${address}&token=${selectedToken.address}`
            );
            if (response.ok) {
              const data = await response.json();
              balances[selectedToken.address.toLowerCase()] =
                data.balance || "0";
            } else {
              console.error(
                `Failed to load balance for ${selectedToken.symbol}:`,
                response.statusText
              );
              balances[selectedToken.address.toLowerCase()] = "0";
            }
          } catch (error) {
            console.error(
              `Failed to load balance for ${selectedToken.symbol}:`,
              error
            );
            balances[selectedToken.address.toLowerCase()] = "0";
          }
        }
        // TODO: Add Aptos balance fetching when API is ready
      }

      setUserBalances(balances);
    } catch (error) {
      console.error("Failed to load balances:", error);
    } finally {
      setLoading(false);
    }
  };

  // Load balances when account or sell token changes
  useEffect(() => {
    if (account) {
      loadUserBalances(account);
    }
  }, [account, formData.sellToken]);

  return {
    userBalances,
    loading,
    loadUserBalances,
  };
}
