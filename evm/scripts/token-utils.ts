import { task } from "hardhat/config";
import { formatEther } from "viem";

// Task to check token balance
task("token:balance", "Check token balance for an address")
  .addParam("token", "Token contract address")
  .addParam("address", "Address to check balance for")
  .setAction(async (taskArgs, hre) => {
    try {
      const [deployer] = await hre.viem.getWalletClients();
      const tokenContract = await getTokenContract(taskArgs.token, hre);

      const balance = await tokenContract.read.balanceOf([taskArgs.address]);
      const formattedBalance = await formatTokenBalance(balance, tokenContract);
      const decimals = await tokenContract.read.decimals();
      const symbol = await tokenContract.read.symbol();

      console.log("🔧 Token Balance Check");
      console.log("=".repeat(50));
      console.log(`Token: ${taskArgs.token}`);
      console.log(`Symbol: ${symbol}`);
      console.log(`Decimals: ${decimals}`);
      console.log(`Address: ${taskArgs.address}`);
      console.log(`Balance: ${formattedBalance} ${symbol}`);
      console.log(`Raw balance: ${balance.toString()}`);
    } catch (error) {
      console.error("❌ Error:", error);
    }
  });

// Task to check allowance
task("token:allowance", "Check token allowance for a spender")
  .addParam("token", "Token contract address")
  .addParam("owner", "Token owner address")
  .addParam("spender", "Spender address")
  .setAction(async (taskArgs, hre) => {
    try {
      const tokenContract = await getTokenContract(taskArgs.token, hre);

      const allowance = await tokenContract.read.allowance([
        taskArgs.owner,
        taskArgs.spender,
      ]);
      const formattedAllowance = await formatTokenBalance(
        allowance,
        tokenContract
      );
      const symbol = await tokenContract.read.symbol();

      console.log("🔐 Token Allowance Check");
      console.log("=".repeat(50));
      console.log(`Token: ${taskArgs.token}`);
      console.log(`Symbol: ${symbol}`);
      console.log(`Owner: ${taskArgs.owner}`);
      console.log(`Spender: ${taskArgs.spender}`);
      console.log(`Allowance: ${formattedAllowance} ${symbol}`);
      console.log(`Raw allowance: ${allowance.toString()}`);
    } catch (error) {
      console.error("❌ Error:", error);
    }
  });

// Task to approve allowance
task("token:approve", "Approve token allowance for a spender")
  .addParam("token", "Token contract address")
  .addParam("spender", "Spender address")
  .addParam("amount", "Amount to approve (in token units)")
  .setAction(async (taskArgs, hre) => {
    try {
      const [deployer] = await hre.viem.getWalletClients();
      const tokenContract = await getTokenContract(taskArgs.token, hre);

      const symbol = await tokenContract.read.symbol();
      const decimals = await tokenContract.read.decimals();

      console.log("✅ Setting Token Allowance");
      console.log("=".repeat(50));
      console.log(`Token: ${taskArgs.token}`);
      console.log(`Symbol: ${symbol}`);
      console.log(`Decimals: ${decimals}`);
      console.log(`Spender: ${taskArgs.spender}`);
      console.log(`Amount: ${taskArgs.amount} ${symbol}`);

      // Parse amount using correct decimals
      const parsedAmount = BigInt(
        Number(taskArgs.amount) * 10 ** Number(decimals)
      );
      console.log(
        `Raw amount: ${parsedAmount.toString()} (${decimals} decimals)`
      );

      // Approve the allowance
      const tx = await tokenContract.write.approve([
        taskArgs.spender,
        parsedAmount,
      ]);
      console.log(`✅ Approval transaction sent: ${tx}`);
      console.log("⏳ Waiting for confirmation...");

      // Wait for transaction confirmation
      const publicClient = await hre.viem.getPublicClient();
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });
      console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

      // Verify the allowance was set correctly
      const newAllowance = await tokenContract.read.allowance([
        deployer.account.address,
        taskArgs.spender,
      ]);
      const formattedNewAllowance = await formatTokenBalance(
        newAllowance,
        tokenContract
      );
      console.log(`✅ New allowance: ${formattedNewAllowance} ${symbol}`);
    } catch (error) {
      console.error("❌ Error:", error);
    }
  });

// Helper function to get token contract with proper detection
async function getTokenContract(tokenAddress: string, hre: any) {
  const contractNames = [
    "USDCoin", // Try USDC first
    "OneInchToken",
    "AaveToken",
    "WrappedEther",
    "UniswapToken",
  ];

  for (const contractName of contractNames) {
    try {
      const contract = await hre.viem.getContractAt(
        contractName,
        tokenAddress as `0x${string}`
      );

      // Test the contract by checking if it has the expected functions
      try {
        await contract.read.name();
        await contract.read.symbol();
        await contract.read.decimals();
        console.log(`✅ Using contract: ${contractName}`);
        return contract;
      } catch {
        // If basic ERC20 functions fail, try next contract
        continue;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Could not find matching contract for the token address");
}

// Helper function to format balance based on token decimals
async function formatTokenBalance(
  balance: bigint,
  tokenContract: any
): Promise<string> {
  try {
    const decimals = await tokenContract.read.decimals();
    const divisor = 10n ** BigInt(decimals);
    const formattedBalance = Number(balance) / Number(divisor);
    return formattedBalance.toLocaleString();
  } catch {
    // Fallback to 18 decimals if decimals() fails
    return formatEther(balance);
  }
}
