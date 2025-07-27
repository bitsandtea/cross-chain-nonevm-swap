#!/usr/bin/env ts-node

import { getConfigFromEnv } from "../src/lib/escrowUtils";

console.log("🔍 Debug: Current Event Listener Configuration");
console.log("=".repeat(50));

const config = getConfigFromEnv();

console.log("Configuration values:");
console.log(`- RPC URL: ${config.rpcUrl}`);
console.log(`- Factory Address: ${config.factoryAddress}`);
console.log(`- Chain ID: ${config.chainId}`);
console.log(`- Start Block: ${config.startBlock}`);

console.log("\n📝 Expected values for Hardhat:");
console.log("- RPC URL: http://127.0.0.1:8545");
console.log("- Factory Address: 0xa513e6e4b8f2a923d98304ec87f64353c4d5c853");
console.log("- Chain ID: 31337");
console.log("- Start Block: 0");

console.log("\n🚨 Issues found:");
if (config.rpcUrl !== "http://127.0.0.1:8545") {
  console.log(
    `❌ RPC URL mismatch: ${config.rpcUrl} !== http://127.0.0.1:8545`
  );
}
if (config.factoryAddress !== "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853") {
  console.log(
    `❌ Factory address mismatch: ${config.factoryAddress} !== 0xa513e6e4b8f2a923d98304ec87f64353c4d5c853`
  );
}
if (config.chainId !== 31337) {
  console.log(`❌ Chain ID mismatch: ${config.chainId} !== 31337`);
}

console.log("\n💡 To fix: Create .env.local file with:");
console.log("RPC_URL=http://127.0.0.1:8545");
console.log(
  "NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS=0xa513e6e4b8f2a923d98304ec87f64353c4d5c853"
);
console.log("CHAIN_ID=31337");
console.log("START_BLOCK=0");
