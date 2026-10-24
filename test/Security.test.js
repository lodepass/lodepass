const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRICE = ethers.parseEther("0.0015");
const FORGE_FEE = ethers.parseEther("0.0005");
const UNIT_PRICE = 1000000000000n;
const DAY = 86400;

async function deployAll() {
  const [deployer, agentA, agentB, human, treasury] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentRegistry");
  const reg = await Mock.deploy();
  await reg.waitForDeployment();

  const Lode = await ethers.getContractFactory("Lodepass");
  const start = (await ethers.provider.getBlock("latest")).timestamp;
  const lode = await Lode.deploy(await reg.getAddress(), treasury.address, PRICE, FORGE_FEE, UNIT_PRICE, start + 10);
  await lode.waitForDeployment();

  const Market = await ethers.getContractFactory("LodeMarket");
  const market = await Market.deploy(await lode.getAddress(), treasury.address);
  await market.waitForDeployment();

  await (await reg.set(agentA.address, 1)).wait();
  await (await reg.set(agentB.address, 1)).wait();

  await ethers.provider.send("evm_setNextBlockTimestamp", [start + 60]);
  await ethers.provider.send("evm_mine", []);

  return { lode, market, reg, deployer, agentA, agentB, human, treasury };
}

async function warp(ts) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  await ethers.provider.send("evm_mine", []);
}

