/**
 * Profitability Analyzer Service
 * Implements Phase 1 step 1-2 from resolver_both_phases.md:
 * - Fetch 1inch quotes
 * - Calculate net profit
 */

import { extractErrorMessage, formatEthAmount } from "../lib/utils";
import { Intent, ProfitabilityAnalysis, ResolverConfig } from "../types";

export class ProfitabilityAnalyzer {
  private config: ResolverConfig;

  constructor(config: ResolverConfig) {
    this.config = config;
  }

  /**
   * Analyze profitability of a Fusion+ order
   */
  async analyzeProfitability(intent: Intent): Promise<ProfitabilityAnalysis> {
    // TODO: Re-enable profitability analysis later
    // For now, return true for all trades to test escrow creation flow

    // console.log(
    //   "Profitability analysis skipped - returning true for all trades",
    //   {
    //     makerAsset: fusionOrder.makerAsset,
    //     takerAsset: fusionOrder.takerAsset,
    //     makingAmount: fusionOrder.makingAmount,
    //     takingAmount: fusionOrder.takingAmount,
    //     srcChain: fusionOrder.srcChain,
    //     dstChain: fusionOrder.dstChain,
    //   }
    // );

    return {
      profitable: true,
      expectedProfit: "0.001", // Small positive profit
      costs: {
        gasEstimate: "0.001",
        safetyDeposit: "0.001",
      },
      quote: {
        fromAmount: intent.order.makingAmount,
        toAmount: intent.order.takingAmount,
        price: "1.0",
        protocols: ["fusion-plus"],
      },
      error: undefined,
    };

    /*
    try {
      console.log("Analyzing profitability for order", {
        makerAsset: fusionOrder.makerAsset,
        takerAsset: fusionOrder.takerAsset,
        makingAmount: fusionOrder.makingAmount,
        takingAmount: fusionOrder.takingAmount,
        srcChain: fusionOrder.srcChain,
        dstChain: fusionOrder.dstChain,
      });

      // Step 1: Fetch 1inch quote for the destination chain
      const quote = await this.fetch1inchQuote(fusionOrder);

      // Step 2: Calculate costs
      const costs = await this.calculateCosts(fusionOrder);

      // Step 3: Calculate net profit
      const expectedOut = parseFloat(quote.toAmount);
      const totalCosts = Object.values(costs).reduce(
        (sum, cost) => sum + parseFloat(cost),
        0
      );

      const profit = expectedOut - totalCosts;
      const minProfitThreshold = parseFloat(this.config.minProfitThreshold);

      const profitable = profit > minProfitThreshold;

      con   ("Profitability analysis complete", {
        expectedOut,
        totalCosts,
        profit,
        profitable,
        minProfitThreshold,
      });

      return {
        profitable,
        expectedProfit: profit.toString(),
        costs,
        quote,
        error: profitable
          ? undefined
          : `Profit ${profit} below threshold ${minProfitThreshold}`,
      };
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      console.log("Profitability analysis failed:", errorMessage);

      return {
        profitable: false,
        expectedProfit: "0",
        costs: {
          gasEstimate: "0",
          safetyDeposit: "0",
        },
        quote: {
          fromAmount: "0",
          toAmount: "0",
          price: "0",
          protocols: [],
        },
        error: errorMessage,
      };
    }
    */
  }

