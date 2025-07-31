import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";

// TypeScript declarations for ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
      on: (eventName: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export function useMetaMask() {
  const [account, setAccount] = useState<string>("");
  const [isConnected, setIsConnected] = useState(false);

  const connectWallet = async () => {
    if (typeof window.ethereum !== "undefined") {
      try {
        const accounts = (await window.ethereum.request({
          method: "eth_requestAccounts",
        })) as string[];
        setAccount(accounts[0]);
        setIsConnected(true);
        toast.success("NEURAL LINK ESTABLISHED");
      } catch (error) {
        console.error("Failed to connect wallet:", error);
        toast.error("NEURAL LINK FAILED");
      }
    } else {
      toast.error("METAMASK MODULE NOT DETECTED");
    }
  };

  const disconnect = () => {
    setAccount("");
    setIsConnected(false);
  };

  // Check if wallet is already connected on mount
  useEffect(() => {
    if (typeof window.ethereum !== "undefined") {
      window.ethereum
        .request({ method: "eth_accounts" })
        .then((accounts: unknown) => {
          const accountsArray = accounts as string[];
          if (accountsArray.length > 0) {
            setAccount(accountsArray[0]);
            setIsConnected(true);
          }
        });
    }
  }, []);

  return {
    account,
    isConnected,
    connectWallet,
    disconnect,
  };
}
