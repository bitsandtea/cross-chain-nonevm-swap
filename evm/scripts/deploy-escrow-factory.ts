import hre from "hardhat";
import { formatEther } from "viem";

async function main() {
  console.log("Starting EscrowFactory deployment...");

  // Get the deployer account
  const [deployer] = await hre.viem.getWalletClients();
  console.log("Deploying with account:", deployer.account.address);

  const publicClient = await hre.viem.getPublicClient();
  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  // Deploy all tokens
  console.log("\nDeploying tokens...");

  const coreToken = await hre.viem.deployContract("CoreToken");
  console.log("✅ CoreToken deployed at:", coreToken.address);

  const stableCoin = await hre.viem.deployContract("StableCoin");
  console.log("✅ StableCoin deployed at:", stableCoin.address);

  const governanceToken = await hre.viem.deployContract("GovernanceToken");
  console.log("✅ GovernanceToken deployed at:", governanceToken.address);

  const utilityToken = await hre.viem.deployContract("UtilityToken");
  console.log("✅ UtilityToken deployed at:", utilityToken.address);

  const rewardToken = await hre.viem.deployContract("RewardToken");
  console.log("✅ RewardToken deployed at:", rewardToken.address);

  // Constructor parameters for EscrowFactory
  // Using zero address for limitOrderProtocol since we're not using 1inch LOP
  const limitOrderProtocol = "0x0000000000000000000000000000000000000000"; // Zero address - not using 1inch LOP
  const feeToken = coreToken.address; // Use CoreToken as fee token
  const accessToken = coreToken.address; // Use CoreToken as access token
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

  // Output .env format for dApp
  console.log("\n" + "=".repeat(60));
  console.log("📋 .env VARIABLES FOR YOUR dAPP");
  console.log("=".repeat(60));
  console.log(`NEXT_PUBLIC_CORE_TOKEN_ADDRESS=${coreToken.address}`);
  console.log(`NEXT_PUBLIC_STABLE_COIN_ADDRESS=${stableCoin.address}`);
  console.log(
    `NEXT_PUBLIC_GOVERNANCE_TOKEN_ADDRESS=${governanceToken.address}`
  );
  console.log(`NEXT_PUBLIC_UTILITY_TOKEN_ADDRESS=${utilityToken.address}`);
  console.log(`NEXT_PUBLIC_REWARD_TOKEN_ADDRESS=${rewardToken.address}`);
  console.log(`NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS=${escrowFactory.address}`);
  console.log(`NEXT_PUBLIC_ESCROW_SRC_IMPLEMENTATION=${srcImplementation}`);
  console.log(`NEXT_PUBLIC_ESCROW_DST_IMPLEMENTATION=${dstImplementation}`);
  console.log("=".repeat(60));

  return {
    coreToken: coreToken.address,
    stableCoin: stableCoin.address,
    governanceToken: governanceToken.address,
    utilityToken: utilityToken.address,
    rewardToken: rewardToken.address,
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
