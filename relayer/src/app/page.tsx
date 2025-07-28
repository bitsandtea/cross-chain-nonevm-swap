"use client";

import {
  formatBalance,
  getMultipleTokenBalances,
  TokenBalance,
} from "@/lib/balanceService";
import {
  FlowStep,
  FormData,
  getDefaultFormData,
  IntentFlowManager,
  validateFormData,
} from "@/lib/flowUtils";
import {
  AllowanceState,
  formatAllowanceWithDecimals,
  formatTokenAmountSafe,
  formatTokenAmountSync,
} from "@/lib/tokenUtils";
import { CANCEL_TYPE, Intent } from "@/lib/types";
import { ethers } from "ethers";
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowUp,
  CheckCircle,
  Clock,
  Filter,
  RefreshCw,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast, Toaster } from "react-hot-toast";

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

const CHAINS = {
  1: "Ethereum",
  1000: "Aptos",
};

const TOKENS = {
  1: [
    {
      address:
        process.env.NEXT_PUBLIC_ONEINCH_TOKEN_ADDRESS ||
        "0x5fbdb2315678afecb367f032d93f642f64180aa3",
      symbol: "1INCH",
      name: "1inch Token",
    },
    {
      address:
        process.env.NEXT_PUBLIC_USDC_ADDRESS ||
        "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
      symbol: "USDC",
      name: "USD Coin",
    },
    {
      address:
        process.env.NEXT_PUBLIC_AAVE_TOKEN_ADDRESS ||
        "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
      symbol: "AAVE",
      name: "Aave Token",
    },
    {
      address:
        process.env.NEXT_PUBLIC_WETH_ADDRESS ||
        "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
      symbol: "WETH",
      name: "Wrapped Ether",
    },
    {
      address:
        process.env.NEXT_PUBLIC_UNI_TOKEN_ADDRESS ||
        "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9",
      symbol: "UNI",
      name: "Uniswap Token",
    },
  ],
  1000: [
    {
      address:
        process.env.NEXT_PUBLIC_APT_ADDRESS || "0x1::aptos_coin::AptosCoin",
      symbol: "APT",
      name: "Aptos Coin",
    },
    {
      address:
        process.env.NEXT_PUBLIC_USDC_APTOS_ADDRESS ||
        "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::USDC",
      symbol: "USDC",
      name: "USD Coin",
    },
  ],
};

// Custom hook for formatted token amounts
const useFormattedTokenAmount = (amount: string, tokenAddress: string) => {
  const [formattedAmount, setFormattedAmount] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const formatAmount = async () => {
      setIsLoading(true);
      try {
        // Try sync formatting first for known tokens
        const syncResult = formatTokenAmountSync(amount, tokenAddress, 4);
        if (syncResult !== null) {
          setFormattedAmount(syncResult);
        } else {
          // Fallback to async formatting for unknown tokens
          const asyncResult = await formatTokenAmountSafe(
            amount,
            tokenAddress,
            4
          );
          setFormattedAmount(asyncResult);
        }
      } catch (error) {
        console.error("Failed to format token amount:", error);
        setFormattedAmount("0.0000");
      } finally {
        setIsLoading(false);
      }
    };

    if (amount && tokenAddress) {
      formatAmount();
    } else {
      setFormattedAmount("0.0000");
    }
  }, [amount, tokenAddress]);

  return { formattedAmount, isLoading };
};

// Token amount display component
const TokenAmountDisplay = ({
  amount,
  tokenAddress,
  label,
}: {
  amount: string;
  tokenAddress: string;
  label: string;
}) => {
  const { formattedAmount, isLoading } = useFormattedTokenAmount(
    amount,
    tokenAddress
  );

  if (isLoading) {
    return <span className="text-yellow-400">...</span>;
  }

  return (
    <span>
      {label}: {formattedAmount}
    </span>
  );
};

