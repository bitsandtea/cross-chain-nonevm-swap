import hre from "hardhat";
import { formatEther } from "viem";

async function main() {
  console.log("Starting Resolver deployment...");

  // Get the deployer account
  const [deployer] = await hre.viem.getWalletClients();

  const publicClient = await hre.viem.getPublicClient();
  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  // Constructor parameters for Resolver
  const factoryAddr = "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707";
  const lopAddr = "0x111111125421ca6dc452d289314280a0f8842a65";
  const owner = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"; // Account 5 on localhost

  console.log("Constructor parameters:");
  console.log("- factoryAddr:", factoryAddr);
  console.log("- lopAddr:", lopAddr);
  console.log("- owner:", owner);

  // Deploy Resolver
  console.log("\nDeploying Resolver...");

  const resolver = await hre.viem.deployContract("Resolver", [
    factoryAddr,
    lopAddr,
    owner,
  ]);

  console.log("\n✅ Resolver deployed successfully!");
  console.log("📍 Resolver address:", resolver.address);

  console.log("\nDeployment complete! 🎉");

  // Output .env format for dApp
  console.log("\n" + "=".repeat(60));
  console.log("📋 .env VARIABLES FOR YOUR dAPP");
  console.log("=".repeat(60));
  console.log(`NEXT_PUBLIC_RESOLVER_ADDRESS=${resolver.address}`);
  console.log("=".repeat(60));

  return {
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
