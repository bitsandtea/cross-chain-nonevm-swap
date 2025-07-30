"use client";

import {
  FlowStep,
  FormData,
  getDefaultFormData,
  IntentFlowManager,
  validateFormData,
} from "@/lib/flowUtils";
import { getAllTokens, TokenMapping } from "@/lib/tokenMapping";
import { AllowanceState } from "@/lib/tokenUtils";
import { CANCEL_TYPE, FusionPlusIntent } from "@/lib/types";
import { Listbox, Transition } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";
import { ethers } from "ethers";
import {
  Activity,
  CheckCircle,
  ExternalLink,
  Loader2,
  Target,
  TrendingDown,
  Wallet,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { toast, Toaster } from "react-hot-toast";

// Custom Cyberpunk Dropdown Component
interface DropdownOption {
  value: string | number;
  label: string;
}

interface CyberpunkDropdownProps {
  value: string | number;
  onChange: (value: string | number) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
}

function CyberpunkDropdown({
  value,
  onChange,
  options,
  placeholder = "Select...",
  className = "",
}: CyberpunkDropdownProps) {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <Listbox value={value} onChange={onChange}>
      <div className={`relative ${className}`}>
        <Listbox.Button className="w-full p-4 bg-gray-900/70 border-2 border-gray-600/50 rounded-xl text-white font-mono text-sm focus:border-cyan-400 focus:shadow-lg focus:shadow-cyan-400/30 transition-all backdrop-blur-sm text-left cursor-pointer hover:border-gray-500/50">
          <span className="block truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
            <ChevronDownIcon
              className="h-5 w-5 text-cyan-400"
              aria-hidden="true"
            />
          </span>
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute z-50 mt-2 max-h-60 w-full overflow-auto rounded-xl bg-gray-900/95 border-2 border-cyan-400/50 backdrop-blur-xl shadow-lg shadow-cyan-400/30 focus:outline-none text-sm font-mono">
            {options.map((option) => (
              <Listbox.Option
                key={option.value}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-3 px-4 transition-all duration-200 ${
                    active
                      ? "bg-cyan-400/20 text-cyan-300 shadow-lg shadow-cyan-400/20"
                      : "text-gray-300 hover:bg-gray-800/50"
                  }`
                }
                value={option.value}
              >
                {({ selected }) => (
                  <span
                    className={`block truncate ${
                      selected ? "font-bold text-cyan-300" : "font-normal"
                    }`}
                  >
                    {option.label}
                  </span>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}

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

interface UserBalance {
  [tokenAddress: string]: string; // Raw balance in wei/smallest unit
}

// Chain helper functions
function getChainName(chainId: number): string {
  switch (chainId) {
    case 1:
      return "Ethereum";
    case 1000:
      return "Aptos";
    default:
      return `Chain ${chainId}`;
  }
}

function getAddressExample(chainId: number): string {
  switch (chainId) {
    case 1:
      return "0x742d35Cc6527C6f25c8bF3C7bE7Cf1d6b8c5a7D8";
    case 1000:
      return "0x44689d8f78944f57e1d84bfa1d9f4042d20d7e22c3ec0fe93a05b8035c7712c1";
    default:
      return "Your destination address";
  }
}

export default function Home() {
  // State management
  const [account, setAccount] = useState<string>("");
  const [isConnected, setIsConnected] = useState(false);
  const [formData, setFormData] = useState<FormData>(getDefaultFormData());
  const [intents, setIntents] = useState<FusionPlusIntent[]>([]);
  const [userBalances, setUserBalances] = useState<UserBalance>({});
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [loadingStates, setLoadingStates] = useState({
    intents: false,
    balances: false,
    prices: false,
  });
  const [activeTab, setActiveTab] = useState<"create" | "orders">("create");
  const [orderFilter, setOrderFilter] = useState<
    "active" | "expired" | "filled" | "cancelled" | "all"
  >("active");

  // Flow management
  const [currentStep, setCurrentStep] = useState<FlowStep>(FlowStep.FORM);
  const [allowanceState, setAllowanceState] = useState<AllowanceState>({
    currentAllowance: BigInt(0),
    requiredAmount: BigInt(0),
    hasEnoughAllowance: false,
    isLoading: false,
  });
  const [approvalTxHash, setApprovalTxHash] = useState("");
  const [loading, setLoading] = useState(false);

  // Flow manager instance
  const flowManager = new IntentFlowManager(
    setCurrentStep,
    setAllowanceState,
    setApprovalTxHash,
    setLoading
  );

  // Available tokens with chain information
  const availableTokens = getAllTokens().map((token: TokenMapping) => ({
    ...token,
    address: token.localAddress,
    chainId: token.localAddress.includes("::") ? 1000 : 1, // Aptos vs Ethereum
  }));

  // Connect wallet
  const connectWallet = async () => {
    if (typeof window.ethereum !== "undefined") {
      try {
        const accounts = (await window.ethereum.request({
          method: "eth_requestAccounts",
        })) as string[];
        setAccount(accounts[0]);
        setIsConnected(true);
        await loadUserBalances(accounts[0]);
        toast.success("NEURAL LINK ESTABLISHED");
      } catch (error) {
        console.error("Failed to connect wallet:", error);
        toast.error("NEURAL LINK FAILED");
      }
    } else {
      toast.error("METAMASK MODULE NOT DETECTED");
    }
  };

  // Load intents
  const loadIntents = async () => {
    setLoadingStates((prev) => ({ ...prev, intents: true }));
    try {
      const response = await fetch("/api/intents");
      const data = await response.json();
      setIntents(data.intents || []);
    } catch (error) {
      console.error("Failed to load intents:", error);
      toast.error("Failed to load intents");
    } finally {
      setLoadingStates((prev) => ({ ...prev, intents: false }));
    }
  };

  // Load user balances (simplified - would need proper implementation)
  const loadUserBalances = async (address: string) => {
    if (!address) return;

    setLoadingStates((prev) => ({ ...prev, balances: true }));
    try {
      // This would need proper implementation with balance service
      const balances: UserBalance = {};
      setUserBalances(balances);
    } catch (error) {
      console.error("Failed to load balances:", error);
    } finally {
      setLoadingStates((prev) => ({ ...prev, balances: false }));
    }
  };

  // Load token prices
  const loadTokenPrices = async () => {
    setLoadingStates((prev) => ({ ...prev, prices: true }));
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
      setLoadingStates((prev) => ({ ...prev, prices: false }));
    }
  };

  // Initial setup
  useEffect(() => {
    // Check if wallet is already connected
    if (typeof window.ethereum !== "undefined") {
      window.ethereum
        .request({ method: "eth_accounts" })
        .then((accounts: unknown) => {
          const accountsArray = accounts as string[];
          if (accountsArray.length > 0) {
            setAccount(accountsArray[0]);
            setIsConnected(true);
            loadUserBalances(accountsArray[0]);
          }
        });
    }

    loadIntents();
    loadTokenPrices();

    // Setup auto-refresh
    const interval = setInterval(() => {
      loadIntents();
      if (account) {
        loadUserBalances(account);
      }
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [account]);

  // Auto-check allowances when form data changes
  useEffect(() => {
    const checkAllowanceAutomatically = async () => {
      console.log("checkAllowanceAutomatically");
      console.log("isConnected", isConnected);
      console.log("account", account);
      console.log("formData.sellToken", formData.sellToken);
      console.log("formData.sellAmount", formData.sellAmount);
      console.log("currentStep", currentStep);

      if (
        isConnected &&
        account &&
        formData.sellToken &&
        formData.sellAmount &&
        currentStep === FlowStep.FORM
      ) {
        try {
          console.log("checkAllowanceAutomatically 2");
          await flowManager.checkAllowance(
            account,
            formData.sellToken,
            formData.sellAmount
          );
        } catch (error) {
          console.error("Auto allowance check failed:", error);
          // Don't show error toast for automatic checks
        }
      }
    };

    // Debounce the allowance check to avoid excessive API calls
    const timeoutId = setTimeout(checkAllowanceAutomatically, 500);
    return () => clearTimeout(timeoutId);
  }, [
    isConnected,
    account,
    formData.sellToken,
    formData.sellAmount,
    currentStep,
  ]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConnected) {
      toast.error("NEURAL LINK REQUIRED");
      return;
    }

    // Validate form data
    const validation = validateFormData(formData);
    if (!validation.valid) {
      toast.error(validation.error || "INVALID FUSION PARAMETERS");
      return;
    }

    // If allowance is already sufficient, execute directly
    if (allowanceState.hasEnoughAllowance) {
      await executeIntent();
      return;
    }

    // Check allowance if not already done
    await flowManager.checkAllowance(
      account,
      formData.sellToken,
      formData.sellAmount
    );
  };

  // Execute the intent
  const executeIntent = async () => {
    try {
      await flowManager.executeFusionOrder(
        account,
        formData,
        loadIntents,
        loadUserBalances
      );
    } catch (error) {
      console.error("Failed to execute intent:", error);
      toast.error("FUSION EXECUTION FAILED");
    }
  };

  // Handle approval
  const handleApproval = async () => {
    try {
      if (!window.ethereum) {
        throw new Error("MetaMask not found");
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      await flowManager.approveToken(
        formData.sellToken,
        formData.sellAmount,
        signer
      );
    } catch (error) {
      console.error("Approval error:", error);
      toast.error("TOKEN APPROVAL FAILED");
    }
  };

  // Cancel an intent
  const cancelIntent = async (intentId: string, nonce: number) => {
    try {
      if (!window.ethereum) {
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
        verifyingContract:
          process.env.NEXT_PUBLIC_ZERO_ADDRESS ||
          "0x0000000000000000000000000000000000000000",
      };

      const message = { intentId, nonce };
      const signature = await signer.signTypedData(
        domain,
        CANCEL_TYPE,
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

  // Get token info helper
  const getTokenInfoForChain = (address: string, chainId: number) => {
    return availableTokens.find(
      (token) => token.address === address && token.chainId === chainId
    );
  };

  // Format balance for display
  const formatBalance = (balance: string, decimals: number): string => {
    try {
      const formatted = parseFloat(ethers.formatUnits(balance, decimals));
      return formatted.toFixed(4);
    } catch {
      return "0.0000";
    }
  };

  // Get USD value of amount
  const getUSDValue = (amount: string, tokenAddress: string): string => {
    try {
      const price = tokenPrices[tokenAddress.toLowerCase()] || 0;
      const value = parseFloat(amount) * price;
      return value.toFixed(2);
    } catch {
      return "0.00";
    }
  };

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

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Enhanced background effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-black to-cyan-900/30"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(147,51,234,0.2),transparent_40%)]"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_70%,rgba(6,182,212,0.15),transparent_40%)]"></div>

      {/* Animated grid lines */}
      <div className="absolute inset-0 opacity-20">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
            linear-gradient(rgba(139, 92, 246, 0.3) 1px, transparent 1px),
            linear-gradient(90deg, rgba(139, 92, 246, 0.3) 1px, transparent 1px)
          `,
            backgroundSize: "50px 50px",
            animation: "pulse 4s ease-in-out infinite",
          }}
        ></div>
      </div>

      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "rgba(0, 0, 0, 0.95)",
            color: "#00ffff",
            border: "1px solid rgba(0, 255, 255, 0.5)",
            borderRadius: "8px",
            fontFamily: "monospace",
            boxShadow: "0 0 20px rgba(0, 255, 255, 0.3)",
          },
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-5xl font-mono font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent tracking-wider">
              FUSION+ GRID
            </h1>
            <div className="flex items-center mt-3">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse mr-3"></div>
              <p className="text-cyan-300 text-sm font-mono tracking-wide">
                &gt; QUANTUM CROSS-CHAIN PROTOCOL ACTIVE
              </p>
            </div>
          </div>

          {/* Enhanced Wallet Connection */}
          <div className="flex items-center space-x-4">
            {!isConnected ? (
              <button
                onClick={connectWallet}
                className="flex items-center px-8 py-4 bg-gradient-to-r from-purple-600/30 to-cyan-600/30 border-2 border-purple-400/50 rounded-xl hover:border-purple-400/80 transition-all duration-300 font-mono text-purple-200 hover:text-white transform hover:scale-105 shadow-lg hover:shadow-purple-500/50"
              >
                <Wallet className="w-5 h-5 mr-3" />
                NEURAL_LINK
              </button>
            ) : (
              <div className="flex items-center space-x-4 px-6 py-3 bg-gradient-to-r from-green-900/40 to-emerald-900/40 border-2 border-green-400/50 rounded-xl shadow-lg shadow-green-500/30">
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse shadow-lg shadow-green-400/50"></div>
                <span className="font-mono text-green-300 text-sm tracking-wide">
                  {account.slice(0, 6)}...{account.slice(-4)}
                </span>
                <div className="text-xs text-green-400/70 font-mono">
                  LINKED
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Connection Warning Block */}
        {!isConnected && (
          <div className="mb-8 p-6 bg-gradient-to-r from-yellow-900/30 to-orange-900/30 border-2 border-yellow-400/50 rounded-xl backdrop-blur-xl">
            <div className="flex items-center justify-center space-x-4">
              <WifiOff className="w-8 h-8 text-yellow-400 animate-pulse" />
              <div className="text-center">
                <h3 className="text-xl font-mono text-yellow-300 mb-2">
                  NEURAL LINK REQUIRED
                </h3>
                <p className="text-yellow-400/80 font-mono text-sm">
                  &gt; Connect your MetaMask wallet to access the Fusion Grid
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Enhanced Tab Navigation */}
        <div className="mb-8">
          <div className="flex space-x-2 border-b border-purple-400/30 justify-center">
            <button
              onClick={() => setActiveTab("create")}
              className={`px-6 py-4 font-mono text-sm transition-all duration-300 border-b-2 ${
                activeTab === "create"
                  ? "text-cyan-300 border-cyan-400 bg-cyan-400/10 shadow-lg shadow-cyan-400/20"
                  : "text-gray-400 border-transparent hover:text-gray-300 hover:border-gray-600"
              }`}
            >
              <div className="flex items-center space-x-2">
                <Target className="w-4 h-4" />
                <span>CREATE_FUSION</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab("orders")}
              className={`px-6 py-4 font-mono text-sm transition-all duration-300 border-b-2 ${
                activeTab === "orders"
                  ? "text-purple-300 border-purple-400 bg-purple-400/10 shadow-lg shadow-purple-400/20"
                  : "text-gray-400 border-transparent hover:text-gray-300 hover:border-gray-600"
              }`}
            >
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4" />
                <span>ORDERS</span>
                <span className="text-xs bg-purple-900/50 px-2 py-1 rounded-full">
                  {intents.length}
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "create" && (
          <div className="w-3/5 mx-auto bg-black/90 backdrop-blur-xl border-2 border-purple-400/40 rounded-2xl p-8 shadow-2xl shadow-purple-500/20 relative">
            <div className="flex items-center mb-8">
              <Target className="w-6 h-6 text-purple-400 mr-4" />
              <h2 className="text-2xl font-mono text-purple-300 tracking-wide">
                FUSION_ORDER_MATRIX
              </h2>
            </div>

            {/* Disconnect Overlay */}
            {!isConnected && (
              <div className="absolute inset-0 bg-black/95 backdrop-blur-xl rounded-2xl flex items-center justify-center z-10">
                <div className="text-center p-8">
                  <div className="mb-6">
                    <WifiOff className="w-16 h-16 text-yellow-400 mx-auto animate-pulse" />
                  </div>
                  <h3 className="text-2xl font-mono text-yellow-300 mb-4 tracking-wide">
                    NEURAL_LINK_REQUIRED
                  </h3>
                  <p className="text-yellow-400/80 font-mono text-sm mb-8 max-w-md mx-auto leading-relaxed">
                    &gt; Connect your brain wallet to access the Fusion Order
                    Matrix
                  </p>
                  <button
                    onClick={connectWallet}
                    className="flex items-center px-8 py-4 bg-gradient-to-r from-yellow-600/30 to-orange-600/30 border-2 border-yellow-400/50 rounded-xl hover:border-yellow-400/80 transition-all duration-300 font-mono text-yellow-200 hover:text-white transform hover:scale-105 shadow-lg hover:shadow-yellow-500/50 mx-auto"
                  >
                    <Wallet className="w-5 h-5 mr-3" />
                    ESTABLISH_NEURAL_LINK
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Chain Selection */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-mono text-cyan-300 mb-3 tracking-wide">
                    SOURCE_CHAIN
                  </label>
                  <CyberpunkDropdown
                    value={formData.chainIn}
                    onChange={(value) =>
                      setFormData({
                        ...formData,
                        chainIn: parseInt(value.toString()),
                      })
                    }
                    options={[
                      { value: 1, label: "ETHEREUM_MAINNET" },
                      { value: 1000, label: "APTOS_NETWORK" },
                    ]}
                    placeholder="SELECT_CHAIN"
                  />
                </div>
                <div>
                  <label className="block text-sm font-mono text-cyan-300 mb-3 tracking-wide">
                    DEST_CHAIN
                  </label>
                  <CyberpunkDropdown
                    value={formData.chainOut}
                    onChange={(value) =>
                      setFormData({
                        ...formData,
                        chainOut: parseInt(value.toString()),
                      })
                    }
                    options={[
                      { value: 1, label: "ETHEREUM_MAINNET" },
                      { value: 1000, label: "APTOS_NETWORK" },
                    ]}
                    placeholder="SELECT_CHAIN"
                  />
                </div>
              </div>

              {/* Token Selection */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-mono text-cyan-300 mb-3 tracking-wide">
                    SELL_TOKEN
                  </label>
                  <CyberpunkDropdown
                    value={formData.sellToken}
                    onChange={(value) =>
                      setFormData({ ...formData, sellToken: value.toString() })
                    }
                    options={[
                      { value: "", label: "SELECT_TOKEN" },
                      ...availableTokens
                        .filter((token) => token.chainId === formData.chainIn)
                        .map((token) => ({
                          value: token.address,
                          label: token.symbol,
                        })),
                    ]}
                    placeholder="SELECT_TOKEN"
                  />
                </div>
                <div>
                  <label className="block text-sm font-mono text-cyan-300 mb-3 tracking-wide">
                    BUY_TOKEN
                  </label>
                  <CyberpunkDropdown
                    value={formData.buyToken}
                    onChange={(value) =>
                      setFormData({ ...formData, buyToken: value.toString() })
                    }
                    options={[
                      { value: "", label: "SELECT_TOKEN" },
                      ...availableTokens
                        .filter((token) => token.chainId === formData.chainOut)
                        .map((token) => ({
                          value: token.address,
                          label: token.symbol,
                        })),
                    ]}
                    placeholder="SELECT_TOKEN"
                  />
                </div>
              </div>

              {/* Amount Inputs */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-mono text-cyan-300 mb-3 tracking-wide">
                    SELL_AMOUNT
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    value={formData.sellAmount}
                    onChange={(e) =>
                      setFormData({ ...formData, sellAmount: e.target.value })
                    }
                    className="w-full p-4 bg-gray-900/70 border-2 border-gray-600/50 rounded-xl text-white font-mono text-sm focus:border-cyan-400 focus:shadow-lg focus:shadow-cyan-400/30 transition-all backdrop-blur-sm"
                    placeholder="0.00"
                  />
                  {formData.sellToken && (
                    <div className="text-xs text-cyan-400/70 mt-2 font-mono">
                      ≈ ${getUSDValue(formData.sellAmount, formData.sellToken)}{" "}
                      USD
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-mono text-cyan-300 mb-3 tracking-wide">
                    MIN_BUY_AMOUNT
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    value={formData.minBuyAmount}
                    onChange={(e) =>
                      setFormData({ ...formData, minBuyAmount: e.target.value })
                    }
                    className="w-full p-4 bg-gray-900/70 border-2 border-gray-600/50 rounded-xl text-white font-mono text-sm focus:border-cyan-400 focus:shadow-lg focus:shadow-cyan-400/30 transition-all backdrop-blur-sm"
                    placeholder="0.00"
                  />
                  {formData.buyToken && (
                    <div className="text-xs text-cyan-400/70 mt-2 font-mono">
                      ≈ ${getUSDValue(formData.minBuyAmount, formData.buyToken)}{" "}
                      USD
                    </div>
                  )}
                </div>
              </div>

              {/* Auction Type */}
              <div>
                <label className="block text-sm font-mono text-cyan-300 mb-4 tracking-wide">
                  AUCTION_TYPE
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, auctionType: "fixed" })
                    }
                    className={`p-4 rounded-xl border-2 font-mono text-sm transition-all duration-300 ${
                      formData.auctionType === "fixed"
                        ? "bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-lg shadow-cyan-400/30"
                        : "bg-gray-900/50 border-gray-600/50 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                    }`}
                  >
                    FIXED_PRICE
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, auctionType: "dutch" })
                    }
                    className={`p-4 rounded-xl border-2 font-mono text-sm transition-all duration-300 ${
                      formData.auctionType === "dutch"
                        ? "bg-purple-500/20 border-purple-400 text-purple-300 shadow-lg shadow-purple-400/30"
                        : "bg-gray-900/50 border-gray-600/50 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                    }`}
                  >
                    DUTCH_AUCTION
                  </button>
                </div>
              </div>

              {/* Dutch Auction Parameters */}
              {formData.auctionType === "dutch" && (
                <div className="space-y-6 p-6 bg-purple-900/20 border-2 border-purple-400/30 rounded-xl backdrop-blur-sm">
                  <div className="flex items-center mb-4">
                    <TrendingDown className="w-5 h-5 text-purple-400 mr-3" />
                    <span className="text-sm font-mono text-purple-300 tracking-wide">
                      AUCTION_PARAMETERS
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-mono text-purple-300/80 mb-2">
                        START_PREMIUM_%
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={formData.startPricePremium}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            startPricePremium: e.target.value,
                          })
                        }
                        className="w-full p-3 bg-gray-900/70 border border-purple-400/30 rounded-lg text-white font-mono text-sm focus:border-purple-400 focus:shadow-lg focus:shadow-purple-400/20 transition-all"
                        placeholder="10"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-mono text-purple-300/80 mb-2">
                        MIN_DISCOUNT_%
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={formData.minPriceDiscount}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            minPriceDiscount: e.target.value,
                          })
                        }
                        className="w-full p-3 bg-gray-900/70 border border-purple-400/30 rounded-lg text-white font-mono text-sm focus:border-purple-400 focus:shadow-lg focus:shadow-purple-400/20 transition-all"
                        placeholder="5"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-mono text-purple-300/80 mb-2">
                        DECAY_RATE_0-1
                      </label>
                      <input
                        type="number"
                        step="0.001"
                        value={formData.decayRate}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            decayRate: e.target.value,
                          })
                        }
                        className="w-full p-3 bg-gray-900/70 border border-purple-400/30 rounded-lg text-white font-mono text-sm focus:border-purple-400 focus:shadow-lg focus:shadow-purple-400/20 transition-all"
                        placeholder="0.02"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-mono text-purple-300/80 mb-2">
                        DURATION_SECONDS
                      </label>
                      <input
                        type="number"
                        value={formData.decayPeriod}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            decayPeriod: e.target.value,
                          })
                        }
                        className="w-full p-3 bg-gray-900/70 border border-purple-400/30 rounded-lg text-white font-mono text-sm focus:border-purple-400 focus:shadow-lg focus:shadow-purple-400/20 transition-all"
                        placeholder="3600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    <div>
                      <label className="block text-xs font-mono text-purple-300/80 mb-2">
                        START_DELAY_SECONDS
                      </label>
                      <input
                        type="number"
                        value={formData.auctionStartDelay || "0"}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            auctionStartDelay: e.target.value,
                          })
                        }
                        className="w-full p-3 bg-gray-900/70 border border-purple-400/30 rounded-lg text-white font-mono text-sm focus:border-purple-400 focus:shadow-lg focus:shadow-purple-400/20 transition-all"
                        placeholder="0"
                      />
                      <div className="text-xs text-purple-400/70 mt-1">
                        Delay before auction starts (0 = start immediately)
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Deadline */}
              <div>
                <label className="block text-sm font-mono text-cyan-300 mb-3 tracking-wide">
                  DEADLINE_HOURS
                </label>
                <input
                  type="number"
                  min="1"
                  max="168"
                  value={formData.deadline}
                  onChange={(e) =>
                    setFormData({ ...formData, deadline: e.target.value })
                  }
                  className="w-full p-4 bg-gray-900/70 border-2 border-gray-600/50 rounded-xl text-white font-mono text-sm focus:border-cyan-400 focus:shadow-lg focus:shadow-cyan-400/30 transition-all backdrop-blur-sm"
                />
              </div>

              {/* Destination Address for Cross-Chain Swaps */}
              {formData.chainOut !== formData.chainIn && (
                <div>
                  <label className="block text-sm font-mono text-orange-300 mb-3 tracking-wide">
                    DESTINATION_ADDRESS
                    <span className="text-xs text-orange-400/70 ml-2">
                      (Your address on{" "}
                      {formData.chainOut === 1000
                        ? "Aptos"
                        : "destination chain"}
                      )
                    </span>
                  </label>
                  <input
                    type="text"
                    value={formData.destinationAddress || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        destinationAddress: e.target.value,
                      })
                    }
                    className="w-full p-4 bg-gray-900/70 border-2 border-orange-400/50 rounded-xl text-white font-mono text-sm focus:border-orange-400 focus:shadow-lg focus:shadow-orange-400/30 transition-all backdrop-blur-sm"
                    placeholder={
                      formData.chainOut === 1000
                        ? "0x44689d8f78944f57e1d84bfa1d9f4042d20d7e22c3ec0fe93a05b8035c7712c1"
                        : "Your destination address"
                    }
                  />
                  <div className="text-xs text-orange-400/70 mt-2 font-mono">
                    {formData.chainOut === 1000
                      ? "Provide your Aptos address (64-character hex string starting with 0x)"
                      : "Provide your address on the destination chain where you want to receive tokens"}
                  </div>
                </div>
              )}

              {/* Enhanced Allowance Status Display */}
              {formData.sellToken && formData.sellAmount && isConnected && (
                <div className="space-y-3">
                  {/* Allowance Status Header */}
                  <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-400/30 rounded-xl backdrop-blur-sm">
                    <div className="flex items-center">
                      <Wallet className="w-5 h-5 text-blue-400 mr-3" />
                      <span className="font-mono text-blue-300 text-sm">
                        TOKEN_ALLOWANCE_STATUS
                      </span>
                    </div>
                    <div
                      className={`px-3 py-1 rounded-lg font-mono text-xs ${
                        allowanceState.hasEnoughAllowance
                          ? "bg-green-500/20 text-green-400 border border-green-500/30"
                          : "bg-red-500/20 text-red-400 border border-red-500/30"
                      }`}
                    >
                      {allowanceState.hasEnoughAllowance
                        ? "APPROVED"
                        : "NEEDS_APPROVAL"}
                    </div>
                  </div>

                  {/* Allowance Details */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Current Allowance */}
                    <div className="p-3 bg-cyan-900/10 border border-cyan-400/20 rounded-lg">
                      <div className="text-xs font-mono text-cyan-400 mb-1">
                        CURRENT_ALLOWANCE
                      </div>
                      <div className="font-mono text-cyan-300 text-sm">
                        {(() => {
                          const sellTokenInfo = getTokenInfoForChain(
                            formData.sellToken,
                            formData.chainIn
                          );
                          return sellTokenInfo
                            ? ethers.formatUnits(
                                allowanceState.currentAllowance,
                                sellTokenInfo.decimals
                              ) +
                                " " +
                                sellTokenInfo.symbol
                            : ethers.formatEther(
                                allowanceState.currentAllowance
                              ) + " ETH";
                        })()}
                      </div>
                    </div>

                    {/* Required Amount */}
                    <div className="p-3 bg-purple-900/10 border border-purple-400/20 rounded-lg">
                      <div className="text-xs font-mono text-purple-400 mb-1">
                        REQUIRED_AMOUNT
                      </div>
                      <div className="font-mono text-purple-300 text-sm">
                        {(() => {
                          const sellTokenInfo = getTokenInfoForChain(
                            formData.sellToken,
                            formData.chainIn
                          );
                          return sellTokenInfo
                            ? ethers.formatUnits(
                                allowanceState.requiredAmount,
                                sellTokenInfo.decimals
                              ) +
                                " " +
                                sellTokenInfo.symbol
                            : ethers.formatEther(
                                allowanceState.requiredAmount
                              ) + " ETH";
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-gray-400">APPROVAL_PROGRESS</span>
                      <span
                        className={`${
                          allowanceState.hasEnoughAllowance
                            ? "text-green-400"
                            : "text-orange-400"
                        }`}
                      >
                        {allowanceState.hasEnoughAllowance
                          ? "100%"
                          : Math.min(
                              100,
                              Number(
                                (allowanceState.currentAllowance *
                                  BigInt(100)) /
                                  (allowanceState.requiredAmount || BigInt(1))
                              )
                            ).toFixed(0)}
                        %
                      </span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${
                          allowanceState.hasEnoughAllowance
                            ? "bg-gradient-to-r from-green-500 to-emerald-400"
                            : "bg-gradient-to-r from-orange-500 to-red-400"
                        }`}
                        style={{
                          width: `${
                            allowanceState.hasEnoughAllowance
                              ? 100
                              : Math.min(
                                  100,
                                  Number(
                                    (allowanceState.currentAllowance *
                                      BigInt(100)) /
                                      (allowanceState.requiredAmount ||
                                        BigInt(1))
                                  )
                                )
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Quick Action for Sufficient Allowance */}
                  {allowanceState.hasEnoughAllowance &&
                    currentStep === FlowStep.FORM && (
                      <div className="p-4 bg-gradient-to-r from-green-900/30 to-emerald-900/30 border-2 border-green-400/50 rounded-xl shadow-lg shadow-green-400/20">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <CheckCircle className="w-5 h-5 text-green-400 mr-3" />
                            <div>
                              <div className="font-mono text-green-300 text-sm">
                                ALLOWANCE_APPROVED
                              </div>
                              <div className="font-mono text-green-400/70 text-xs">
                                Ready for immediate execution
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={executeIntent}
                            className="px-6 py-2 bg-green-500/20 border border-green-400/50 rounded-lg hover:border-green-400/80 transition-all font-mono text-green-300 hover:text-green-200 flex items-center transform hover:scale-105"
                          >
                            <Zap className="w-4 h-4 mr-2" />
                            EXECUTE_NOW
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              )}

              {/* Flow Control Buttons */}
              <div className="space-y-4">
                {currentStep === FlowStep.FORM && (
                  <button
                    type="submit"
                    disabled={!isConnected || loading}
                    className={`w-full p-5 border-2 rounded-xl transition-all duration-300 font-mono disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transform hover:scale-105 shadow-lg ${
                      allowanceState.hasEnoughAllowance
                        ? "bg-gradient-to-r from-green-600/30 to-emerald-600/30 border-green-400/50 hover:border-green-400/80 text-green-200 hover:text-white hover:shadow-green-500/50"
                        : "bg-gradient-to-r from-purple-600/30 to-cyan-600/30 border-purple-400/50 hover:border-purple-400/80 text-purple-200 hover:text-white hover:shadow-purple-500/50"
                    }`}
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                    ) : (
                      <Zap className="w-5 h-5 mr-3" />
                    )}
                    {loading
                      ? "PROCESSING..."
                      : allowanceState.hasEnoughAllowance
                      ? "EXECUTE_FUSION"
                      : "INITIALIZE_FUSION"}
                  </button>
                )}

                {currentStep === FlowStep.CHECKING_ALLOWANCE && (
                  <div className="w-full p-5 bg-yellow-900/30 border-2 border-yellow-400/50 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-400/20">
                    <Loader2 className="w-5 h-5 mr-3 animate-spin text-yellow-400" />
                    <span className="font-mono text-yellow-300">
                      CHECKING_ALLOWANCE...
                    </span>
                  </div>
                )}

                {currentStep === FlowStep.NEEDS_APPROVAL && (
                  <button
                    type="button"
                    onClick={handleApproval}
                    className="w-full p-5 bg-yellow-900/30 border-2 border-yellow-400/50 rounded-xl hover:border-yellow-400/80 transition-all duration-300 font-mono text-yellow-300 hover:text-yellow-200 flex items-center justify-center transform hover:scale-105 shadow-lg hover:shadow-yellow-400/50"
                  >
                    <CheckCircle className="w-5 h-5 mr-3" />
                    APPROVE_TOKEN
                  </button>
                )}

                {currentStep === FlowStep.APPROVING && (
                  <div className="w-full p-5 bg-yellow-900/30 border-2 border-yellow-400/50 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-400/20">
                    <Loader2 className="w-5 h-5 mr-3 animate-spin text-yellow-400" />
                    <span className="font-mono text-yellow-300">
                      APPROVING_TOKEN...
                    </span>
                  </div>
                )}

                {currentStep === FlowStep.READY_TO_SIGN &&
                  !allowanceState.hasEnoughAllowance && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          if (typeof window.ethereum === "undefined") {
                            console.error("MetaMask not installed");
                            return;
                          }
                          const provider = new ethers.BrowserProvider(
                            window.ethereum
                          );
                          const signer = await provider.getSigner();
                          await flowManager.approveToken(
                            formData.sellToken,
                            formData.sellAmount,
                            signer
                          );
                        } catch (error) {
                          console.error("Approval failed:", error);
                        }
                      }}
                      className="w-full p-5 bg-yellow-900/30 border-2 border-yellow-400/50 rounded-xl hover:border-yellow-400/80 transition-all duration-300 font-mono text-yellow-300 hover:text-yellow-200 flex items-center justify-center transform hover:scale-105 shadow-lg hover:shadow-yellow-400/50"
                    >
                      <CheckCircle className="w-5 h-5 mr-3" />
                      APPROVE_TOKEN
                    </button>
                  )}

                {currentStep === FlowStep.READY_TO_SIGN &&
                  allowanceState.hasEnoughAllowance && (
                    <button
                      type="button"
                      onClick={executeIntent}
                      className="w-full p-5 bg-green-900/30 border-2 border-green-400/50 rounded-xl hover:border-green-400/80 transition-all duration-300 font-mono text-green-300 hover:text-green-200 flex items-center justify-center transform hover:scale-105 shadow-lg hover:shadow-green-400/50"
                    >
                      <Zap className="w-5 h-5 mr-3" />
                      EXECUTE_FUSION_ORDER
                    </button>
                  )}

                {currentStep === FlowStep.SIGNING && (
                  <div className="w-full p-5 bg-green-900/30 border-2 border-green-400/50 rounded-xl flex items-center justify-center shadow-lg shadow-green-400/20">
                    <Loader2 className="w-5 h-5 mr-3 animate-spin text-green-400" />
                    <span className="font-mono text-green-300">
                      BROADCASTING_ORDER...
                    </span>
                  </div>
                )}
              </div>

              {/* Approval Transaction Hash */}
              {approvalTxHash && (
                <div className="p-4 bg-blue-900/30 border-2 border-blue-400/50 rounded-xl shadow-lg shadow-blue-400/20">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-blue-300">
                      APPROVAL_TX:
                    </span>
                    <a
                      href={`https://etherscan.io/tx/${approvalTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-blue-400 hover:text-blue-300 flex items-center transition-colors"
                    >
                      {approvalTxHash.slice(0, 10)}...
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </div>
                </div>
              )}
            </form>
          </div>
        )}

        {activeTab === "orders" && (
          <div className="w-3/5 mx-auto bg-black/90 backdrop-blur-xl border-2 border-cyan-400/40 rounded-2xl p-8 shadow-2xl shadow-cyan-500/20">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <Activity className="w-6 h-6 text-cyan-400 mr-4" />
                <h2 className="text-2xl font-mono text-cyan-300 tracking-wide">
                  ORDERS_MATRIX
                </h2>
              </div>
              <div className="text-sm font-mono text-cyan-400 bg-cyan-400/10 px-4 py-2 rounded-xl border border-cyan-400/30">
                {getFilteredIntents().length} / {intents.length} TOTAL
              </div>
            </div>

            {/* Filter Buttons */}
            <div className="mb-6">
              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  onClick={() => setOrderFilter("active")}
                  className={`px-4 py-2 font-mono text-sm transition-all duration-300 border rounded-lg ${
                    orderFilter === "active"
                      ? "bg-green-500/20 border-green-400 text-green-300 shadow-lg shadow-green-400/30"
                      : "bg-gray-900/50 border-gray-600/50 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                  }`}
                >
                  ACTIVE
                </button>
                <button
                  onClick={() => setOrderFilter("filled")}
                  className={`px-4 py-2 font-mono text-sm transition-all duration-300 border rounded-lg ${
                    orderFilter === "filled"
                      ? "bg-blue-500/20 border-blue-400 text-blue-300 shadow-lg shadow-blue-400/30"
                      : "bg-gray-900/50 border-gray-600/50 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                  }`}
                >
                  FILLED
                </button>
                <button
                  onClick={() => setOrderFilter("expired")}
                  className={`px-4 py-2 font-mono text-sm transition-all duration-300 border rounded-lg ${
                    orderFilter === "expired"
                      ? "bg-orange-500/20 border-orange-400 text-orange-300 shadow-lg shadow-orange-400/30"
                      : "bg-gray-900/50 border-gray-600/50 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                  }`}
                >
                  EXPIRED
                </button>
                <button
                  onClick={() => setOrderFilter("cancelled")}
                  className={`px-4 py-2 font-mono text-sm transition-all duration-300 border rounded-lg ${
                    orderFilter === "cancelled"
                      ? "bg-red-500/20 border-red-400 text-red-300 shadow-lg shadow-red-400/30"
                      : "bg-gray-900/50 border-gray-600/50 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                  }`}
                >
                  CANCELLED
                </button>
                <button
                  onClick={() => setOrderFilter("all")}
                  className={`px-4 py-2 font-mono text-sm transition-all duration-300 border rounded-lg ${
                    orderFilter === "all"
                      ? "bg-purple-500/20 border-purple-400 text-purple-300 shadow-lg shadow-purple-400/30"
                      : "bg-gray-900/50 border-gray-600/50 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                  }`}
                >
                  ALL
                </button>
              </div>
            </div>

            <div className="space-y-6 h-full overflow-y-auto">
              {loadingStates.intents ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                  <span className="ml-4 font-mono text-cyan-300 text-lg">
                    LOADING_ORDERS...
                  </span>
                </div>
              ) : getFilteredIntents().length === 0 ? (
                <div className="text-center py-12">
                  <Target className="w-16 h-16 mx-auto mb-4 text-gray-500" />
                  <p className="text-gray-500 font-mono text-lg">
                    {intents.length === 0
                      ? "NO_ORDERS"
                      : `NO_${orderFilter.toUpperCase()}_ORDERS`}
                  </p>
                  <p className="text-gray-600 font-mono text-sm mt-2">
                    {intents.length === 0
                      ? "&gt; Create your first fusion order to begin"
                      : `&gt; No orders found with ${orderFilter} status`}
                  </p>
                </div>
              ) : (
                getFilteredIntents().map((intent) => {
                  // Handle both new FusionPlusIntent structure and legacy format
                  const intentWithLegacy = intent as FusionPlusIntent & {
                    sellToken?: string;
                    buyToken?: string;
                    sellAmount?: string;
                    buyAmount?: string;
                    chainIn?: number;
                    chainOut?: number;
                    auctionType?: string;
                    userAddress?: string;
                    amountIn?: string;
                    minAmountOut?: string;
                  };
                  const fusionOrder = intent.fusionOrder;

                  const sellTokenInfo = getTokenInfoForChain(
                    fusionOrder?.makerAsset || intentWithLegacy.sellToken || "",
                    fusionOrder?.srcChain || intentWithLegacy.chainIn || 1
                  );
                  const buyTokenInfo = getTokenInfoForChain(
                    fusionOrder?.takerAsset || intentWithLegacy.buyToken || "",
                    fusionOrder?.dstChain || intentWithLegacy.chainOut || 1
                  );

                  const isDutchAuction =
                    fusionOrder?.startRate !== "0" ||
                    intentWithLegacy.auctionType === "dutch";
                  const isUserIntent =
                    isConnected &&
                    (
                      fusionOrder?.maker || intentWithLegacy.userAddress
                    )?.toLowerCase() === account.toLowerCase();

                  return (
                    <div
                      key={intent.id}
                      className={`p-6 rounded-xl border-2 transition-all duration-300 backdrop-blur-sm ${
                        isUserIntent
                          ? "bg-purple-900/30 border-purple-400/50 shadow-lg shadow-purple-400/20"
                          : "bg-gray-900/40 border-gray-600/50 hover:border-gray-500/50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              intent.status === "pending"
                                ? "bg-green-400 animate-pulse shadow-lg shadow-green-400/50"
                                : intent.status === "filled"
                                ? "bg-blue-400 shadow-lg shadow-blue-400/50"
                                : "bg-red-400 shadow-lg shadow-red-400/50"
                            }`}
                          ></div>
                          <span className="text-sm font-mono text-gray-300">
                            {intent.id.slice(0, 8)}...
                          </span>
                          {isDutchAuction && (
                            <span className="text-xs font-mono text-purple-300 bg-purple-900/50 px-3 py-1 rounded-full border border-purple-400/30">
                              DUTCH
                            </span>
                          )}
                        </div>
                        {isUserIntent && intent.status === "pending" && (
                          <button
                            onClick={() =>
                              cancelIntent(intent.id, intent.nonce)
                            }
                            className="text-sm font-mono text-red-400 hover:text-red-300 transition-colors p-2 hover:bg-red-400/10 rounded-lg"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center space-x-4 mb-4">
                        <div className="text-lg">
                          <span className="text-cyan-400 font-mono font-bold">
                            {sellTokenInfo?.symbol || "UNKNOWN"}
                          </span>
                          <span className="text-gray-400 mx-3">→</span>
                          <span className="text-purple-400 font-mono font-bold">
                            {buyTokenInfo?.symbol || "UNKNOWN"}
                          </span>
                        </div>
                      </div>

                      <div className="text-sm font-mono text-gray-300 space-y-2">
                        <div className="flex justify-between">
                          <span className="text-gray-400">MAKING:</span>
                          <span>
                            {sellTokenInfo
                              ? formatBalance(
                                  fusionOrder?.makingAmount ||
                                    intentWithLegacy.amountIn ||
                                    "0",
                                  sellTokenInfo.decimals
                                )
                              : "N/A"}{" "}
                            {sellTokenInfo?.symbol}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">TAKING:</span>
                          <span>
                            {buyTokenInfo
                              ? formatBalance(
                                  fusionOrder?.takingAmount ||
                                    intentWithLegacy.minAmountOut ||
                                    "0",
                                  buyTokenInfo.decimals
                                )
                              : "N/A"}{" "}
                            {buyTokenInfo?.symbol}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">CHAINS:</span>
                          <span>
                            {fusionOrder?.srcChain || intentWithLegacy.chainIn}{" "}
                            →{" "}
                            {fusionOrder?.dstChain || intentWithLegacy.chainOut}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">STATUS:</span>
                          <span
                            className={`capitalize ${
                              intent.status === "pending"
                                ? "text-green-400"
                                : intent.status === "filled"
                                ? "text-blue-400"
                                : "text-red-400"
                            }`}
                          >
                            {intent.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
