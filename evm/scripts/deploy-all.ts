import hre from "hardhat";
import { formatEther } from "viem";

async function main() {
  console.log("Starting EscrowFactory and Resolver deployment...");

  // Get the deployer account
  const [deployer] = await hre.viem.getWalletClients();

  const publicClient = await hre.viem.getPublicClient();
  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  // Deploy tokens
  console.log("\nDeploying tokens...");

  const oneInchToken = await hre.viem.deployContract("OneInchToken");
  console.log("✅ 1INCH Token deployed at:", oneInchToken.address);

  const usdc = await hre.viem.deployContract("USDCoin");
  console.log("✅ USDC deployed at:", usdc.address);

  // Constructor parameters for EscrowFactory
  const limitOrderProtocol = "0x111111125421ca6dc452d289314280a0f8842a65"; // 1inch LOP address
  const feeToken = oneInchToken.address; // Use 1INCH as fee token
  const accessToken = oneInchToken.address; // Use 1INCH as access token
  const owner = deployer.account.address; // Deployer as initial owner
  const rescueDelaySrc = 86400; // 1 day in seconds (uint32)
  const rescueDelayDst = 86400; // 1 day in seconds (uint32)

  console.log("EscrowFactory constructor parameters:");
  console.log("- limitOrderProtocol:", limitOrderProtocol);
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

  console.log("✅ EscrowFactory deployed successfully!");
  console.log("📍 EscrowFactory address:", escrowFactory.address);

  // Get implementation addresses
  const srcImplementation =
    await escrowFactory.read.ESCROW_SRC_IMPLEMENTATION();
  const dstImplementation =
    await escrowFactory.read.ESCROW_DST_IMPLEMENTATION();

  console.log("📍 EscrowSrc implementation:", srcImplementation);
  console.log("📍 EscrowDst implementation:", dstImplementation);

  // Deploy Resolver
  console.log("\nDeploying Resolver...");

  const resolver = await hre.viem.deployContract("Resolver", [
    escrowFactory.address, // Use the deployed factory address
    limitOrderProtocol, // Use the same LOP address
    owner, // Use the same owner
  ]);

  console.log("✅ Resolver deployed successfully!");
  console.log("📍 Resolver address:", resolver.address);

  console.log("\nDeployment complete! 🎉");

  // Verify token balances
  console.log("\n" + "=".repeat(60));
  console.log("📊 TOKEN BALANCES VERIFICATION");
  console.log("=".repeat(60));

  const oneInchBalance = (await oneInchToken.read.balanceOf([
    deployer.account.address,
  ])) as bigint;
  const usdcBalance = (await usdc.read.balanceOf([
    deployer.account.address,
  ])) as bigint;

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
  console.log("=".repeat(60));

  // Output consolidated .env format for dApp
  console.log("\n" + "=".repeat(60));
  console.log("📋 .env VARIABLES FOR YOUR dAPP");
  console.log("=".repeat(60));
  console.log(`NEXT_PUBLIC_ONEINCH_TOKEN_ADDRESS=${oneInchToken.address}`);
  console.log(`NEXT_PUBLIC_USDC_ADDRESS=${usdc.address}`);
  console.log(`NEXT_PUBLIC_ETH_FACTORY_ADDRESS=${escrowFactory.address}`);
  console.log(`NEXT_PUBLIC_ESCROW_SRC_IMPLEMENTATION=${srcImplementation}`);
  console.log(`NEXT_PUBLIC_ESCROW_DST_IMPLEMENTATION=${dstImplementation}`);
  console.log(`NEXT_PUBLIC_RESOLVER_ADDRESS=${resolver.address}`);
  console.log("=".repeat(60));

  return {
    oneInchToken: oneInchToken.address,
    usdc: usdc.address,
    escrowFactory: escrowFactory.address,
    escrowSrcImplementation: srcImplementation,
    escrowDstImplementation: dstImplementation,
    resolver: resolver.address,
  };
}

// Run the deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