describe("SERANGAN — Lodepass & LodeMarket", function () {
  it("reentrancy saat mint tidak bisa melewati batas 5/wallet", async function () {
    const { lode, reg, deployer } = await deployAll();
    const A = await ethers.getContractFactory("ReenterMint");
    const atk = await A.deploy(await lode.getAddress());
    await atk.waitForDeployment();
    // penyerang didaftarkan sebagai agent supaya boleh mint
    await (await reg.set(await atk.getAddress(), 1)).wait();

    await (await atk.attack(1, { value: 0 })).wait();
    const bal = await lode.balanceOf(await atk.getAddress());
    console.log("      keping milik penyerang setelah reentrancy:", bal.toString(), "· attempts:", (await atk.attempts()).toString());
    expect(bal <= 5n).to.equal(true); // batas wallet tetap berlaku
  });

  it("reentrancy saat redeem tidak bisa menguras pool lebih dari earned", async function () {
    const { lode, reg, treasury, agentA } = await deployAll();
    const A = await ethers.getContractFactory("ReenterRedeem");
    const atk = await A.deploy(await lode.getAddress());
    await atk.waitForDeployment();
    await (await reg.set(await atk.getAddress(), 1)).wait();

    await (await lode.connect(treasury).fundRewards({ value: ethers.parseEther("0.01") })).wait();
    const poolBefore = await lode.rewardPool();

    // beri keping ke penyerang, tambang 30 hari, claim
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    await (await lode.connect(agentA).transferFrom(agentA.address, await atk.getAddress(), 1)).wait();
    const t0 = (await ethers.provider.getBlock("latest")).timestamp;
    await warp(t0 + 30 * DAY);
    await (await atk.claimToken(1)).wait();
    const units = await atk.earnedNow();
    expect(units > 0n).to.equal(true);

    const expected = await lode.quoteRedeem(units);
    await (await atk.attack(units)).wait();

    const poolAfter = await lode.rewardPool();
    console.log("      earned penyerang:", units.toString(), "· pool turun:", (poolBefore - poolAfter).toString());
    // pool hanya boleh turun sebesar unit yang benar-benar dimiliki
    expect(poolBefore - poolAfter).to.equal(expected);
    expect(await atk.earnedNow()).to.equal(0n);
    expect(poolAfter).to.equal(poolBefore - expected);
  });

  it("pool tidak bisa dikuras melebihi rewardPool (PoolTooSmall)", async function () {
    const { lode, agentA, treasury } = await deployAll();
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    const t0 = (await ethers.provider.getBlock("latest")).timestamp;
    await warp(t0 + 365 * DAY);
    await (await lode.connect(agentA).claim(1)).wait();
    const units = await lode.earned(agentA.address);
    const need = await lode.quoteRedeem(units);
    await (await lode.connect(treasury).fundRewards({ value: need / 2n })).wait();
    await expect(lode.connect(agentA).redeem(units)).to.be.revertedWithCustomError(lode, "PoolTooSmall");
    expect(await lode.rewardPool()).to.equal(need / 2n); // pool tidak berkurang
  });

  it("forge tidak bisa dipakai dua kali dengan keping yang sama (sudah di-burn)", async function () {
    const { lode, agentA } = await deployAll();
    await (await lode.connect(agentA).mint(3, { value: PRICE * 2n })).wait();
    await (await lode.connect(agentA).forge([1, 2, 3], { value: FORGE_FEE })).wait();
    await expect(
      lode.connect(agentA).forge([1, 2, 3], { value: FORGE_FEE })
    ).to.be.reverted; // ownerOf revert karena sudah burn
    expect(await lode.totalBurned()).to.equal(3n);
  });

  it("tier hasil forge tidak pernah melebihi 3 (Legendary)", async function () {
    const { lode, agentA } = await deployAll();
    // cari 3 keping Legendary
    await (await lode.connect(agentA).mint(5, { value: PRICE * 4n })).wait();
    let legend = [];
    for (let i = 1; i <= 5; i++) if (Number(await lode.tierOf(i)) === 3) legend.push(i);
    if (legend.length < 3) {
      // kalau belum ada 3, forge bertingkat dari 5 keping lalu cek batasnya
      const t = [1, 2, 3];
      await (await lode.connect(agentA).forge(t, { value: FORGE_FEE })).wait();
      const t2 = [4, 5, 6];
      await (await lode.connect(agentA).forge(t2, { value: FORGE_FEE })).wait();
      expect(Number(await lode.tierOf(6))).to.be.at.most(3);
    } else {
      await (await lode.connect(agentA).forge([legend[0], legend[1], legend[2]], { value: FORGE_FEE })).wait();
      expect(Number(await lode.tierOf(6))).to.equal(3);
    }
  });

  it("pasar: pembeli tidak bisa beli 2x di callback (reentrancy)", async function () {
    const { lode, market, agentA, treasury } = await deployAll();
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    await (await lode.connect(agentA).approve(await market.getAddress(), 1)).wait();
    await (await market.connect(agentA).list(1, PRICE, 7)).wait();

    const A = await ethers.getContractFactory("ReenterBuy");
    const atk = await A.deploy(await market.getAddress());
    await atk.waitForDeployment();
    await (await atk.attack(1, PRICE, { value: PRICE })).wait();

    console.log("      attempts:", (await atk.attempts()).toString(), "· owner:", await lode.ownerOf(1));
    expect(await lode.ownerOf(1)).to.equal(await atk.getAddress());
    // listing sudah terhapus -> pembelian kedua gagal
    await expect(market.connect(agentA).buy(1, { value: PRICE })).to.be.revertedWithCustomError(market, "NotListed");
  });

  it("pasar: penjual tidak bisa beli kepingnya sendiri", async function () {
    const { lode, market, agentA } = await deployAll();
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    await (await lode.connect(agentA).approve(await market.getAddress(), 1)).wait();
    await (await market.connect(agentA).list(1, PRICE, 7)).wait();
    await expect(market.connect(agentA).buy(1, { value: PRICE })).to.be.revertedWithCustomError(market, "BuyerIsSeller");
  });

  it("pasar: listing kedaluwarsa tidak bisa dibeli", async function () {
    const { lode, market, agentA, agentB } = await deployAll();
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    await (await lode.connect(agentA).approve(await market.getAddress(), 1)).wait();
    await (await market.connect(agentA).list(1, PRICE, 1)).wait();
    const t0 = (await ethers.provider.getBlock("latest")).timestamp;
    await warp(t0 + 2 * DAY);
    await expect(market.connect(agentB).buy(1, { value: PRICE })).to.be.revertedWithCustomError(market, "Expired");
  });

  it("pasar: keping yang sudah dipindah penjual -> beli gagal (bukan dana hilang)", async function () {
    const { lode, market, agentA, agentB, human } = await deployAll();
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    await (await lode.connect(agentA).approve(await market.getAddress(), 1)).wait();
    await (await market.connect(agentA).list(1, PRICE, 7)).wait();
    await (await lode.connect(agentA).transferFrom(agentA.address, human.address, 1)).wait();
    await expect(market.connect(agentB).buy(1, { value: PRICE })).to.be.reverted;
    // dana pembeli tidak masuk (transaksi revert)
    expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
  });

  it("pasar: harga 0 / durasi aneh ditolak", async function () {
    const { lode, market, agentA } = await deployAll();
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    await (await lode.connect(agentA).approve(await market.getAddress(), 1)).wait();
    await expect(market.connect(agentA).list(1, 0, 7)).to.be.revertedWithCustomError(market, "BadPrice");
    await expect(market.connect(agentA).list(1, PRICE, 0)).to.be.revertedWithCustomError(market, "BadExpiry");
    await expect(market.connect(agentA).list(1, PRICE, 366)).to.be.revertedWithCustomError(market, "BadExpiry");
  });

  it("tidak ada jalur admin: kontrak tidak punya owner/withdraw/pause/upgrade", async function () {
    const { lode, market } = await deployAll();
    const forbidden = ["owner", "withdraw", "pause", "unpause", "setPrice", "setMintOpen", "transferOwnership", "upgradeTo", "setTreasury", "rescue"];
    for (const c of [lode, market]) {
      const names = c.interface.fragments.map((f) => (f.name || "").toLowerCase());
      for (const f of forbidden) expect(names.includes(f)).to.equal(false);
    }
    // saldo kontrak = rewardPool (tidak ada dana nyangkut)
    expect(await ethers.provider.getBalance(await lode.getAddress())).to.equal(await lode.rewardPool());
  });
});
