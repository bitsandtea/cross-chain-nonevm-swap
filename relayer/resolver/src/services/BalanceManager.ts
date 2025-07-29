/**
 * Balance Manager Service
 * Implements Phase 1 step 3 from resolver_both_phases.md:
 * - Check liquidity on both chains
 * - Manage allowances
 * - Monitor balance thresholds
 */

import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { ethers } from "ethers";
import {
  extractErrorMessage,
  formatEthAmount,
  parseEthAmount,
  retryAsync,
} from "../lib/utils";
import { BalanceCheck, FusionPlusOrder, ResolverConfig } from "../types";
import { createLogger } from "./Logger";

export class BalanceManager {
  private config: ResolverConfig;
  private logger = createLogger("BalanceManager");
  private evmProvider: ethers.JsonRpcProvider;
  private aptosClient: Aptos;
  private evmWallet: ethers.Wallet;
  private aptosPrivateKey: string;
  private aptosAccount: Account;

  constructor(config: ResolverConfig) {
    this.config = config;

    // Initialize EVM provider and wallet
    this.evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
    this.evmWallet = new ethers.Wallet(config.evmPrivateKey, this.evmProvider);

    // Initialize Aptos client and account
    const isTestnet =
      config.aptosRpcUrl.includes("testnet") ||
      config.aptosRpcUrl.includes("devnet") ||
      config.aptosRpcUrl.includes("localhost");

    this.logger.info("Initializing Aptos client", {
      rpcUrl: config.aptosRpcUrl,
      network: isTestnet ? "TESTNET" : "MAINNET",
    });

    const aptosConfig = new AptosConfig({
      network: isTestnet ? Network.TESTNET : Network.MAINNET,
      fullnode: config.aptosRpcUrl,
    });
    this.aptosClient = new Aptos(aptosConfig);
    this.aptosPrivateKey = config.aptosPrivateKey;

    // Create Aptos account from private key
    const privateKey = new Ed25519PrivateKey(config.aptosPrivateKey);
    this.aptosAccount = Account.fromPrivateKey({ privateKey });

    this.logger.info("Aptos account initialized", {
      address: this.aptosAccount.accountAddress.toString(),
    });
  }

  /**
   * Check if resolver has sufficient balance for a Fusion+ order
   */
  async checkBalances(fusionOrder: FusionPlusOrder): Promise<BalanceCheck> {
    try {
      this.logger.info("Checking balances for order", {
        srcChain: fusionOrder.srcChain,
        dstChain: fusionOrder.dstChain,
        makingAmount: fusionOrder.makingAmount,
        takingAmount: fusionOrder.takingAmount,
      });

      // Get current balances
      const [evmBalance, aptosBalance] = await Promise.all([
        this.getEvmBalance(),
        this.getAptosBalance(),
      ]);

      // Calculate required balances
      const requiredBalances = this.calculateRequiredBalances(fusionOrder);

      const sufficient =
        parseFloat(evmBalance) >= parseFloat(requiredBalances.evm) &&
        parseFloat(aptosBalance) >= parseFloat(requiredBalances.aptos);

      this.logger.info("Balance check complete", {
        evmBalance,
        aptosBalance,
        requiredEvm: requiredBalances.evm,
        requiredAptos: requiredBalances.aptos,
        sufficient,
      });

      return {
        sufficient,
        evmBalance,
        aptosBalance,
        requiredEvm: requiredBalances.evm,
        requiredAptos: requiredBalances.aptos,
        error: sufficient
          ? undefined
          : "Insufficient balance on one or more chains",
      };
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      this.logger.error("Balance check failed:", errorMessage);

      return {
        sufficient: false,
        evmBalance: "0",
        aptosBalance: "0",
        requiredEvm: "0",
        requiredAptos: "0",
        error: errorMessage,
      };
    }
  }

  /**
   * Get EVM balance (ETH)
   */
  async getEvmBalance(): Promise<string> {
    try {
      const balance = await retryAsync(
        async () => {
          return await this.evmProvider.getBalance(this.evmWallet.address);
        },
        3,
        1000
      );

      return formatEthAmount(balance.toString());
    } catch (error) {
      this.logger.error(
        "Failed to get EVM balance:",
        extractErrorMessage(error)
      );
      throw error;
    }
  }

  /**
   * Get Aptos balance (APT)
   */
  async getAptosBalance(): Promise<string> {
    try {
      // Get Aptos address from account
      const aptosAddress = this.deriveAptosAddress();

      this.logger.info("Fetching Aptos balance", {
        address: aptosAddress,
        rpcUrl: this.config.aptosRpcUrl,
      });

      const balance = await retryAsync(
        async () => {
          const balance = await this.aptosClient.getAccountAPTAmount({
            accountAddress: aptosAddress,
          });
          this.logger.debug("APT balance found via SDK", {
            value: balance.toString(),
          });
          return balance.toString();
        },
        3,
        1000
      );

      // APT has 8 decimals
      const formattedBalance = formatEthAmount(balance, 8);
      this.logger.info("Aptos balance retrieved", {
        rawBalance: balance,
        formattedBalance,
        address: aptosAddress,
      });

      return formattedBalance;
    } catch (error) {
      this.logger.error(
        "Failed to get Aptos balance:",
        extractErrorMessage(error)
      );
      throw error;
    }
  }

