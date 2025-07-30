import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-toolbox-viem";
import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";

// Import token utility tasks
import "./scripts/token-utils";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.23",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      gasPrice: 100000000000, // 100 gwei
    },
    hardhat: {
      forking: {
        url: `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
      },
      gasPrice: 100000000000, // 100 gwei
      blockGasLimit: 30000000,
    },
  },
};

export default config;
