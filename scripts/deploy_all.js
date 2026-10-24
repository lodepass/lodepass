// scripts/deploy_all.js — deploy Lodepass + LodeMarket ke BSC, simpan alamatnya
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  const REGISTRY = process.env.AGENT_REGISTRY || "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
  const TREASURY = process.env.TREASURY;
  const PRICE = process.env.PRICE_WEI || ethers.parseEther("0.0015").toString();
  const FORGE_FEE = process.env.FORGE_FEE_WEI || ethers.parseEther("0.0005").toString();
  const UNIT_PRICE = process.env.UNIT_PRICE_WEI || "5000000000000";
  const START = process.env.START_TIME ? Number(process.env.START_TIME) : Math.floor(Date.now() / 1000) + 900;

  if (!TREASURY) throw new Error("set TREASURY");

  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("deployer :", deployer.address);
  console.log("balance  :", ethers.formatEther(bal), "BNB");
  console.log("treasury :", TREASURY);
  console.log("price    :", ethers.formatEther(PRICE), "BNB · forgeFee:", ethers.formatEther(FORGE_FEE), "BNB");
  console.log("unitPx   :", ethers.formatEther(UNIT_PRICE), "BNB/unit · start:", new Date(START * 1000).toISOString());

  const Lode = await ethers.getContractFactory("Lodepass");
  const lode = await Lode.deploy(REGISTRY, TREASURY, PRICE, FORGE_FEE, UNIT_PRICE, START);
  const rc1 = await lode.deploymentTransaction().wait();
  const lodeAddr = await lode.getAddress();
  console.log("\nLodepass  →", lodeAddr, "· gas", rc1.gasUsed.toString());

  const Market = await ethers.getContractFactory("LodeMarket");
  const market = await Market.deploy(lodeAddr, TREASURY);
  const rc2 = await market.deploymentTransaction().wait();
  const marketAddr = await market.getAddress();
  console.log("LodeMarket →", marketAddr, "· gas", rc2.gasUsed.toString());

  // verifikasi baca balik
  console.log("\n=== verifikasi ===");
  console.log("kode Lodepass  :", ((await ethers.provider.getCode(lodeAddr)).length - 2) / 2, "bytes");
  console.log("kode LodeMarket:", ((await ethers.provider.getCode(marketAddr)).length - 2) / 2, "bytes");
  console.log("MAX_SUPPLY     :", (await lode.MAX_SUPPLY()).toString());
  console.log("MAX_PER_WALLET :", (await lode.MAX_PER_WALLET()).toString());
  console.log("priceWei       :", (await lode.priceWei()).toString());
  console.log("forgeFeeWei    :", (await lode.forgeFeeWei()).toString());
  console.log("unitPriceWei   :", (await lode.unitPriceWei()).toString());
  console.log("treasury       :", await lode.treasury());
  console.log("ROYALTY_BPS    :", (await lode.ROYALTY_BPS()).toString());
  console.log("market FEE_BPS :", (await market.FEE_BPS()).toString());
  console.log("market.collection:", await market.collection());

  const out = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(out, { recursive: true });
  const data = {
    chainId: 56,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    treasury: TREASURY,
    lodepass: lodeAddr,
    market: marketAddr,
    registry: REGISTRY,
    priceWei: PRICE,
    forgeFeeWei: FORGE_FEE,
    unitPriceWei: UNIT_PRICE,
    startTime: START,
    tx: { lodepass: rc1.hash, market: rc2.hash },
  };
  fs.writeFileSync(path.join(out, "bsc.json"), JSON.stringify(data, null, 2));
  console.log("\ntersimpan → deployments/bsc.json");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
