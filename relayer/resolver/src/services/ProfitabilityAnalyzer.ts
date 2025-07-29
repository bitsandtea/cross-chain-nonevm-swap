/**
 * Profitability Analyzer Service
 * Implements Phase 1 step 1-2 from resolver_both_phases.md:
 * - Fetch 1inch quotes
 * - Calculate net profit
 */

import axios from "axios";
import { extractErrorMessage, formatEthAmount, retryAsync } from "../lib/utils";
import {
  FusionPlusOrder,
  ProfitabilityAnalysis,
  ResolverConfig,
} from "../types";
import { createLogger } from "./Logger";

export class ProfitabilityAnalyzer {
  private config: ResolverConfig;
  private logger = createLogger("ProfitabilityAnalyzer");

  constructor(config: ResolverConfig) {
    this.config = config;
  }

  /**
   * Analyze profitability of a Fusion+ order
   */
  async analyzeProfitability(
    fusionOrder: FusionPlusOrder
  ): Promise<ProfitabilityAnalysis> {
    try {
      this.logger.info("Analyzing profitability for order", {
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

      this.logger.info("Profitability analysis complete", {
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
      this.logger.error("Profitability analysis failed:", errorMessage);

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
  }

  /**
   * Fetch quote from 1inch API
   */
  private async fetch1inchQuote(fusionOrder: FusionPlusOrder): Promise<{
    fromAmount: string;
    toAmount: string;
    price: string;
    protocols: string[];
  }> {
    const { dstChain, takerAsset, makerAsset, makingAmount } = fusionOrder;

    // Map our chain IDs to 1inch chain IDs
    const chainId = this.mapToOneInchChainId(dstChain);

    const url = `${this.config.oneInchApiUrl}/${chainId}/quote`;
    const params = {
      fromTokenAddress: makerAsset,
      toTokenAddress: takerAsset,
      amount: makingAmount,
    };

    this.logger.debug("Fetching 1inch quote", { url, params });

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
          throw new Error(`1inch API error: ${result.status}`);
        }

        return result;
      },
      3,
      1000
    );

    const data = response.data;

    // Validate response structure
    if (!data.toTokenAmount) {
      throw new Error("Invalid 1inch response: missing toTokenAmount");
    }

    return {
      fromAmount: data.fromTokenAmount || makingAmount,
      toAmount: data.toTokenAmount,
      price: (data.toTokenAmount / data.fromTokenAmount).toString(),
      protocols: data.protocols?.map((p: any) => p.name) || [],
    };
  }

  /**
   * Calculate various costs involved in the trade
   */
  private async calculateCosts(fusionOrder: FusionPlusOrder): Promise<{
    gasEstimate: string;
    safetyDeposit: string;
    bridgeCosts?: string;
  }> {
    // Estimate gas costs for both chains
    const evmGasCost = await this.estimateEvmGasCost(fusionOrder);
    const aptosGasCost = await this.estimateAptosGasCost(fusionOrder);

    // Total gas cost (convert to ETH equivalent)
    const totalGasCost = evmGasCost + aptosGasCost;

    // Safety deposit (from order)
    const safetyDeposit =
      parseFloat(formatEthAmount(fusionOrder.srcSafetyDeposit)) +
      parseFloat(formatEthAmount(fusionOrder.dstSafetyDeposit));

    return {
      gasEstimate: totalGasCost.toString(),
      safetyDeposit: safetyDeposit.toString(),
      // bridgeCosts can be added later if needed for cross-chain transfers
    };
  }

  /**
   * Estimate EVM gas costs
   */
  private async estimateEvmGasCost(
    fusionOrder: FusionPlusOrder
  ): Promise<number> {
    try {
      // Rough estimates based on typical escrow operations
      const escrowCreationGas = 200000; // Creating escrow
      const withdrawalGas = 150000; // Withdrawing from escrow
      const totalGas = escrowCreationGas + withdrawalGas;

      // Estimate gas price (in ETH)
      const gasPriceGwei = Math.min(30, this.config.maxGasPriceGwei); // Cap at config max
      const gasPriceEth = gasPriceGwei * 1e-9;

      const totalCostEth = totalGas * gasPriceEth * this.config.gasBuffer;

      this.logger.debug("EVM gas cost estimate", {
        totalGas,
        gasPriceGwei,
        totalCostEth,
      });

      return totalCostEth;
    } catch (error) {
      this.logger.warn(
        "Failed to estimate EVM gas cost, using default:",
        extractErrorMessage(error)
      );
      return 0.01; // Default fallback
    }
  }

  /**
   * Estimate Aptos gas costs
   */
  private async estimateAptosGasCost(
    fusionOrder: FusionPlusOrder
  ): Promise<number> {
    try {
      // Aptos transactions are typically much cheaper
      const aptGasCost = 0.001; // ~0.001 APT per transaction
      const totalTransactions = 2; // Create escrow + withdraw

      // Convert APT to ETH equivalent (rough estimate)
      const aptToEthRate = 0.005; // Placeholder rate
      const totalCostEth = aptGasCost * totalTransactions * aptToEthRate;

      this.logger.debug("Aptos gas cost estimate", {
        aptGasCost,
        totalTransactions,
        totalCostEth,
      });

      return totalCostEth;
    } catch (error) {
      this.logger.warn(
        "Failed to estimate Aptos gas cost, using default:",
        extractErrorMessage(error)
      );
      return 0.001; // Default fallback
    }
  }

  /**
   * Map our chain IDs to 1inch API chain IDs
   */
  private mapToOneInchChainId(chainId: number): number {
    const mapping: Record<number, number> = {
      1: 1, // Ethereum
      137: 137, // Polygon
      1000: 1, // Aptos -> use Ethereum for quotes (will need adjustment)
      // Add more mappings as needed
    };

    const mapped = mapping[chainId];
    if (!mapped) {
      throw new Error(`Unsupported chain ID for 1inch: ${chainId}`);
    }

    return mapped;
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
      this.logger.warn(
        "Failed to check market conditions:",
        extractErrorMessage(error)
      );
      return { favorable: true }; // Default to favorable
    }
  }
}
