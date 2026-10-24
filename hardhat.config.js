require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    bsc: {
      url: process.env.BSC_RPC || "https://bsc-dataseed.bnbchain.org",
      chainId: 56,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
};
