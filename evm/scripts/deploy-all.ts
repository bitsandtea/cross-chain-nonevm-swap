import hre from "hardhat";
import { verifyContract } from "./verifyContract";

async function main() {
  console.log("Starting EscrowFactory and Resolver deployment...");

  // Get the deployer account using hardhat-ethers
  const [deployer] = await hre.ethers.getSigners();

  // Get balance using ethers
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  // Deploy tokens
  // console.log("\nDeploying tokens...");

  // const OneInchTokenFactory = await hre.ethers.getContractFactory(
  //   "OneInchToken"
  // );
  // const oneInchToken = await OneInchTokenFactory.deploy();
  // await oneInchToken.waitForDeployment();
  // console.log("✅ 1INCH Token deployed at:", await oneInchToken.getAddress());

  // const USDCFactory = await hre.ethers.getContractFactory("USDCoin");
  // const usdc = await USDCFactory.deploy();
  // await usdc.waitForDeployment();
  // console.log("✅ USDC deployed at:", await usdc.getAddress());

  // // Constructor parameters for EscrowFactory
  const limitOrderProtocol = process.env.LOP;
  const feeToken = "0x513b2f387d4f8c28c536a65ae99b415199803126";
  const accessToken = "0x64a522c31854f28c4ee67dc24c5344b16bf17bbf";
  // const feeToken = await oneInchToken.getAddress(); // Use 1INCH as fee token
  // const accessToken = await oneInchToken.getAddress(); // Use 1INCH as access token
  const owner = deployer.address; // Deployer as initial owner
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

  // const EscrowFactoryFactory = await hre.ethers.getContractFactory(
  //   "EscrowFactory"
  // );
  // const escrowFactory = await EscrowFactoryFactory.deploy(
  const escrowFactory = await hre.ethers.deployContract("EscrowFactory", [
    limitOrderProtocol,
    feeToken,
    accessToken,
    owner,
    rescueDelaySrc,
    rescueDelayDst,
  ]);
  await escrowFactory.waitForDeployment();

  console.log("✅ EscrowFactory deployed successfully!");
  console.log("📍 EscrowFactory address:", await escrowFactory.getAddress());

  // Verify EscrowFactory
  console.log("\nVerifying EscrowFactory...");
  await verifyContract(await escrowFactory.getAddress(), [
    limitOrderProtocol,
    feeToken,
    accessToken,
    owner,
    rescueDelaySrc,
    rescueDelayDst,
  ]);

  // Get implementation addresses
  const srcImplementation = await escrowFactory.ESCROW_SRC_IMPLEMENTATION();
  const dstImplementation = await escrowFactory.ESCROW_DST_IMPLEMENTATION();

  console.log("📍 EscrowSrc implementation:", srcImplementation);
  console.log("📍 EscrowDst implementation:", dstImplementation);

  // Deploy Resolver
  console.log("\nDeploying Resolver...");

  const ResolverFactory = await hre.ethers.getContractFactory("Resolver");
  const resolver = await ResolverFactory.deploy(
    await escrowFactory.getAddress(), // Use the deployed factory address
    limitOrderProtocol, // Use the same LOP address
    owner // Use the same owner
  );
  await resolver.waitForDeployment();

  console.log("✅ Resolver deployed successfully!");
  console.log("📍 Resolver address:", await resolver.getAddress());

  // Verify Resolver
  console.log("\nVerifying Resolver...");
  await verifyContract(await resolver.getAddress(), [
    await escrowFactory.getAddress(),
    limitOrderProtocol,
    owner,
  ]);

  console.log("\nDeployment complete! 🎉");

  // Verify token balances
  console.log("\n" + "=".repeat(60));
  console.log("📊 TOKEN BALANCES VERIFICATION");
  console.log("=".repeat(60));

  // const oneInchBalance = await oneInchToken.balanceOf(deployer.address);
  // const usdcBalance = await usdc.balanceOf(deployer.address);

  // console.log(
  //   `1INCH Balance: ${hre.ethers.formatEther(
  //     oneInchBalance
  //   )} tokens (${oneInchBalance.toString()} wei)`
  // );
  // console.log(
  //   `USDC Balance: ${
  //     Number(usdcBalance) / 10 ** 6
  //   } tokens (${usdcBalance.toString()} wei) - 6 decimals`
  // );
  // console.log("=".repeat(60));

  // Output consolidated .env format for dApp
  // console.log("\n" + "=".repeat(60));
  // console.log("📋 .env VARIABLES FOR YOUR dAPP");
  // console.log("=".repeat(60));
  // console.log(
  //   `NEXT_PUBLIC_ONEINCH_TOKEN_ADDRESS=${await oneInchToken.getAddress()}`
  // );
  // console.log(`NEXT_PUBLIC_USDC_ADDRESS=${await usdc.getAddress()}`);
  // console.log(
  //   `NEXT_PUBLIC_ETH_FACTORY_ADDRESS=${await escrowFactory.getAddress()}`
  // );
  console.log(`NEXT_PUBLIC_ESCROW_SRC_IMPLEMENTATION=${srcImplementation}`);
  console.log(`NEXT_PUBLIC_ESCROW_DST_IMPLEMENTATION=${dstImplementation}`);
  console.log(`NEXT_PUBLIC_RESOLVER_ADDRESS=${await resolver.getAddress()}`);
  console.log("=".repeat(60));

  return {
    // oneInchToken: await oneInchToken.getAddress(),
    // usdc: await usdc.getAddress(),
    escrowFactory: await escrowFactory.getAddress(),
    escrowSrcImplementation: srcImplementation,
    escrowDstImplementation: dstImplementation,
    resolver: await resolver.getAddress(),
  };
}

// Run the deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
