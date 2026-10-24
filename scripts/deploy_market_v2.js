// scripts/deploy_market_v2.js — deploy LodeMarketV2 untuk koleksi Lodepass yang sudah live
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  const LODE = process.env.LODE || "0x31b074C8e77e44F29df285F19d4fc76E6D927d01";
  const TREASURY = process.env.TREASURY || "0x5088fD836CD682CD3a719D35Ba93986506801FEE";

  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address, "· balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");

  const M = await ethers.getContractFactory("LodeMarketV2");
  const market = await M.deploy(LODE, TREASURY);
  const rc = await market.deploymentTransaction().wait();
  const addr = await market.getAddress();

  console.log("LodeMarketV2 →", addr, "· gas", rc.gasUsed.toString());
  console.log("kode:", ((await ethers.provider.getCode(addr)).length - 2) / 2, "bytes");
  console.log("FEE_BPS:", (await market.FEE_BPS()).toString());
  console.log("collection:", await market.collection());
  console.log("treasury:", await market.treasury());

  const p = path.join(__dirname, "..", "deployments", "market_v2.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ market: addr, collection: LODE, treasury: TREASURY, tx: rc.hash, gas: rc.gasUsed.toString() }, null, 2));
  console.log("tersimpan → deployments/market_v2.json");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
