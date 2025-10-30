require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    // Base Sepolia Testnet
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY
        ? (process.env.PRIVATE_KEY.includes(' ')
            ? { mnemonic: process.env.PRIVATE_KEY }
            : [process.env.PRIVATE_KEY])
        : [],
      chainId: 84532
    },
    // Base Mainnet (for future)
    base: {
      url: "https://mainnet.base.org",
      accounts: process.env.PRIVATE_KEY
        ? (process.env.PRIVATE_KEY.includes(' ')
            ? { mnemonic: process.env.PRIVATE_KEY }
            : [process.env.PRIVATE_KEY])
        : [],
      chainId: 8453
    }
  },
  etherscan: {
    apiKey: {
      baseSepolia: process.env.BASESCAN_API_KEY || ""
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org"
        }
      }
    ]
  }
};
