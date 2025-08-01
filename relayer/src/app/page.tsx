"use client";

import { Activity, Target, Wallet, WifiOff } from "lucide-react";
import { useState } from "react";

import { CreateOrderForm, OrdersMatrix } from "@/components";
import { ToastProvider } from "@/components/ui";
import { useIntents, useMetaMask } from "@/hooks";
// Recovery scheduler is server-side only - remove client-side import
import { getAllTokens, TokenMapping } from "@/lib/tokenMapping";

export default function Home() {
  const { account, isConnected, connectWallet } = useMetaMask();
  const [activeTab, setActiveTab] = useState<"create" | "orders">("create");
  const [orderFilter, setOrderFilter] = useState<
    "active" | "expired" | "filled" | "cancelled" | "all"
  >("active");
  const { cancelIntent } = useIntents();
  // Recovery stats removed - server-side only functionality

  // Available tokens with chain information
  const availableTokens = getAllTokens().map((token: TokenMapping) => ({
    ...token,
    address: token.localAddress,
    chainId: token.localAddress.includes("::") ? 1000 : 1, // Aptos vs Ethereum
  }));

  const handleOrderCreated = (orderId: string) => {
    setActiveTab("orders");
    // Refresh orders list
  };

  // Recovery stats loading removed - server-side only functionality

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
      <ToastProvider />

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

          {/* Recovery Stats - Server-side only */}

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
              </div>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "create" ? (
          <CreateOrderForm
            account={account}
            availableTokens={availableTokens}
            onOrderCreated={handleOrderCreated}
          />
        ) : (
          <OrdersMatrix
            account={account}
            filter={orderFilter}
            onCancel={cancelIntent}
          />
        )}
      </div>
    </div>
  );
}
