// Balance service for fetching user token balances on local chains
import { ethers } from "ethers";

// ERC20 ABI for balance checking
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

export interface TokenBalance {
  address: string;
  symbol: string;
  balance: string; // Raw balance in wei
  formattedBalance: string; // Human readable balance
  decimals: number;
}

/**
 * Get ETH balance for an address
 */
export async function getEthBalance(
  userAddress: string,
  rpcUrl: string = "http://127.0.0.1:8545"
): Promise<string> {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const balance = await provider.getBalance(userAddress);
    return ethers.formatEther(balance);
  } catch (error) {
    console.error("Error fetching ETH balance:", error);
    return "0";
  }
}

/**
 * Get ERC20 token balance for an address
 */
export async function getTokenBalance(
  userAddress: string,
  tokenAddress: string,
  rpcUrl: string = "http://127.0.0.1:8545"
): Promise<TokenBalance | null> {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    // First check if the contract exists by checking bytecode
    const code = await provider.getCode(tokenAddress);
    if (code === "0x") {
      // Contract doesn't exist, silently return null
      return null;
    }

    const [balance, decimals, symbol, name] = await Promise.all([
      contract.balanceOf(userAddress),
      contract.decimals(),
      contract.symbol(),
      contract.name(),
    ]);

    const formattedBalance = ethers.formatUnits(balance, decimals);

    return {
      address: tokenAddress,
      symbol,
      balance: balance.toString(),
      formattedBalance,
      decimals: Number(decimals),
    };
  } catch (error) {
    // Only log actual errors, not missing contracts
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!errorMessage.includes("could not decode result data")) {
      console.error(`Error fetching balance for token ${tokenAddress}:`, error);
    }
    return null;
  }
}

/**
 * Get balances for multiple tokens
 */
export async function getMultipleTokenBalances(
  userAddress: string,
  tokenAddresses: string[],
  rpcUrl: string = "http://127.0.0.1:8545"
): Promise<Record<string, TokenBalance>> {
  const balances: Record<string, TokenBalance> = {};
  console.log("token addresses", tokenAddresses);
  const balancePromises = tokenAddresses.map(async (tokenAddress) => {
    const balance = await getTokenBalance(userAddress, tokenAddress, rpcUrl);
    console.log("Here balance", balance);
    if (balance) {
      balances[tokenAddress.toLowerCase()] = balance;
    }
  });

  await Promise.all(balancePromises);
  return balances;
}

/**
 * Format balance for display (with appropriate decimal places)
 */
export function formatBalance(
  balance: string,
  maxDecimals: number = 4
): string {
  const num = parseFloat(balance);
  if (num === 0) return "0";
  if (num < 0.0001) return "< 0.0001";

  // For small numbers, show more decimals
  if (num < 1) {
    return num.toFixed(Math.min(6, maxDecimals));
  }

  // For larger numbers, show fewer decimals
  return num.toFixed(Math.min(4, maxDecimals));
}

/**
 * Check if user has sufficient balance for a transaction
 */
export function hasSufficientBalance(
  userBalance: string,
  requiredAmount: string,
  decimals: number = 18
): boolean {
  try {
    const userBalanceWei = ethers.parseUnits(userBalance, decimals);
    const requiredAmountWei = ethers.parseUnits(requiredAmount, decimals);
    return userBalanceWei >= requiredAmountWei;
  } catch (error) {
    console.error("Error checking balance:", error);
    return false;
  }
}

/**
 * Get balance in USD using token price
 */
export function calculateBalanceUSD(
  balance: string,
  tokenPrice: string
): number {
  try {
    const balanceNum = parseFloat(balance);
    const priceNum = parseFloat(tokenPrice);
    return balanceNum * priceNum;
  } catch (error) {
    return 0;
  }
}
