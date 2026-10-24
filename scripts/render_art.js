// scripts/render_art.js — render SVG on-chain Lodepass ke folder art/ (tanpa deploy mainnet)
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  const out = path.join(__dirname, "..", "art");
  fs.mkdirSync(out, { recursive: true });

  const [deployer] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentRegistry");
  const reg = await Mock.deploy();
  await reg.waitForDeployment();
  await (await reg.set(deployer.address, 1)).wait();

  const Lode = await ethers.getContractFactory("Lodepass");
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const lode = await Lode.deploy(await reg.getAddress(), deployer.address, ethers.parseEther("0.0015"), ethers.parseEther("0.0005"), now);
  await lode.waitForDeployment();
  await (await lode.mint(5, { value: ethers.parseEther("0.006") })).wait();

  for (const id of [1, 2, 3, 4, 5, 7, 11, 13, 21, 33]) {
    const svg = await lode.svgOf(id);
    const tier = await lode.tierName(id);
    const file = path.join(out, `lode_${id}_${tier}.svg`);
    fs.writeFileSync(file, svg);
    console.log(`#${id} ${tier} → ${file} (${svg.length} bytes)`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
