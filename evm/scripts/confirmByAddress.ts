import { verifyContract } from "./verifyContract";

const USDC_ADDRESS = "0x64a522C31854f28C4Ee67DC24c5344b16bf17bbf";

async function main() {
  console.log("🔍 verifying USDC token address and balances");

  // // Get the deployer account using hardhat-ethers
  // const [deployer] = await hre.ethers.getSigners();

  // // Create USDC contract instance using hardhat artifacts
  // const USDCFactory = await hre.ethers.getContractFactory("USDCoin");

  try {
    await verifyContract(USDC_ADDRESS, [], 0);
  } catch (error: any) {
    console.log("❌ Error checking token:", error.message);
  }
}

main().catch(console.error);
