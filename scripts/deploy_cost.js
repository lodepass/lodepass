// scripts/deploy_cost.js - measure deploy/mint/forge gas on the local network (real cost, tested locally for free)
const { ethers } = require("hardhat");

async function main() {
  const [me] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentRegistry");
  const reg = await Mock.deploy();
  await reg.waitForDeployment();
  await (await reg.set(me.address, 1)).wait();

  const Lode = await ethers.getContractFactory("Lodepass");
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const lode = await Lode.deploy(await reg.getAddress(), me.address, ethers.parseEther("0.0015"), ethers.parseEther("0.0005"), now);
  const rc = await lode.deploymentTransaction().wait();
  console.log("deploy gasUsed:", rc.gasUsed.toString(), "· ukuran bytecode:", ((await ethers.provider.getCode(await lode.getAddress())).length - 2) / 2, "bytes");

  const m = await (await lode.mint(3, { value: ethers.parseEther("0.003") })).wait();
  console.log("mint(3) gasUsed:", m.gasUsed.toString());
  const f = await (await lode.forge([1, 2, 3], { value: ethers.parseEther("0.0005") })).wait();
  console.log("forge gasUsed:", f.gasUsed.toString());
  const t0 = (await ethers.provider.getBlock("latest")).timestamp;
  await ethers.provider.send("evm_setNextBlockTimestamp", [t0 + 86400]);
  await ethers.provider.send("evm_mine", []);
  const c = await (await lode.claim(4)).wait();
  console.log("claim gasUsed:", c.gasUsed.toString());

  const gp = 0.05; // gwei (BSC saat ini)
  const bnb = (g) => (Number(g) * gp) / 1e9;
  console.log("\n=== biaya di BSC @0,05 gwei ===");
  console.log("deploy :", bnb(rc.gasUsed), "BNB ≈ Rp", Math.round(bnb(rc.gasUsed) * 12.2e6));
  console.log("mint   :", bnb(m.gasUsed), "BNB ≈ Rp", Math.round(bnb(m.gasUsed) * 12.2e6));
  console.log("forge  :", bnb(f.gasUsed), "BNB ≈ Rp", Math.round(bnb(f.gasUsed) * 12.2e6));
  console.log("claim  :", bnb(c.gasUsed), "BNB ≈ Rp", Math.round(bnb(c.gasUsed) * 12.2e6));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
