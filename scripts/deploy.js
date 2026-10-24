// scripts/deploy.js — deploy Lodepass ke BSC mainnet
// Pakai: DEPLOYER_KEY=0x... npx hardhat run scripts/deploy.js --network bsc
const { ethers } = require("hardhat");

async function main() {
  const REGISTRY = process.env.AGENT_REGISTRY || "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"; // Binance Agent ID registry (BSC)
  const TREASURY = process.env.TREASURY; // wajib: alamat penerima hasil mint
  const PRICE = process.env.PRICE_WEI || ethers.parseEther("0.0015").toString();
  const FORGE_FEE = process.env.FORGE_FEE_WEI || ethers.parseEther("0.0005").toString();
  const UNIT_PRICE = process.env.UNIT_PRICE_WEI || "5000000000000"; // 0,000005 BNB per unit tambang
  const START = process.env.START_TIME ? Number(process.env.START_TIME) : Math.floor(Date.now() / 1000) + 3600;

  if (!TREASURY) throw new Error("set TREASURY (alamat penerima hasil mint)");

  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address);
  console.log("registry:", REGISTRY);
  console.log("treasury:", TREASURY);
  console.log("price   :", ethers.formatEther(PRICE), "BNB");
  console.log("forgeFee:", ethers.formatEther(FORGE_FEE), "BNB");
  console.log("unitPx  :", ethers.formatEther(UNIT_PRICE), "BNB per unit tambang");
  console.log("start   :", new Date(START * 1000).toISOString());

  const Lode = await ethers.getContractFactory("Lodepass");
  const lode = await Lode.deploy(REGISTRY, TREASURY, PRICE, FORGE_FEE, UNIT_PRICE, START);
  await lode.waitForDeployment();
  const addr = await lode.getAddress();
  console.log("\nLodepass deployed →", addr);
  console.log("bscscan:", `https://bscscan.com/address/${addr}`);
  console.log("MAX_SUPPLY:", (await lode.MAX_SUPPLY()).toString());
  console.log("MAX_PER_WALLET:", (await lode.MAX_PER_WALLET()).toString());
  console.log("FREE_PER_WALLET:", (await lode.FREE_PER_WALLET()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
