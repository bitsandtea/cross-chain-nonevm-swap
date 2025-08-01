"use client";

import { ethers } from "ethers";
import {
  CheckCircle,
  ExternalLink,
  Loader2,
  Target,
  TrendingDown,
  Wallet,
  WifiOff,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";

import { CyberpunkDropdown } from "@/components/ui";
import { useAllowance, useBalances, usePrices } from "@/hooks";
import { generateSecret } from "@/lib/crypto";
import {
  getDefaultFormData,
  IntentFlowManager,
  validateFormData,
} from "@/lib/OrderUtils";
import { TokenMapping } from "@/lib/tokenMapping";
import { FlowStep, FormData } from "@/types/flow";

export interface CreateOrderFormProps {
  account: string;
  availableTokens: TokenMapping[];
  onOrderCreated: (orderId: string) => void;
}

export function CreateOrderForm({
  account,
  availableTokens,
  onOrderCreated,
}: CreateOrderFormProps) {
  const [formData, setFormData] = useState<FormData>(getDefaultFormData());
  const { allowanceState, approvalTxHash, loading, currentStep, approveToken } =
    useAllowance(account, formData.sellToken, formData.sellAmount);
  const { userBalances, loading: balancesLoading } = useBalances(
    account,
    formData
  );
  const { tokenPrices } = usePrices();

  // Flow manager instance
  const flowManager = new IntentFlowManager(
    () => {}, // setCurrentStep - handled by useAllowance
    () => {}, // setAllowanceState - handled by useAllowance
    () => {}, // setApprovalTxHash - handled by useAllowance
    () => {} // setLoading - handled by useAllowance
  );

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form data
    const validation = validateFormData(formData);
    if (!validation.valid) {
      toast.error(validation.error || "INVALID FUSION PARAMETERS");
      return;
    }

    // Generate secret if not present (for cross-chain orders)
    let updatedFormData = formData;
    if (formData.chainIn !== formData.chainOut && !formData.secret) {
      console.log("🔐 Generating secret for cross-chain order...");
      const { secret: newSecret, hash } = generateSecret();
      updatedFormData = {
        ...formData,
        secret: newSecret,
        secretHash: hash,
        nonce: BigInt(Date.now()),
        partialFillAllowed: false, // Default to false for now
        multipleFillsAllowed: false, // Default to false for now
      };
      setFormData(updatedFormData);
      console.log("✅ Generated secret for cross-chain order:", {
        secretLength: newSecret.length,
        hashLength: hash.length,
        hash: hash.slice(0, 10) + "...",
      });
    }

    // If allowance is already sufficient, execute directly
    if (allowanceState.hasEnoughAllowance) {
      await executeIntentWithData(updatedFormData);
      return;
    }

    // Check allowance if not already done
    await flowManager.checkAllowance(
      account,
      formData.sellToken,
      formData.sellAmount
    );
  };

  // Execute the intent with updated form data (to avoid race conditions)
  const executeIntentWithData = async (dataToUse: FormData) => {
    try {
      await flowManager.executeFusionOrder(
        account,
        dataToUse,
        () => {}, // loadIntents - handled by parent
        () => {} // loadUserBalances - handled by parent
      );
      onOrderCreated("success"); // You might want to get the actual order ID
    } catch (error) {
      console.error("Failed to execute intent:", error);
      toast.error("FUSION EXECUTION FAILED");
    }
  };

  // Execute the intent with current form data
  const executeIntent = async () => {
    // For cross-chain orders, ensure we have a secret
    let dataToUse = formData;
    if (formData.chainIn !== formData.chainOut && !formData.secret) {
      console.log(
        "🔐 Generating secret for cross-chain order in executeIntent..."
      );
      const { secret: newSecret, hash } = generateSecret();
      dataToUse = {
        ...formData,
        secret: newSecret,
        secretHash: hash,
        nonce: BigInt(Date.now()),
        partialFillAllowed: false,
        multipleFillsAllowed: false,
      };
      setFormData(dataToUse);
    }
    await executeIntentWithData(dataToUse);
  };

  // Handle approval
  const handleApproval = async () => {
    try {
      if (!window.ethereum) {
        throw new Error("MetaMask not found");
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      await approveToken(signer);
    } catch (error) {
      console.error("Approval error:", error);
      toast.error("TOKEN APPROVAL FAILED");
    }
  };

  // Get token info helper
  const getTokenInfoForChain = (address: string, chainId: number) => {
    return availableTokens.find(
      (token) =>
        token.localAddress === address &&
        (token.localAddress.includes("::") ? 1000 : 1) === chainId
    );
  };

  // Format balance for display
  const formatBalance = (balance: string, decimals: number): string => {
    try {
      // Ensure balance is treated as a BigInt string
      const balanceBigInt = BigInt(balance);
      const formatted = parseFloat(ethers.formatUnits(balanceBigInt, decimals));
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

  return (
    <div className="w-3/5 mx-auto bg-black/90 backdrop-blur-xl border-2 border-purple-400/40 rounded-2xl p-8 shadow-2xl shadow-purple-500/20 relative">
      <div className="flex items-center mb-8">
        <Target className="w-6 h-6 text-purple-400 mr-4" />
        <h2 className="text-2xl font-mono text-purple-300 tracking-wide">
          FUSION_ORDER_MATRIX
        </h2>
      </div>

      {/* Disconnect Overlay */}
      {!account && (
        <div className="absolute inset-0 bg-black/95 backdrop-blur-xl rounded-2xl flex items-center justify-center z-10">
          <div className="text-center p-8">
            <div className="mb-6">
              <WifiOff className="w-16 h-16 text-yellow-400 mx-auto animate-pulse" />
            </div>
            <h3 className="text-2xl font-mono text-yellow-300 mb-4 tracking-wide">
              NEURAL_LINK_REQUIRED
            </h3>
            <p className="text-yellow-400/80 font-mono text-sm mb-8 max-w-md mx-auto leading-relaxed">
              &gt; Connect your brain wallet to access the Fusion Order Matrix
            </p>
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
                  .filter(
                    (token) =>
                      (token.localAddress.includes("::") ? 1000 : 1) ===
                      formData.chainIn
                  )
                  .map((token) => ({
                    value: token.localAddress,
                    label: `${token.symbol} (${
                      token.localAddress.includes("::") ? "Aptos" : "EVM"
                    })`,
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
                  .filter(
                    (token) =>
                      (token.localAddress.includes("::") ? 1000 : 1) ===
                      formData.chainOut
                  )
                  .map((token) => ({
                    value: token.localAddress,
                    label: `${token.symbol} (${
                      token.localAddress.includes("::") ? "Aptos" : "EVM"
                    })`,
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
                ≈ ${getUSDValue(formData.sellAmount, formData.sellToken)} USD
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
                ≈ ${getUSDValue(formData.minBuyAmount, formData.buyToken)} USD
              </div>
            )}
          </div>
        </div>

        {/* Dutch Auction Parameters (always shown, fixed price removed) */}
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
                {formData.chainOut === 1000 ? "Aptos" : "destination chain"})
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
        {formData.sellToken && formData.sellAmount && account && (
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
            <div className="grid grid-cols-3 gap-3">
              {/* Current Balance */}
              <div className="p-3 bg-green-900/10 border border-green-400/20 rounded-lg">
                <div className="text-xs font-mono text-green-400 mb-1">
                  CURRENT_BALANCE
                </div>
                <div className="font-mono text-green-300 text-sm">
                  {(() => {
                    const sellTokenInfo = getTokenInfoForChain(
                      formData.sellToken,
                      formData.chainIn
                    );
                    const balance =
                      userBalances[formData.sellToken.toLowerCase()] || "0";
                    return sellTokenInfo
                      ? ethers.formatUnits(balance, sellTokenInfo.decimals) +
                          " " +
                          `${sellTokenInfo.symbol} (${
                            sellTokenInfo.localAddress.includes("::")
                              ? "Aptos"
                              : "EVM"
                          })`
                      : ethers.formatEther(balance) + " ETH";
                  })()}
                </div>
              </div>
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
                          `${sellTokenInfo.symbol} (${
                            sellTokenInfo.localAddress.includes("::")
                              ? "Aptos"
                              : "EVM"
                          })`
                      : ethers.formatEther(allowanceState.currentAllowance) +
                          " ETH";
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
                          `${sellTokenInfo.symbol} (${
                            sellTokenInfo.localAddress.includes("::")
                              ? "Aptos"
                              : "EVM"
                          })`
                      : ethers.formatEther(allowanceState.requiredAmount) +
                          " ETH";
                  })()}
                </div>
              </div>
            </div>

            {/* Balance and Allowance Status */}
            <div className="space-y-3">
              {/* Balance Status */}
              {(() => {
                const sellTokenInfo = getTokenInfoForChain(
                  formData.sellToken,
                  formData.chainIn
                );
                const balance =
                  userBalances[formData.sellToken.toLowerCase()] || "0";
                const hasEnoughBalance =
                  BigInt(balance) >=
                  BigInt(
                    ethers.parseUnits(
                      formData.sellAmount || "0",
                      sellTokenInfo?.decimals || 18
                    )
                  );

                return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-gray-400">BALANCE_STATUS</span>
                      <span
                        className={`${
                          hasEnoughBalance ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {hasEnoughBalance ? "SUFFICIENT" : "INSUFFICIENT"}
                      </span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${
                          hasEnoughBalance
                            ? "bg-gradient-to-r from-green-500 to-emerald-400"
                            : "bg-gradient-to-r from-red-500 to-orange-400"
                        }`}
                        style={{
                          width: `${
                            hasEnoughBalance
                              ? 100
                              : Math.min(
                                  100,
                                  Number(
                                    (BigInt(balance) * BigInt(100)) /
                                      (BigInt(
                                        ethers.parseUnits(
                                          formData.sellAmount || "0",
                                          sellTokenInfo?.decimals || 18
                                        )
                                      ) || BigInt(1))
                                  )
                                )
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Allowance Progress Bar */}
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
                            (allowanceState.currentAllowance * BigInt(100)) /
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
                                  (allowanceState.requiredAmount || BigInt(1))
                              )
                            )
                      }%`,
                    }}
                  />
                </div>
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
              disabled={!account || loading}
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
                onClick={handleApproval}
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
  );
}
