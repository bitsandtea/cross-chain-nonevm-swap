import { CountdownTimer } from "@/components/ui";
import { getAllTokens, TokenMapping } from "@/lib/tokenMapping";
import { FusionPlusIntent } from "@/lib/types";
import { ethers } from "ethers";
import { X } from "lucide-react";

interface OrderCardProps {
  intent: FusionPlusIntent;
  isUserIntent: boolean;
  onCancel: (intentId: string) => void;
}

export function OrderCard({ intent, isUserIntent, onCancel }: OrderCardProps) {
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
  // Access order data from the new structure
  const order = intent.order;

  const availableTokens = getAllTokens().map((token: TokenMapping) => ({
    ...token,
    address: token.localAddress,
    chainId: token.localAddress.includes("::") ? 1000 : 1, // Aptos vs Ethereum
  }));

  // Get token info helper
  const getTokenInfoForChain = (address: string, chainId: number) => {
    // First try exact match
    let token = availableTokens.find(
      (token) =>
        token.address.toLowerCase() === address.toLowerCase() &&
        token.chainId === chainId
    );

    // If not found, try to match by address only (ignore chainId)
    if (!token) {
      token = availableTokens.find(
        (token) => token.address.toLowerCase() === address.toLowerCase()
      );
    }

    // If still not found, try to find any token for the given chain
    if (!token) {
      if (chainId === 1000) {
        // Look for any Aptos token
        token = availableTokens.find((t) => t.localAddress.includes("::"));
      } else {
        // Look for any EVM token
        token = availableTokens.find((t) => !t.localAddress.includes("::"));
      }
    }

    return token;
  };

  // Format balance for display
  const formatBalance = (balance: string, decimals: number): string => {
    try {
      // Ensure balance is treated as a BigInt string
      const balanceBigInt = BigInt(balance);
      const formatted = ethers.formatUnits(balanceBigInt, decimals);
      const num = parseFloat(formatted);

      // Better formatting for different magnitudes
      if (num === 0) return "0";
      if (num < 0.0001) return num.toExponential(2);
      if (num < 1) return num.toFixed(6);
      if (num < 1000) return num.toFixed(4);
      return num.toFixed(2);
    } catch {
      return "0";
    }
  };

  // Determine chain IDs based on address format
  const getChainIdFromAddress = (address: string): number => {
    if (address.includes("::")) return 1000; // Aptos format

    // Check if address exists in our token mapping
    const token = availableTokens.find(
      (t) => t.localAddress.toLowerCase() === address.toLowerCase()
    );

    if (token) {
      return token.localAddress.includes("::") ? 1000 : 1;
    }

    return 1; // Default to Ethereum
  };

  const sellTokenInfo = getTokenInfoForChain(
    order?.makerAsset || intentWithLegacy.sellToken || "",
    getChainIdFromAddress(order?.makerAsset || "")
  );
  const buyTokenInfo = getTokenInfoForChain(
    order?.takerAsset || intentWithLegacy.buyToken || "",
    getChainIdFromAddress(order?.takerAsset || "")
  );

  const isDutchAuction =
    intent.startRate !== "1.0" || intentWithLegacy.auctionType === "dutch";

  return (
    <div
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
            onClick={() => onCancel(intent.id)}
            className="text-sm font-mono text-red-400 hover:text-red-300 transition-colors p-2 hover:bg-red-400/10 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex items-center space-x-4 mb-4">
        <div className="text-lg">
          <span className="text-cyan-400 font-mono font-bold">
            {sellTokenInfo
              ? `${sellTokenInfo.symbol} (${
                  sellTokenInfo.localAddress.includes("::") ? "Aptos" : "EVM"
                })`
              : "UNKNOWN"}
          </span>
          <span className="text-gray-400 mx-3">→</span>
          <span className="text-purple-400 font-mono font-bold">
            {buyTokenInfo
              ? `${buyTokenInfo.symbol} (${
                  buyTokenInfo.localAddress.includes("::") ? "Aptos" : "EVM"
                })`
              : "UNKNOWN"}
          </span>
        </div>
      </div>

      <div className="text-sm font-mono text-gray-300 space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-400">MAKING:</span>
          <span>
            {sellTokenInfo
              ? formatBalance(
                  order?.makingAmount || intentWithLegacy.amountIn || "0",
                  sellTokenInfo.decimals
                )
              : "N/A"}{" "}
            {sellTokenInfo
              ? `${sellTokenInfo.symbol} (${
                  sellTokenInfo.localAddress.includes("::") ? "Aptos" : "EVM"
                })`
              : ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">TAKING:</span>
          <span>
            {buyTokenInfo
              ? formatBalance(
                  order?.takingAmount || intentWithLegacy.minAmountOut || "0",
                  buyTokenInfo.decimals
                )
              : "N/A"}{" "}
            {buyTokenInfo
              ? `${buyTokenInfo.symbol} (${
                  buyTokenInfo.localAddress.includes("::") ? "Aptos" : "EVM"
                })`
              : ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">CHAINS:</span>
          <span>
            {getChainIdFromAddress(order?.makerAsset || "") === 1000
              ? "Aptos"
              : "EVM"}{" "}
            →{" "}
            {getChainIdFromAddress(order?.takerAsset || "") === 1000
              ? "Aptos"
              : "EVM"}
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
        {intent.expiration ? (
          <div className="flex justify-between items-center">
            <span className="text-gray-400">EXPIRES:</span>
            <CountdownTimer
              expiration={parseInt(intent.expiration.toString())}
              className="ml-2"
            />
          </div>
        ) : (
          <div className="flex justify-between items-center">
            <span className="text-gray-400">EXPIRES:</span>
            <span className="text-gray-500 font-mono text-sm">UNKNOWN</span>
          </div>
        )}
      </div>
    </div>
  );
}
