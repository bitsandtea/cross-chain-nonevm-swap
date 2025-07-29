"use strict";
/**
 * Balance Manager Service
 * Implements Phase 1 step 3 from resolver_both_phases.md:
 * - Check liquidity on both chains
 * - Manage allowances
 * - Monitor balance thresholds
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BalanceManager = void 0;
const ts_sdk_1 = require("@aptos-labs/ts-sdk");
const ethers_1 = require("ethers");
const utils_1 = require("../lib/utils");
const Logger_1 = require("./Logger");
class BalanceManager {
    constructor(config) {
        this.logger = (0, Logger_1.createLogger)("BalanceManager");
        this.config = config;
        // Initialize EVM provider and wallet
        this.evmProvider = new ethers_1.ethers.JsonRpcProvider(config.evmRpcUrl);
        this.evmWallet = new ethers_1.ethers.Wallet(config.evmPrivateKey, this.evmProvider);
        // Initialize Aptos client
        const aptosConfig = new ts_sdk_1.AptosConfig({
            network: config.aptosRpcUrl.includes("testnet")
                ? ts_sdk_1.Network.TESTNET
                : ts_sdk_1.Network.MAINNET,
            fullnode: config.aptosRpcUrl,
        });
        this.aptosClient = new ts_sdk_1.Aptos(aptosConfig);
        this.aptosPrivateKey = config.aptosPrivateKey;
    }
    /**
     * Check if resolver has sufficient balance for a Fusion+ order
     */
    async checkBalances(fusionOrder) {
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
            const sufficient = parseFloat(evmBalance) >= parseFloat(requiredBalances.evm) &&
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
        }
        catch (error) {
            const errorMessage = (0, utils_1.extractErrorMessage)(error);
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
    async getEvmBalance() {
        try {
            const balance = await (0, utils_1.retryAsync)(async () => {
                return await this.evmProvider.getBalance(this.evmWallet.address);
            }, 3, 1000);
            return (0, utils_1.formatEthAmount)(balance.toString());
        }
        catch (error) {
            this.logger.error("Failed to get EVM balance:", (0, utils_1.extractErrorMessage)(error));
            throw error;
        }
    }
    /**
     * Get Aptos balance (APT)
     */
    async getAptosBalance() {
        try {
            // Derive Aptos address from private key
            // For now, we'll use a placeholder implementation
            // TODO: Implement proper Aptos wallet derivation
            const aptosAddress = this.deriveAptosAddress();
            const balance = await (0, utils_1.retryAsync)(async () => {
                const resources = await this.aptosClient.getAccountResources({
                    accountAddress: aptosAddress,
                });
                const aptCoinResource = resources.find((r) => r.type === "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>");
                if (aptCoinResource && aptCoinResource.data) {
                    const coinData = aptCoinResource.data;
                    return coinData.coin.value;
                }
                return "0";
            }, 3, 1000);
            // APT has 8 decimals
            return (0, utils_1.formatEthAmount)(balance, 8);
        }
        catch (error) {
            this.logger.error("Failed to get Aptos balance:", (0, utils_1.extractErrorMessage)(error));
            throw error;
        }
    }
    /**
     * Calculate required balances for both chains
     */
    calculateRequiredBalances(fusionOrder) {
        // Base gas requirements
        const evmGasReserve = 0.02; // 0.02 ETH for gas
        const aptosGasReserve = 0.1; // 0.1 APT for gas
        // Safety deposits
        const srcSafetyDeposit = parseFloat((0, utils_1.formatEthAmount)(fusionOrder.srcSafetyDeposit));
        const dstSafetyDeposit = parseFloat((0, utils_1.formatEthAmount)(fusionOrder.dstSafetyDeposit));
        // Calculate based on which chain is source/destination
        let evmRequired = evmGasReserve;
        let aptosRequired = aptosGasReserve;
        if (fusionOrder.srcChain === 1) {
            // EVM is source chain
            evmRequired += srcSafetyDeposit;
            // Add token amount if it's not ETH
            if (fusionOrder.makerAsset !== ethers_1.ethers.ZeroAddress) {
                // For ERC-20 tokens, we still need ETH for gas only
                // The token balance is checked separately
            }
            else {
                // For ETH transfers, add the making amount
                evmRequired += parseFloat((0, utils_1.formatEthAmount)(fusionOrder.makingAmount));
            }
        }
        if (fusionOrder.dstChain === 1) {
            // EVM is destination chain
            evmRequired += dstSafetyDeposit;
            // Add token amount for fulfilling the order
            evmRequired += parseFloat((0, utils_1.formatEthAmount)(fusionOrder.takingAmount));
        }
        if (fusionOrder.srcChain === 1000) {
            // Aptos is source chain
            aptosRequired += srcSafetyDeposit;
            // Add token amount (convert from ETH equivalent)
            aptosRequired += parseFloat((0, utils_1.formatEthAmount)(fusionOrder.makingAmount));
        }
        if (fusionOrder.dstChain === 1000) {
            // Aptos is destination chain
            aptosRequired += dstSafetyDeposit;
            aptosRequired += parseFloat((0, utils_1.formatEthAmount)(fusionOrder.takingAmount));
        }
        return {
            evm: evmRequired.toString(),
            aptos: aptosRequired.toString(),
        };
    }
    /**
     * Check and approve ERC-20 token allowance if needed
     */
    async ensureTokenAllowance(tokenAddress, spenderAddress, amount) {
        try {
            // Skip for native ETH
            if (tokenAddress === ethers_1.ethers.ZeroAddress) {
                return { success: true };
            }
            this.logger.info("Checking token allowance", {
                token: tokenAddress,
                spender: spenderAddress,
                amount,
            });
            // Create token contract
            const tokenContract = new ethers_1.ethers.Contract(tokenAddress, [
                "function allowance(address owner, address spender) view returns (uint256)",
                "function approve(address spender, uint256 amount) returns (bool)",
            ], this.evmWallet);
            // Check current allowance
            const currentAllowance = await tokenContract.allowance(this.evmWallet.address, spenderAddress);
            const requiredAmount = (0, utils_1.parseEthAmount)(amount);
            if (currentAllowance >= requiredAmount) {
                this.logger.debug("Sufficient allowance already exists");
                return { success: true };
            }
            // Approve max uint256 for convenience
            const maxUint256 = ethers_1.ethers.MaxUint256;
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
        }
        catch (error) {
            const errorMessage = (0, utils_1.extractErrorMessage)(error);
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
    async checkMinimumBalances() {
        try {
            const [evmBalance, aptosBalance] = await Promise.all([
                this.getEvmBalance(),
                this.getAptosBalance(),
            ]);
            const evmSufficient = parseFloat(evmBalance) >= parseFloat(this.config.minEvmBalance);
            const aptosSufficient = parseFloat(aptosBalance) >= parseFloat(this.config.minAptosBalance);
            return {
                sufficient: evmSufficient && aptosSufficient,
                evmSufficient,
                aptosSufficient,
                balances: {
                    evm: evmBalance,
                    aptos: aptosBalance,
                },
            };
        }
        catch (error) {
            this.logger.error("Failed to check minimum balances:", (0, utils_1.extractErrorMessage)(error));
            throw error;
        }
    }
    /**
     * Get token balance for a specific ERC-20 token
     */
    async getTokenBalance(tokenAddress) {
        try {
            // Return ETH balance for zero address
            if (tokenAddress === ethers_1.ethers.ZeroAddress) {
                return await this.getEvmBalance();
            }
            const tokenContract = new ethers_1.ethers.Contract(tokenAddress, ["function balanceOf(address owner) view returns (uint256)"], this.evmProvider);
            const balance = await tokenContract.balanceOf(this.evmWallet.address);
            return (0, utils_1.formatEthAmount)(balance.toString());
        }
        catch (error) {
            this.logger.error("Failed to get token balance:", (0, utils_1.extractErrorMessage)(error));
            throw error;
        }
    }
    /**
     * Derive Aptos address from private key
     * TODO: Implement proper Aptos address derivation
     */
    deriveAptosAddress() {
        // Placeholder implementation
        // In practice, this should derive the address from the private key
        // using Aptos SDK utilities
        return "0x" + this.aptosPrivateKey.slice(0, 64);
    }
    /**
     * Get resolver wallet addresses
     */
    getWalletAddresses() {
        return {
            evm: this.evmWallet.address,
            aptos: this.deriveAptosAddress(),
        };
    }
}
exports.BalanceManager = BalanceManager;
//# sourceMappingURL=BalanceManager.js.map