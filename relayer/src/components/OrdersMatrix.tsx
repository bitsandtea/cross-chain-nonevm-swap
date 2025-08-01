import { OrderFilter, useIntents } from "@/hooks";
import { getAllTokens, TokenMapping } from "@/lib/tokenMapping";
import { Activity, Loader2, Target } from "lucide-react";
import { OrderCard } from "./OrderCard";

export interface OrdersMatrixProps {
  account: string;
  filter: OrderFilter;
  onCancel: (intentId: string, nonce: number) => void;
}

export function OrdersMatrix({ account, filter, onCancel }: OrdersMatrixProps) {
  const { intents, loading, orderFilter, setOrderFilter, getFilteredIntents } =
    useIntents();

  const availableTokens = getAllTokens().map((token: TokenMapping) => ({
    ...token,
    address: token.localAddress,
    chainId: token.localAddress.includes("::") ? 1000 : 1, // Aptos vs Ethereum
  }));

  const filteredIntents = getFilteredIntents();

  return (
    <div className="w-3/5 mx-auto bg-black/90 backdrop-blur-xl border-2 border-cyan-400/40 rounded-2xl p-8 shadow-2xl shadow-cyan-500/20">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Activity className="w-6 h-6 text-cyan-400 mr-4" />
          <h2 className="text-2xl font-mono text-cyan-300 tracking-wide">
            ORDERS_MATRIX
          </h2>
        </div>
        <div className="text-sm font-mono text-cyan-400 bg-cyan-400/10 px-4 py-2 rounded-xl border border-cyan-400/30">
          {filteredIntents.length} / {intents.length} TOTAL
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
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            <span className="ml-4 font-mono text-cyan-300 text-lg">
              LOADING_ORDERS...
            </span>
          </div>
        ) : filteredIntents.length === 0 ? (
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
          filteredIntents.map((intent) => {
            // Handle both new FusionPlusIntent structure and legacy format
            const intentWithLegacy = intent as any & {
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
            const order = intent.order;

            const isUserIntent =
              (account &&
                (
                  order?.maker || intentWithLegacy.userAddress
                )?.toLowerCase() === account.toLowerCase()) ||
              false;

            return (
              <OrderCard
                key={intent.id}
                intent={intent}
                isUserIntent={isUserIntent}
                onCancel={(intentId: string) => onCancel(intentId, 0)} // Pass dummy nonce
              />
            );
          })
        )}
      </div>
    </div>
  );
}