  /**
   * Fetch quote from 1inch Fusion+ API for cross-chain swaps
   
  private async fetch1inchQuote(intent: Intent): Promise<{
    fromAmount: string;
    toAmount: string;
    price: string;
    protocols: string[];
  }> {
    const { dstChain, takerAsset, makerAsset, makingAmount } = intent.order;

    // Map testnet addresses to mainnet addresses for Fusion+ API
    const mainnetMakerAsset = getMainnetAddress(makerAsset, intent.srcChain);
    const mainnetTakerAsset = getMainnetAddress(takerAsset, dstChain);

    console.log(`🔧 [ProfitabilityAnalyzer] Fusion+ token mapping:`, {
      originalMaker: makerAsset,
      mainnetMaker: mainnetMakerAsset,
      originalTaker: takerAsset,
      mainnetTaker: mainnetTakerAsset,
      srcChain: intent.srcChain,
      dstChain,
    });

    // Use Fusion+ API for cross-chain quotes
    const url = `${this.config.oneInchApiUrl}/fusion-plus/quoter/v1.0/quote/receive`;
    const params = {
      srcChain: intent.srcChain,
      dstChain: dstChain,
      srcTokenAddress: mainnetMakerAsset,
      dstTokenAddress: mainnetTakerAsset,
      amount: makingAmount,
      walletAddress: intent.order.maker,
      enableEstimate: true,
    };

    console.log("Fetching 1inch Fusion+ quote", { url, params });

    const response = await retryAsync(
      async () => {
        const result = await axios.get(url, {
          params,
          headers: {
            Authorization: `Bearer ${this.config.oneInchApiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        if (result.status !== 200) {
          throw new Error(`1inch Fusion+ API error: ${result.status}`);
        }

        return result;
      },
      3,
      1000
    );

    const data = response.data;

    console.log(`🔧 [ProfitabilityAnalyzer] 1inch Fusion+ API response:`, data);

    // Validate response structure for Fusion+ API
    if (!data.quoteId || !data.srcTokenAmount || !data.dstTokenAmount) {
      console.log(
        `❌ [ProfitabilityAnalyzer] Invalid Fusion+ response structure:`,
        data
      );
      throw new Error(
        "Invalid 1inch Fusion+ response: missing required fields"
      );
    }

    // Get the recommended preset for pricing
    const recommendedPreset = data.recommendedPreset || "medium";
    const preset = data.presets[recommendedPreset];

    if (!preset) {
      throw new Error(`No preset found for ${recommendedPreset}`);
    }

    // Calculate price based on the preset amounts
    const price =
      preset.startAmount && preset.auctionStartAmount
        ? (
            parseFloat(preset.startAmount) /
            parseFloat(preset.auctionStartAmount)
          ).toString()
        : "0";

    return {
      fromAmount: data.srcTokenAmount,
      toAmount: data.dstTokenAmount,
      price,
      protocols: [], // Fusion+ doesn't provide protocol info in this format
    };
  }
*/
  /**
   * Calculate various costs involved in the trade
   */
  private async calculateCosts(intent: Intent): Promise<{
    gasEstimate: string;
    safetyDeposit: string;
    bridgeCosts?: string;
  }> {
    // Estimate gas costs for both chains
    const evmGasCost = await this.estimateEvmGasCost(intent);
    const aptosGasCost = await this.estimateAptosGasCost(intent);

    // Total gas cost (convert to ETH equivalent)
    const totalGasCost = evmGasCost + aptosGasCost;

    // Safety deposit (from order)
    const safetyDeposit =
      parseFloat(formatEthAmount(intent.srcSafetyDeposit)) +
      parseFloat(formatEthAmount(intent.dstSafetyDeposit));

    return {
      gasEstimate: totalGasCost.toString(),
      safetyDeposit: safetyDeposit.toString(),
      // bridgeCosts can be added later if needed for cross-chain transfers
    };
  }

  /**
   * Estimate EVM gas costs
   */
  private async estimateEvmGasCost(intent: Intent): Promise<number> {
    try {
      // Rough estimates based on typical escrow operations
      const escrowCreationGas = 200000; // Creating escrow
      const withdrawalGas = 150000; // Withdrawing from escrow
      const totalGas = escrowCreationGas + withdrawalGas;

      // Estimate gas price (in ETH)
      const gasPriceGwei = Math.min(30, this.config.maxGasPriceGwei); // Cap at config max
      const gasPriceEth = gasPriceGwei * 1e-9;

      const totalCostEth = totalGas * gasPriceEth * this.config.gasBuffer;

      console.log("EVM gas cost estimate", {
        totalGas,
        gasPriceGwei,
        totalCostEth,
      });

      return totalCostEth;
    } catch (error) {
      console.log(
        "Failed to estimate EVM gas cost, using default:",
        extractErrorMessage(error)
      );
      return 0.01; // Default fallback
    }
  }

  /**
   * Estimate Aptos gas costs
   */
  private async estimateAptosGasCost(intent: Intent): Promise<number> {
    try {
      // Aptos transactions are typically much cheaper
      const aptGasCost = 0.001; // ~0.001 APT per transaction
      const totalTransactions = 2; // Create escrow + withdraw

      // Convert APT to ETH equivalent (rough estimate)
      const aptToEthRate = 0.005; // Placeholder rate
      const totalCostEth = aptGasCost * totalTransactions * aptToEthRate;

      console.log("Aptos gas cost estimate", {
        aptGasCost,
        totalTransactions,
        totalCostEth,
      });

      return totalCostEth;
    } catch (error) {
      console.log(
        "Failed to estimate Aptos gas cost, using default:",
        extractErrorMessage(error)
      );
      return 0.001; // Default fallback
    }
  }

  /**
   * Check if current market conditions are favorable
   */
  async checkMarketConditions(): Promise<{
    favorable: boolean;
    gasPrice?: number;
    congestion?: string;
  }> {
    try {
      // This could be expanded to check:
      // - Current gas prices
      // - Network congestion
      // - Token volatility
      // - Liquidity on DEXs

      return {
        favorable: true, // Simplified for now
        gasPrice: 30,
        congestion: "low",
      };
    } catch (error) {
      console.log(
        "Failed to check market conditions:",
        extractErrorMessage(error)
      );
      return { favorable: true }; // Default to favorable
    }
  }
}
