import hre from "hardhat";
import { formatEther } from "viem";

async function main() {
  console.log("Starting EscrowFactory deployment...");

  // Get the deployer account
  const [deployer] = await hre.viem.getWalletClients();

  const publicClient = await hre.viem.getPublicClient();
  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  // Deploy all tokens
  console.log("\nDeploying tokens...");

  const oneInchToken = await hre.viem.deployContract("OneInchToken");
  console.log("✅ 1INCH Token deployed at:", oneInchToken.address);

  const usdc = await hre.viem.deployContract("USDCoin");
  console.log("✅ USDC deployed at:", usdc.address);

  const aaveToken = await hre.viem.deployContract("AaveToken");
  console.log("✅ AAVE Token deployed at:", aaveToken.address);

  const weth = await hre.viem.deployContract("WrappedEther");
  console.log("✅ WETH deployed at:", weth.address);

  const uniToken = await hre.viem.deployContract("UniswapToken");
  console.log("✅ UNI Token deployed at:", uniToken.address);

  // Constructor parameters for EscrowFactory
  // Using zero address for limitOrderProtocol since we're not using 1inch LOP
  const limitOrderProtocol = "0x0000000000000000000000000000000000000000"; // Zero address - not using 1inch LOP
  const feeToken = oneInchToken.address; // Use 1INCH as fee token
  const accessToken = oneInchToken.address; // Use 1INCH as access token
  const owner = deployer.account.address; // Deployer as initial owner
  const rescueDelaySrc = 86400; // 1 day in seconds (uint32)
  const rescueDelayDst = 86400; // 1 day in seconds (uint32)

  console.log("Constructor parameters:");
  console.log(
    "- limitOrderProtocol:",
    limitOrderProtocol,
    "(zero address - not using 1inch LOP)"
  );
  console.log("- feeToken:", feeToken);
  console.log("- accessToken:", accessToken);
  console.log("- owner:", owner);
  console.log("- rescueDelaySrc:", rescueDelaySrc);
  console.log("- rescueDelayDst:", rescueDelayDst);

  // Deploy EscrowFactory
  console.log("\nDeploying EscrowFactory...");

  const escrowFactory = await hre.viem.deployContract("EscrowFactory", [
    limitOrderProtocol,
    feeToken,
    accessToken,
    owner,
    rescueDelaySrc,
    rescueDelayDst,
  ]);

  console.log("\n✅ EscrowFactory deployed successfully!");
  console.log("📍 EscrowFactory address:", escrowFactory.address);

  // Get implementation addresses
  const srcImplementation =
    await escrowFactory.read.ESCROW_SRC_IMPLEMENTATION();
  const dstImplementation =
    await escrowFactory.read.ESCROW_DST_IMPLEMENTATION();

  console.log("📍 EscrowSrc implementation:", srcImplementation);
  console.log("📍 EscrowDst implementation:", dstImplementation);

  console.log("\nDeployment complete! 🎉");

  // Verify token balances
  console.log("\n" + "=".repeat(60));
  console.log("📊 TOKEN BALANCES VERIFICATION");
  console.log("=".repeat(60));

  const oneInchBalance = await oneInchToken.read.balanceOf([
    deployer.account.address,
  ]);
  const usdcBalance = await usdc.read.balanceOf([deployer.account.address]);
  const aaveBalance = await aaveToken.read.balanceOf([
    deployer.account.address,
  ]);
  const wethBalance = await weth.read.balanceOf([deployer.account.address]);
  const uniBalance = await uniToken.read.balanceOf([deployer.account.address]);

  console.log(
    `1INCH Balance: ${formatEther(
      oneInchBalance
    )} tokens (${oneInchBalance.toString()} wei)`
  );
  console.log(
    `USDC Balance: ${
      Number(usdcBalance) / 10 ** 6
    } tokens (${usdcBalance.toString()} wei) - 6 decimals`
  );
  console.log(
    `AAVE Balance: ${formatEther(
      aaveBalance
    )} tokens (${aaveBalance.toString()} wei)`
  );
  console.log(
    `WETH Balance: ${formatEther(
      wethBalance
    )} tokens (${wethBalance.toString()} wei)`
  );
  console.log(
    `UNI Balance: ${formatEther(
      uniBalance
    )} tokens (${uniBalance.toString()} wei)`
  );
  console.log("=".repeat(60));

  // Output .env format for dApp
  console.log("\n" + "=".repeat(60));
  console.log("📋 .env VARIABLES FOR YOUR dAPP");
  console.log("=".repeat(60));
  console.log(`NEXT_PUBLIC_ONEINCH_TOKEN_ADDRESS=${oneInchToken.address}`);
  console.log(`NEXT_PUBLIC_USDC_ADDRESS=${usdc.address}`);
  console.log(`NEXT_PUBLIC_AAVE_TOKEN_ADDRESS=${aaveToken.address}`);
  console.log(`NEXT_PUBLIC_WETH_ADDRESS=${weth.address}`);
  console.log(`NEXT_PUBLIC_UNI_TOKEN_ADDRESS=${uniToken.address}`);
  console.log(`NEXT_PUBLIC_ETH_FACTORY_ADDRESS=${escrowFactory.address}`);
  console.log(`NEXT_PUBLIC_ESCROW_SRC_IMPLEMENTATION=${srcImplementation}`);
  console.log(`NEXT_PUBLIC_ESCROW_DST_IMPLEMENTATION=${dstImplementation}`);
  console.log("=".repeat(60));

  return {
    oneInchToken: oneInchToken.address,
    usdc: usdc.address,
    aaveToken: aaveToken.address,
    weth: weth.address,
    uniToken: uniToken.address,
    escrowFactory: escrowFactory.address,
    escrowSrcImplementation: srcImplementation,
    escrowDstImplementation: dstImplementation,
  };
}

// Run the deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