  /**
   * Calculate required balances for both chains
   */
  private calculateRequiredBalances(fusionOrder: FusionPlusOrder): {
    evm: string;
    aptos: string;
  } {
    // Base gas requirements
    const evmGasReserve = 0.02; // 0.02 ETH for gas
    const aptosGasReserve = 0.1; // 0.1 APT for gas

    // Safety deposits
    const srcSafetyDeposit = parseFloat(
      formatEthAmount(fusionOrder.srcSafetyDeposit)
    );
    const dstSafetyDeposit = parseFloat(
      formatEthAmount(fusionOrder.dstSafetyDeposit)
    );

    // Calculate based on which chain is source/destination
    let evmRequired = evmGasReserve;
    let aptosRequired = aptosGasReserve;

    if (fusionOrder.srcChain === 1) {
      // EVM is source chain
      evmRequired += srcSafetyDeposit;
      // Add token amount if it's not ETH
      if (fusionOrder.makerAsset !== ethers.ZeroAddress) {
        // For ERC-20 tokens, we still need ETH for gas only
        // The token balance is checked separately
      } else {
        // For ETH transfers, add the making amount
        evmRequired += parseFloat(formatEthAmount(fusionOrder.makingAmount));
      }
    }

    if (fusionOrder.dstChain === 1) {
      // EVM is destination chain
      evmRequired += dstSafetyDeposit;
      // Add token amount for fulfilling the order
      evmRequired += parseFloat(formatEthAmount(fusionOrder.takingAmount));
    }

    if (fusionOrder.srcChain === 1000) {
      // Aptos is source chain
      aptosRequired += srcSafetyDeposit;
      // Add token amount (convert from ETH equivalent)
      aptosRequired += parseFloat(formatEthAmount(fusionOrder.makingAmount));
    }

    if (fusionOrder.dstChain === 1000) {
      // Aptos is destination chain
      aptosRequired += dstSafetyDeposit;
      aptosRequired += parseFloat(formatEthAmount(fusionOrder.takingAmount));
    }

    return {
      evm: evmRequired.toString(),
      aptos: aptosRequired.toString(),
    };
  }

  /**
   * Check and approve ERC-20 token allowance if needed
   */
  async ensureTokenAllowance(
    tokenAddress: string,
    spenderAddress: string,
    amount: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      // Skip for native ETH
      if (tokenAddress === ethers.ZeroAddress) {
        return { success: true };
      }

      this.logger.info("Checking token allowance", {
        token: tokenAddress,
        spender: spenderAddress,
        amount,
      });

      // Create token contract
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          "function allowance(address owner, address spender) view returns (uint256)",
          "function approve(address spender, uint256 amount) returns (bool)",
        ],
        this.evmWallet
      );

      // Check current allowance
      const currentAllowance = await tokenContract.allowance(
        this.evmWallet.address,
        spenderAddress
      );

      const requiredAmount = parseEthAmount(amount);

      if (currentAllowance >= requiredAmount) {
        this.logger.debug("Sufficient allowance already exists");
        return { success: true };
      }

      // Approve max uint256 for convenience
      const maxUint256 = ethers.MaxUint256;

      this.logger.info("Approving token allowance", {
        token: tokenAddress,
        spender: spenderAddress,
        amount: maxUint256.toString(),
      });

      const tx = await tokenContract.approve(spenderAddress, maxUint256);
      await tx.wait();

      this.logger.info("Token allowance approved", { txHash: tx.hash });

      return {
        success: true,
        txHash: tx.hash,
      };
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      this.logger.error("Failed to approve token allowance:", errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if balances are above minimum thresholds
   */
  async checkMinimumBalances(): Promise<{
    sufficient: boolean;
    evmSufficient: boolean;
    aptosSufficient: boolean;
    balances: { evm: string; aptos: string };
  }> {
    try {
      const [evmBalance, aptosBalance] = await Promise.all([
        this.getEvmBalance(),
        this.getAptosBalance(),
      ]);

      console.log("evmBalance", evmBalance);
      console.log("aptosBalance", aptosBalance);
      console.log("minEvmBalance", this.config.minEvmBalance);
      console.log("minAptosBalance", this.config.minAptosBalance);

      const evmSufficient =
        parseFloat(evmBalance) >= parseFloat(this.config.minEvmBalance);
      const aptosSufficient =
        parseFloat(aptosBalance) >= parseFloat(this.config.minAptosBalance);

      return {
        sufficient: evmSufficient && aptosSufficient,
        evmSufficient,
        aptosSufficient,
        balances: {
          evm: evmBalance,
          aptos: aptosBalance,
        },
      };
    } catch (error) {
      this.logger.error(
        "Failed to check minimum balances:",
        extractErrorMessage(error)
      );
      throw error;
    }
  }

  /**
   * Get token balance for a specific ERC-20 token
   */
  async getTokenBalance(tokenAddress: string): Promise<string> {
    try {
      // Return ETH balance for zero address
      if (tokenAddress === ethers.ZeroAddress) {
        return await this.getEvmBalance();
      }

      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function balanceOf(address owner) view returns (uint256)"],
        this.evmProvider
      );

      const balance = await tokenContract.balanceOf(this.evmWallet.address);
      return formatEthAmount(balance.toString());
    } catch (error) {
      this.logger.error(
        "Failed to get token balance:",
        extractErrorMessage(error)
      );
      throw error;
    }
  }

  /**
   * Derive Aptos address from private key
   */
  private deriveAptosAddress(): string {
    return this.aptosAccount.accountAddress.toString();
  }

  /**
   * Get resolver wallet addresses
   */
  getWalletAddresses(): {
    evm: string;
    aptos: string;
  } {
    return {
      evm: this.evmWallet.address,
      aptos: this.deriveAptosAddress(),
    };
  }
}