export default function IntentPool() {
  const [account, setAccount] = useState<string | null>(null);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tokenPrices, setTokenPrices] = useState<Record<string, string>>({});
  const [tokenBalances, setTokenBalances] = useState<
    Record<string, TokenBalance>
  >({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<"compiler" | "pool">("compiler");

  // Flow state
  const [currentStep, setCurrentStep] = useState<FlowStep>(FlowStep.FORM);
  const [allowanceState, setAllowanceState] = useState<AllowanceState>({
    currentAllowance: BigInt(0),
    requiredAmount: BigInt(0),
    hasEnoughAllowance: false,
    isLoading: false,
  });
  const [approvalTxHash, setApprovalTxHash] = useState<string>("");
  const [formData, setFormData] = useState<FormData>(getDefaultFormData());

  // Initialize flow manager
  const flowManager = new IntentFlowManager(
    setCurrentStep,
    setAllowanceState,
    setApprovalTxHash,
    setLoading
  );

  // Load token prices
  const loadTokenPrices = async () => {
    setPricesLoading(true);
    try {
      const allTokens = [
        ...TOKENS[1].map((t) => t.address),
        ...TOKENS[1000].map((t) => t.address),
      ];
      const response = await fetch(
        `/api/prices?tokens=${allTokens.join(",")}&action=prices`
      );
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      setTokenPrices(data.prices || {});
    } catch (error) {
      console.error("Failed to load token prices:", error);
      setTokenPrices({});
    } finally {
      setPricesLoading(false);
    }
  };

  // Load user balances
  const loadUserBalances = async (userAddress: string) => {
    setBalancesLoading(true);
    try {
      const tokenAddresses = TOKENS[1].map((t) => t.address);
      const balances = await getMultipleTokenBalances(
        userAddress,
        tokenAddresses
      );
      setTokenBalances(balances);
    } catch (error) {
      console.error("Failed to load token balances:", error);
    } finally {
      setBalancesLoading(false);
    }
  };

  // Connect wallet
  const connectWallet = async () => {
    if (typeof window.ethereum !== "undefined") {
      try {
        const accounts = (await window.ethereum.request({
          method: "eth_requestAccounts",
        })) as string[];
        setAccount(accounts[0]);
        toast.success("🔗 Neural link established!");
        await loadUserBalances(accounts[0]);
      } catch (error) {
        toast.error("❌ Connection failed");
      }
    } else {
      toast.error("⚠️ MetaMask not detected");
    }
  };

  // Load intents
  const loadIntents = async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/intents");
      const data = await response.json();
      setIntents(data.intents || []);
    } catch (error) {
      toast.error("Failed to load intents");
    } finally {
      setRefreshing(false);
    }
  };

  // Submit intent with validation and flow management
  const submitIntent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) {
      toast.error("Please connect your wallet");
      return;
    }

    const validation = validateFormData(formData);
    if (!validation.valid) {
      toast.error(validation.error || "Invalid form data");
      return;
    }

    // Only check allowance for EVM chains (chain 1)
    if (formData.chainIn === 1) {
      setCurrentStep(FlowStep.CHECKING_ALLOWANCE);
      await flowManager.checkAllowance(
        account,
        formData.sellToken,
        formData.sellAmount
      );
    } else {
      // For non-EVM chains, proceed directly to signing
      await flowManager.executeIntent(
        account,
        formData,
        loadIntents,
        loadUserBalances
      );
      setFormData(getDefaultFormData());
    }
  };

  // Handle approval
  const handleApproval = async () => {
    if (!account || !window.ethereum) return;

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      await flowManager.approveToken(
        formData.sellToken,
        formData.sellAmount,
        signer
      );
    } catch (error) {
      console.error("Approval error:", error);
    }
  };

  // Handle intent execution
  const handleExecuteIntent = async () => {
    if (!account) return;

    await flowManager.executeIntent(
      account,
      formData,
      loadIntents,
      loadUserBalances
    );
    setFormData(getDefaultFormData());
  };

  // Cancel intent
  const cancelIntent = async (intentId: string, nonce: number) => {
    if (!account || !window.ethereum) return;

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Get current network chain ID
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);

      // Create dynamic domain with current chain ID
      const dynamicDomain = {
        name: "CrossChainIntentPool",
        version: "1",
        chainId: currentChainId,
        verifyingContract:
          process.env.NEXT_PUBLIC_ZERO_ADDRESS ||
          "0x0000000000000000000000000000000000000000",
      };

      const message = { intentId, nonce };
      const signature = await signer.signTypedData(
        dynamicDomain,
        CANCEL_TYPE,
        message
      );
      const response = await fetch(`/api/intents/${intentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      if (response.ok) {
        toast.success("Intent cancelled!");
        loadIntents();
      } else {
        const result = await response.json();
        toast.error(result.error || "Failed to cancel intent");
      }
    } catch (error) {
      toast.error("Failed to cancel intent");
    }
  };

  // Helper functions
  const formatTimeRemaining = (expiration: number) => {
    const now = Math.floor(Date.now() / 1000);
    const remaining = expiration - now;
    if (remaining <= 0) return "Expired";
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getTokenPrice = (tokenAddress: string): string => {
    return tokenPrices[tokenAddress] || "0";
  };

  const getTokenBalance = (tokenAddress: string): TokenBalance | null => {
    return tokenBalances[tokenAddress.toLowerCase()] || null;
  };

  const calculateTokenUSD = (amount: string, tokenAddress: string): string => {
    const price = getTokenPrice(tokenAddress);
    if (!price || price === "0") return "$0.00";
    const amountNum = parseFloat(amount);
    const priceNum = parseFloat(price);
    if (isNaN(amountNum) || isNaN(priceNum)) return "$0.00";
    return `$${(amountNum * priceNum).toFixed(2)}`;
  };

  const hasValidPrice = (tokenAddress: string): boolean => {
    const price = getTokenPrice(tokenAddress);
    return price !== "0" && price !== "";
  };

  // Effects
  useEffect(() => {
    loadIntents();
    loadTokenPrices();
    const interval = setInterval(() => {
      loadIntents();
      loadTokenPrices();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (account) {
      loadUserBalances(account);
    }
  }, [account]);

  useEffect(() => {
    if (currentStep !== FlowStep.FORM) {
      flowManager.resetFlow();
    }
  }, [formData.sellToken, formData.sellAmount, formData.chainIn]);

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Cyberpunk Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-cyan-900/20"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(120,119,198,0.1),transparent_50%)]"></div>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.03)_1px,transparent_1px)] bg-[size:50px_50px]"></div>
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-pulse"></div>
      <div className="absolute bottom-0 right-0 w-full h-px bg-gradient-to-l from-transparent via-purple-400 to-transparent animate-pulse"></div>

      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "rgba(0, 0, 0, 0.9)",
            color: "#00ffff",
            border: "1px solid rgba(0, 255, 255, 0.3)",
            borderRadius: "8px",
          },
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-6xl font-mono font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-4 tracking-wider">
            INTENT_GRID.EXE
          </h1>
          <p className="text-cyan-300 text-lg font-mono tracking-wide">
            &gt; CROSS-CHAIN NEURAL SWAP PROTOCOL
          </p>
          <div className="flex justify-center items-center gap-4 mt-4">
            <div className="flex items-center gap-2 text-green-400 text-sm font-mono">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span>MAINNET_PRICES_ACTIVE</span>
            </div>
            {pricesLoading && (
              <div className="flex items-center gap-2 text-yellow-400 text-sm font-mono">
                <Zap className="w-4 h-4 animate-spin" />
                <span>SYNCING_DATA</span>
              </div>
            )}
          </div>
        </div>

        {/* Wallet Connection */}
        <div className="text-center mb-12">
          {!account ? (
            <button
              onClick={connectWallet}
              className="group relative inline-flex items-center px-8 py-4 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border-2 border-cyan-400/50 rounded-lg hover:border-cyan-400 transition-all duration-300 font-mono text-cyan-300 hover:text-white transform hover:scale-105"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/10 to-purple-400/10 rounded-lg blur-xl group-hover:blur-2xl transition-all duration-300"></div>
              <Wallet className="w-6 h-6 mr-3 relative z-10" />
              <span className="relative z-10 text-lg tracking-wider">
                ESTABLISH_NEURAL_LINK
              </span>
            </button>
          ) : (
            <div className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-green-500/20 to-cyan-500/20 border border-green-400/50 rounded-lg font-mono text-green-300">
              <div className="w-3 h-3 bg-green-400 rounded-full mr-3 animate-pulse"></div>
              <span className="tracking-wider">
                LINKED: {account.slice(0, 6)}...{account.slice(-4)}
              </span>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex justify-center mb-8">
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-xl blur opacity-20"></div>
            <div className="relative bg-black/80 backdrop-blur-xl border border-cyan-400/30 rounded-xl p-2 flex">
              <button
                onClick={() => setActiveTab("compiler")}
                className={`px-6 py-3 font-mono text-sm tracking-wider uppercase rounded-lg transition-all duration-300 ${
                  activeTab === "compiler"
                    ? "bg-gradient-to-r from-cyan-500/30 to-purple-500/30 text-cyan-300 border border-cyan-400/50"
                    : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/30"
                }`}
              >
                INTENT_COMPILER
              </button>
              <button
                onClick={() => setActiveTab("pool")}
                className={`px-6 py-3 font-mono text-sm tracking-wider uppercase rounded-lg transition-all duration-300 ${
                  activeTab === "pool"
                    ? "bg-gradient-to-r from-purple-500/30 to-pink-500/30 text-purple-300 border border-purple-400/50"
                    : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/30"
                }`}
              >
                INTENT_POOL
              </button>
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="max-w-4xl mx-auto">
          {activeTab === "compiler" && (
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-2xl blur opacity-20 animate-pulse"></div>
              <div
                className={`relative bg-black/80 backdrop-blur-xl border border-cyan-400/30 rounded-2xl p-8 shadow-2xl ${
                  !account ? "opacity-50 pointer-events-none" : ""
                }`}
              >
                <h2 className="text-3xl font-mono font-bold mb-8 flex items-center text-transparent bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text">
                  <ArrowLeftRight className="w-8 h-8 mr-3 text-cyan-400" />
                  INTENT_COMPILER
                </h2>

                {!account && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-2xl">
                    <div className="text-center">
                      <Wallet className="w-12 h-12 mx-auto mb-4 text-cyan-400" />
                      <p className="text-cyan-300 font-mono text-lg">
                        NEURAL_LINK_REQUIRED
                      </p>
                      <p className="text-gray-400 font-mono text-sm mt-2">
                        Connect wallet to access intent compiler
                      </p>
                    </div>
                  </div>
                )}

                <form onSubmit={submitIntent} className="space-y-8">
                  {/* Chain Selection */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="block text-sm font-mono text-cyan-300 tracking-wider uppercase">
                        SOURCE_CHAIN
                      </label>
                      <select
                        value={formData.chainIn}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            chainIn: parseInt(e.target.value),
                          })
                        }
                        className="w-full p-4 bg-black/50 border border-cyan-400/30 rounded-lg focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 text-white font-mono backdrop-blur-sm transition-all duration-300"
                      >
                        <option value={1}>ETHEREUM.MAINNET</option>
                        <option value={1000}>APTOS.CORE</option>
                      </select>
                    </div>
                    <div className="space-y-3">
                      <label className="block text-sm font-mono text-cyan-300 tracking-wider uppercase">
                        TARGET_CHAIN
                      </label>
                      <select
                        value={formData.chainOut}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            chainOut: parseInt(e.target.value),
                          })
                        }
                        className="w-full p-4 bg-black/50 border border-cyan-400/30 rounded-lg focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 text-white font-mono backdrop-blur-sm transition-all duration-300"
                      >
                        <option value={1}>ETHEREUM.MAINNET</option>
                        <option value={1000}>APTOS.CORE</option>
                      </select>
                    </div>
                  </div>

                  {/* Token Selection */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="block text-sm font-mono text-cyan-300 tracking-wider uppercase">
                        SELL_TOKEN
                      </label>
                      <select
                        value={formData.sellToken}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            sellToken: e.target.value,
                          })
                        }
                        className="w-full p-4 bg-black/50 border border-cyan-400/30 rounded-lg focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 text-white font-mono backdrop-blur-sm transition-all duration-300"
                        required
                      >
                        <option value="">SELECT_ASSET</option>
                        {TOKENS[formData.chainIn as keyof typeof TOKENS]?.map(
                          (token) => {
                            const price = getTokenPrice(token.address);
                            const balance = getTokenBalance(token.address);
                            const priceDisplay = hasValidPrice(token.address)
                              ? `$${price}`
                              : "N/A";
                            return (
                              <option key={token.address} value={token.address}>
                                {token.symbol} - {priceDisplay}{" "}
                                {balance
                                  ? `(${formatBalance(
                                      balance.formattedBalance
                                    )})`
                                  : ""}
                              </option>
                            );
                          }
                        )}
                      </select>
                    </div>
                    <div className="space-y-3">
                      <label className="block text-sm font-mono text-cyan-300 tracking-wider uppercase">
                        BUY_TOKEN
                      </label>
                      <select
                        value={formData.buyToken}
                        onChange={(e) =>
                          setFormData({ ...formData, buyToken: e.target.value })
                        }
                        className="w-full p-4 bg-black/50 border border-cyan-400/30 rounded-lg focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 text-white font-mono backdrop-blur-sm transition-all duration-300"
                        required
                      >
                        <option value="">SELECT_ASSET</option>
                        {TOKENS[formData.chainOut as keyof typeof TOKENS]?.map(
                          (token) => {
                            const price = getTokenPrice(token.address);
                            const priceDisplay = hasValidPrice(token.address)
                              ? `$${price}`
                              : "N/A";
                            return (
                              <option key={token.address} value={token.address}>
                                {token.symbol} - {priceDisplay}
                              </option>
                            );
                          }
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Amounts */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="block text-sm font-mono text-cyan-300 tracking-wider uppercase">
                        SELL_AMOUNT
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.000001"
                          value={formData.sellAmount}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              sellAmount: e.target.value,
                            })
                          }
                          className="w-full p-4 bg-black/50 border border-cyan-400/30 rounded-lg focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 text-white font-mono backdrop-blur-sm transition-all duration-300"
                          placeholder="0.0000"
                          required
                        />
                        {formData.sellAmount && formData.sellToken && (
                          <div className="absolute -bottom-6 left-0 text-xs font-mono text-green-400">
                            ≈{" "}
                            {calculateTokenUSD(
                              formData.sellAmount,
                              formData.sellToken
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <label className="block text-sm font-mono text-cyan-300 tracking-wider uppercase">
                        MIN_BUY_AMOUNT
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.000001"
                          value={formData.minBuyAmount}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              minBuyAmount: e.target.value,
                            })
                          }
                          className="w-full p-4 bg-black/50 border border-cyan-400/30 rounded-lg focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 text-white font-mono backdrop-blur-sm transition-all duration-300"
                          placeholder="0.0000"
                          required
                        />
                        {formData.minBuyAmount && formData.buyToken && (
                          <div className="absolute -bottom-6 left-0 text-xs font-mono text-green-400">
                            ≈{" "}
                            {calculateTokenUSD(
                              formData.minBuyAmount,
                              formData.buyToken
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Settings */}
                  <div className="grid grid-cols-2 gap-6 mt-8">
                    <div className="space-y-3">
                      <label className="block text-sm font-mono text-cyan-300 tracking-wider uppercase">
                        DEADLINE_HOURS
                      </label>
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={formData.deadline}
                        onChange={(e) =>
                          setFormData({ ...formData, deadline: e.target.value })
                        }
                        className="w-full p-4 bg-black/50 border border-cyan-400/30 rounded-lg focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 text-white font-mono backdrop-blur-sm transition-all duration-300"
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="block text-sm font-mono text-cyan-300 tracking-wider uppercase">
                        MAX_SLIPPAGE_%
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={formData.maxSlippage / 100}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            maxSlippage: parseFloat(e.target.value) * 100,
                          })
                        }
                        className="w-full p-4 bg-black/50 border border-cyan-400/30 rounded-lg focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 text-white font-mono backdrop-blur-sm transition-all duration-300"
                      />
                    </div>
                  </div>

                  {/* Multi-step flow UI */}
                  <div className="mt-8 space-y-4">
                    {/* Flow Step Indicator */}
                    {currentStep !== FlowStep.FORM && (
                      <div className="flex items-center justify-center space-x-4 mb-6">
                        <div className="flex items-center space-x-2">
                          {[
                            {
                              step: FlowStep.CHECKING_ALLOWANCE,
                              label: "CHECK",
                              icon: Zap,
                            },
                            {
                              step: FlowStep.NEEDS_APPROVAL,
                              label: "APPROVE",
                              icon: ArrowUp,
                            },
                            {
                              step: FlowStep.READY_TO_SIGN,
                              label: "SIGN",
                              icon: CheckCircle,
                            },
                          ].map(({ step, label, icon: Icon }, index) => (
                            <div key={step} className="flex items-center">
                              <div
                                className={`flex items-center justify-center w-8 h-8 rounded-full border-2 font-mono text-xs ${
                                  currentStep === step
                                    ? "border-cyan-400 bg-cyan-400/20 text-cyan-300"
                                    : [
                                        FlowStep.READY_TO_SIGN,
                                        FlowStep.SIGNING,
                                      ].includes(currentStep) &&
                                      [
                                        FlowStep.CHECKING_ALLOWANCE,
                                        FlowStep.NEEDS_APPROVAL,
                                      ].includes(step)
                                    ? "border-green-400 bg-green-400/20 text-green-300"
                                    : "border-gray-600 bg-gray-600/20 text-gray-400"
                                }`}
                              >
                                <Icon className="w-4 h-4" />
                              </div>
                              <span className="ml-2 text-xs font-mono text-gray-400 hidden sm:block">
                                {label}
                              </span>
                              {index < 2 && (
                                <div className="w-8 h-0.5 bg-gray-600 ml-2 mr-2 hidden sm:block"></div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Allowance Status Display */}
                    {[
                      FlowStep.CHECKING_ALLOWANCE,
                      FlowStep.NEEDS_APPROVAL,
                      FlowStep.READY_TO_SIGN,
                    ].includes(currentStep) && (
                      <div className="p-4 border border-cyan-400/30 rounded-lg bg-cyan-400/5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-mono text-cyan-300">
                            ALLOWANCE_STATUS:
                          </span>
                          {allowanceState.isLoading ? (
                            <Zap className="w-4 h-4 animate-spin text-yellow-400" />
                          ) : allowanceState.hasEnoughAllowance ? (
                            <CheckCircle className="w-4 h-4 text-green-400" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-red-400" />
                          )}
                        </div>
                        {!allowanceState.isLoading && (
                          <>
                            <div className="text-xs font-mono text-gray-300 space-y-1">
                              <div className="flex justify-between">
                                <span>CURRENT:</span>
                                <span className="text-yellow-400">
                                  {formatAllowanceWithDecimals(
                                    allowanceState.currentAllowance,
                                    allowanceState.decimals
                                  )}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>REQUIRED:</span>
                                <span className="text-cyan-400">
                                  {formatAllowanceWithDecimals(
                                    allowanceState.requiredAmount,
                                    allowanceState.decimals
                                  )}
                                </span>
                              </div>
                            </div>
                            {approvalTxHash && (
                              <div className="mt-2 text-xs font-mono text-green-400">
                                TX: {approvalTxHash.slice(0, 10)}...
                                {approvalTxHash.slice(-8)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* Dynamic Action Button */}
                    {currentStep === FlowStep.FORM && (
                      <button
                        type="submit"
                        disabled={loading || !account}
                        className="group relative w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed rounded-lg transition-all duration-300 font-mono text-lg tracking-wider uppercase transform hover:scale-105 disabled:transform-none"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-purple-400 rounded-lg blur opacity-30 group-hover:opacity-50 transition-opacity duration-300"></div>
                        <span className="relative z-10 flex items-center justify-center">
                          <TrendingUp className="w-5 h-5 mr-2" />
                          CHECK_ALLOWANCE
                        </span>
                      </button>
                    )}

                    {currentStep === FlowStep.CHECKING_ALLOWANCE && (
                      <button
                        disabled
                        className="w-full py-4 bg-gradient-to-r from-yellow-500/50 to-orange-500/50 rounded-lg font-mono text-lg tracking-wider uppercase cursor-not-allowed"
                      >
                        <span className="flex items-center justify-center">
                          <Zap className="w-5 h-5 mr-2 animate-spin" />
                          CHECKING_ALLOWANCE...
                        </span>
                      </button>
                    )}

                    {currentStep === FlowStep.NEEDS_APPROVAL && (
                      <div className="space-y-3">
                        <button
                          onClick={handleApproval}
                          className="group relative w-full py-4 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 rounded-lg transition-all duration-300 font-mono text-lg tracking-wider uppercase transform hover:scale-105"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-red-400 rounded-lg blur opacity-30 group-hover:opacity-50 transition-opacity duration-300"></div>
                          <span className="relative z-10 flex items-center justify-center">
                            <ArrowUp className="w-5 h-5 mr-2" />
                            APPROVE_TOKEN
                          </span>
                        </button>
                        <button
                          onClick={() => flowManager.resetFlow()}
                          className="w-full py-2 text-gray-400 hover:text-gray-300 font-mono text-sm tracking-wider uppercase transition-colors duration-300"
                        >
                          ← BACK_TO_FORM
                        </button>
                      </div>
                    )}

                    {currentStep === FlowStep.APPROVING && (
                      <button
                        disabled
                        className="w-full py-4 bg-gradient-to-r from-orange-500/50 to-red-500/50 rounded-lg font-mono text-lg tracking-wider uppercase cursor-not-allowed"
                      >
                        <span className="flex items-center justify-center">
                          <Zap className="w-5 h-5 mr-2 animate-spin" />
                          APPROVING_TOKEN...
                        </span>
                      </button>
                    )}

                    {currentStep === FlowStep.READY_TO_SIGN && (
                      <div className="space-y-3">
                        <button
                          onClick={handleExecuteIntent}
                          disabled={loading}
                          className="group relative w-full py-4 bg-gradient-to-r from-green-500 to-cyan-500 hover:from-green-400 hover:to-cyan-400 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed rounded-lg transition-all duration-300 font-mono text-lg tracking-wider uppercase transform hover:scale-105 disabled:transform-none"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-cyan-400 rounded-lg blur opacity-30 group-hover:opacity-50 transition-opacity duration-300"></div>
                          <span className="relative z-10 flex items-center justify-center">
                            <CheckCircle className="w-5 h-5 mr-2" />
                            SIGN_INTENT
                          </span>
                        </button>
                        <button
                          onClick={() => flowManager.resetFlow()}
                          className="w-full py-2 text-gray-400 hover:text-gray-300 font-mono text-sm tracking-wider uppercase transition-colors duration-300"
                        >
                          ← BACK_TO_FORM
                        </button>
                      </div>
                    )}

                    {currentStep === FlowStep.SIGNING && (
                      <button
                        disabled
                        className="w-full py-4 bg-gradient-to-r from-green-500/50 to-cyan-500/50 rounded-lg font-mono text-lg tracking-wider uppercase cursor-not-allowed"
                      >
                        <span className="flex items-center justify-center">
                          <Zap className="w-5 h-5 mr-2 animate-spin" />
                          SIGNING_INTENT...
                        </span>
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </div>
          )}

          {activeTab === "pool" && (
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 rounded-2xl blur opacity-20 animate-pulse"></div>
              <div className="relative bg-black/80 backdrop-blur-xl border border-purple-400/30 rounded-2xl p-8 shadow-2xl">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-mono font-bold flex items-center text-transparent bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text">
                    <Filter className="w-8 h-8 mr-3 text-purple-400" />
                    INTENT_POOL
                  </h2>
                  <button
                    onClick={loadIntents}
                    disabled={refreshing}
                    className="p-3 text-purple-400 hover:text-purple-300 disabled:animate-spin border border-purple-400/30 rounded-lg hover:border-purple-400/50 transition-all duration-300"
                  >
                    <RefreshCw className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-4 max-h-96 overflow-y-auto scrollbar-thin scrollbar-track-black/20 scrollbar-thumb-cyan-400/30">
                  {intents.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-gray-500 font-mono text-lg">
                        NO_ACTIVE_INTENTS
                      </div>
                      <div className="text-gray-600 font-mono text-sm mt-2">
                        &gt; GRID_EMPTY.STATUS
                      </div>
                    </div>
                  ) : (
                    intents.map((intent) => (
                      <div
                        key={intent.id}
                        className="border border-gray-700/50 bg-gray-900/30 backdrop-blur-sm rounded-lg p-4 hover:border-cyan-400/30 hover:shadow-lg hover:shadow-cyan-400/10 transition-all duration-300"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center space-x-3">
                            <span
                              className={`px-3 py-1 text-xs rounded-full font-mono tracking-wider ${
                                intent.status === "pending"
                                  ? "bg-yellow-400/20 text-yellow-300 border border-yellow-400/30"
                                  : intent.status === "filled"
                                  ? "bg-green-400/20 text-green-300 border border-green-400/30"
                                  : "bg-gray-400/20 text-gray-300 border border-gray-400/30"
                              }`}
                            >
                              {intent.status.toUpperCase()}
                            </span>
                            <span className="text-sm text-cyan-300 font-mono">
                              {CHAINS[intent.chainIn as keyof typeof CHAINS]} →{" "}
                              {CHAINS[intent.chainOut as keyof typeof CHAINS]}
                            </span>
                          </div>
                          <div className="flex items-center text-sm text-gray-400 font-mono">
                            <Clock className="w-4 h-4 mr-1" />
                            {formatTimeRemaining(intent.expiration)}
                          </div>
                        </div>

                        <div className="text-sm text-gray-300 mb-2 font-mono">
                          <TokenAmountDisplay
                            amount={intent.amountIn}
                            tokenAddress={intent.sellToken}
                            label="SELL"
                          />{" "}
                          →{" "}
                          <TokenAmountDisplay
                            amount={intent.minAmountOut}
                            tokenAddress={intent.buyToken}
                            label="MIN_BUY"
                          />
                        </div>

                        <div className="text-xs text-gray-500 mb-3 font-mono">
                          USER: {intent.userAddress.slice(0, 6)}...
                          {intent.userAddress.slice(-4)}
                        </div>

                        {account &&
                          intent.userAddress.toLowerCase() ===
                            account.toLowerCase() &&
                          intent.status === "pending" && (
                            <button
                              onClick={() =>
                                cancelIntent(intent.id, intent.nonce)
                              }
                              className="text-red-400 hover:text-red-300 text-sm font-mono tracking-wider border border-red-400/30 px-3 py-1 rounded hover:border-red-400/50 transition-all duration-300"
                            >
                              TERMINATE
                            </button>
                          )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
