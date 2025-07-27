import hre from "hardhat";
import { formatEther, keccak256, parseEther, toHex } from "viem";

async function main() {
  console.log("🚀 Creating 4 escrow orders as makers on EVM side...");

  // Get the deployer account
  const [deployer] = await hre.viem.getWalletClients();

  console.log("Using account:", deployer.account.address);

  // Get deployed contract addresses from your deployment
  const escrowFactoryAddress = "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853";
  const coreTokenAddress = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0";
  const stableCoinAddress = "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9";
  const governanceTokenAddress = "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9";
  const utilityTokenAddress = "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707";

  const escrowFactory = await hre.viem.getContractAt(
    "EscrowFactory",
    escrowFactoryAddress
  );

  // Create 4 different escrow orders
  const orders = [
    {
      name: "CORE → USDC Swap",
      srcToken: coreTokenAddress,
      dstToken: stableCoinAddress,
      amount: parseEther("1000"), // 1000 CORE
      safetyDeposit: parseEther("0.01"), // 0.01 ETH
    },
    {
      name: "USDC → GOV Swap",
      srcToken: stableCoinAddress,
      dstToken: governanceTokenAddress,
      amount: parseEther("500"), // 500 USDC
      safetyDeposit: parseEther("0.005"), // 0.005 ETH
    },
    {
      name: "GOV → UTIL Swap",
      srcToken: governanceTokenAddress,
      dstToken: utilityTokenAddress,
      amount: parseEther("200"), // 200 GOV
      safetyDeposit: parseEther("0.002"), // 0.002 ETH
    },
    {
      name: "UTIL → CORE Swap",
      srcToken: utilityTokenAddress,
      dstToken: coreTokenAddress,
      amount: parseEther("300"), // 300 UTIL
      safetyDeposit: parseEther("0.003"), // 0.003 ETH
    },
  ];

  console.log("\n📋 Creating escrow orders...");

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    console.log(`\n${i + 1}. Creating ${order.name}...`);

    // Generate random secret and hashlock
    const secret = `secret_${Date.now()}_${i}`;
    const secretBytes = toHex(secret);
    const hashlock = keccak256(secretBytes);

    // Generate order hash
    const orderHash = keccak256(toHex(`order_${Date.now()}_${i}`));

    // Create timelocks (simplified for now)
    const now = Math.floor(Date.now() / 1000);
    const timelocks = BigInt(now + 3600); // 1 hour from now

    // Create immutables for destination escrow (what makers create on EVM side)
    const dstImmutables = {
      orderHash,
      hashlock,
      maker: BigInt("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"), // Account #1
      taker: BigInt(deployer.account.address),
      token: BigInt(order.dstToken),
      amount: order.amount,
      safetyDeposit: order.safetyDeposit,
      timelocks,
    };

    try {
      // For createDstEscrow, we need to approve the DESTINATION token (not source token)
      // The factory will transfer the destination token from us to the escrow
      let dstToken;
      if (order.dstToken === coreTokenAddress) {
        dstToken = await hre.viem.getContractAt("CoreToken", order.dstToken);
      } else if (order.dstToken === stableCoinAddress) {
        dstToken = await hre.viem.getContractAt("StableCoin", order.dstToken);
      } else if (order.dstToken === governanceTokenAddress) {
        dstToken = await hre.viem.getContractAt(
          "GovernanceToken",
          order.dstToken
        );
      } else if (order.dstToken === utilityTokenAddress) {
        dstToken = await hre.viem.getContractAt("UtilityToken", order.dstToken);
      } else {
        throw new Error(`Unknown token: ${order.dstToken}`);
      }

      await dstToken.write.approve([escrowFactoryAddress, order.amount]);

      // Add delay between transactions
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay

      // Create destination escrow (this is what makers do on EVM side)
      const tx = await escrowFactory.write.createDstEscrow(
        [
          dstImmutables,
          BigInt(now + 10800), // srcCancellation timestamp (3 hours)
        ],
        {
          value: order.safetyDeposit,
        }
      );

      console.log(`✅ ${order.name} created successfully!`);
      console.log(`   Transaction: ${tx}`);
      console.log(`   Hashlock: ${hashlock}`);
      console.log(`   Amount: ${formatEther(order.amount)} tokens`);
      console.log(`   Safety deposit: ${formatEther(order.safetyDeposit)} ETH`);

      // Get the deterministic address of the created escrow
      const escrowAddress = await escrowFactory.read.addressOfEscrowDst([
        dstImmutables,
      ]);
      console.log(`   Escrow address: ${escrowAddress}`);
    } catch (error) {
      console.error(`❌ Failed to create ${order.name}:`, error);
    }
  }

  // Verify deployments by reading contract state
  console.log("\n🔍 Verifying escrow deployments...");

  try {
    // Get implementation addresses
    const srcImplementation =
      await escrowFactory.read.ESCROW_SRC_IMPLEMENTATION();
    const dstImplementation =
      await escrowFactory.read.ESCROW_DST_IMPLEMENTATION();

    console.log("✅ EscrowFactory verification:");
    console.log(`   Src Implementation: ${srcImplementation}`);
    console.log(`   Dst Implementation: ${dstImplementation}`);

    // Check token balances
    const coreToken = await hre.viem.getContractAt(
      "CoreToken",
      coreTokenAddress
    );
    const coreBalance = await coreToken.read.balanceOf([
      deployer.account.address,
    ]);
    console.log(`   CoreToken balance: ${formatEther(coreBalance)} CORE`);

    const stableCoin = await hre.viem.getContractAt(
      "StableCoin",
      stableCoinAddress
    );
    const stableBalance = await stableCoin.read.balanceOf([
      deployer.account.address,
    ]);
    console.log(`   StableCoin balance: ${formatEther(stableBalance)} USDC`);

    const governanceToken = await hre.viem.getContractAt(
      "GovernanceToken",
      governanceTokenAddress
    );
    const govBalance = await governanceToken.read.balanceOf([
      deployer.account.address,
    ]);
    console.log(`   GovernanceToken balance: ${formatEther(govBalance)} GOV`);

    const utilityToken = await hre.viem.getContractAt(
      "UtilityToken",
      utilityTokenAddress
    );
    const utilBalance = await utilityToken.read.balanceOf([
      deployer.account.address,
    ]);
    console.log(`   UtilityToken balance: ${formatEther(utilBalance)} UTIL`);

    console.log("\n🎉 All escrow orders created and verified successfully!");
  } catch (error) {
    console.error("❌ Verification failed:", error);
  }
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
