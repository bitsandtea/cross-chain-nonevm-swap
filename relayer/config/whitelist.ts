interface WhitelistConfig {
  tokens: {
    ethereum: string[];
    aptos: string[];
  };
  resolvers: string[];
}

export function getWhitelistConfig(): WhitelistConfig {
  return {
    tokens: {
      ethereum: [
        // Token addresses from deployment
        process.env.NEXT_PUBLIC_ONEINCH_TOKEN_ADDRESS || "",
        process.env.NEXT_PUBLIC_USDC_ADDRESS || "",
        process.env.NEXT_PUBLIC_AAVE_TOKEN_ADDRESS || "",
        process.env.NEXT_PUBLIC_WETH_ADDRESS || "",
        process.env.NEXT_PUBLIC_UNI_TOKEN_ADDRESS || "",
      ].filter(Boolean), // Remove empty strings
      aptos: [
        process.env.NEXT_PUBLIC_APT_ADDRESS || "0x1::aptos_coin::AptosCoin",
        process.env.NEXT_PUBLIC_USDC_APTOS_ADDRESS ||
          "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::USDC",
      ].filter(Boolean), // Remove empty strings
    },
    resolvers: [
      // Whitelisted resolver addresses (KYC/KYB verified)
      process.env.NEXT_PUBLIC_RESOLVER_1_ADDRESS || "",
      process.env.NEXT_PUBLIC_RESOLVER_2_ADDRESS || "",
      // Add development/test resolvers
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // Test resolver 1
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // Test resolver 2
    ].filter(Boolean), // Remove empty strings
  };
}

// For backward compatibility, also export as default
export default getWhitelistConfig();
