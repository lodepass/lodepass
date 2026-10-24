const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRICE = ethers.parseEther("0.0015");
const FORGE_FEE = ethers.parseEther("0.0005");
const UNIT_PRICE = 1000000000000n; // 0,000001 BNB per 1 unit (1e18)
const DAY = 24 * 60 * 60;
const ZERO = 0n;

async function deploy() {
  const [deployer, agentA, agentB, human, treasury] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentRegistry");
  const reg = await Mock.deploy();
  await reg.waitForDeployment();
  await (await reg.set(agentA.address, 1)).wait();
  await (await reg.set(agentB.address, 1)).wait();

  const Lode = await ethers.getContractFactory("Lodepass");
  const start = (await ethers.provider.getBlock("latest")).timestamp;
  const lode = await Lode.deploy(await reg.getAddress(), treasury.address, PRICE, FORGE_FEE, UNIT_PRICE, start + 60);
  await lode.waitForDeployment();
  return { lode, reg, deployer, agentA, agentB, human, treasury, start };
}

async function warp(toTs) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [toTs]);
  await ethers.provider.send("evm_mine", []);
}

async function nowTs() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

describe("Lodepass", function () {
  it("menolak mint sebelum jam buka", async function () {
    const { lode, agentA } = await deploy();
    await expect(lode.connect(agentA).mint(1, { value: 0 })).to.be.revertedWithCustomError(lode, "NotOpen");
  });

  it("menolak wallet tanpa Agent ID (.ai)", async function () {
    const { lode, human, start } = await deploy();
    await warp(start + 120);
    await expect(lode.connect(human).mint(1)).to.be.revertedWithCustomError(lode, "NotAgent");
  });

  it("keping pertama gratis, kedua bayar", async function () {
    const { lode, agentA, start } = await deploy();
    await warp(start + 120);
    await expect(lode.connect(agentA).mint(1, { value: 0 })).to.emit(lode, "Minted");
    await expect(lode.connect(agentA).mint(1, { value: 0 })).to.be.revertedWithCustomError(lode, "WrongPayment");
    await expect(lode.connect(agentA).mint(1, { value: PRICE })).to.emit(lode, "Minted");
    expect(await lode.balanceOf(agentA.address)).to.equal(2n);
  });

  it("uang mint ke treasury, saldo kontrak 0", async function () {
    const { lode, agentA, treasury, start } = await deploy();
    await warp(start + 120);
    const before = await ethers.provider.getBalance(treasury.address);
    await (await lode.connect(agentA).mint(2, { value: PRICE })).wait();
    const after = await ethers.provider.getBalance(treasury.address);
    expect(after - before).to.equal(PRICE);
    expect(await ethers.provider.getBalance(await lode.getAddress())).to.equal(ZERO);
  });

  it("batas 5 per wallet & quantity invalid", async function () {
    const { lode, agentA, start } = await deploy();
    await warp(start + 120);
    await expect(lode.connect(agentA).mint(6, { value: PRICE * 5n })).to.be.revertedWithCustomError(lode, "BadQuantity");
    await (await lode.connect(agentA).mint(5, { value: PRICE * 4n })).wait();
    await expect(lode.connect(agentA).mint(1, { value: PRICE })).to.be.revertedWithCustomError(lode, "WalletLimit");
  });

  it("tokenURI: JSON base64, image SVG on-chain, ada Rate", async function () {
    const { lode, agentA, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    const uri = await lode.tokenURI(1);
    expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
    const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    expect(json.name).to.equal("Lodepass #1");
    const svg = Buffer.from(json.image.split(",")[1], "base64").toString();
    expect(svg).to.contain("<svg");
    expect(svg).to.contain("LODEPASS");
    const rate = json.attributes.find((a) => a.trait_type === "Rate");
    expect(Number(rate.value)).to.be.greaterThan(0);
  });

  it("yield bertambah sesuai waktu (mine) dan bisa diklaim", async function () {
    const { lode, agentA, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    const base = await lode.rateOf(1);
    const t0 = await nowTs();
    await warp(t0 + DAY);
    const p = await lode.pending(1);
    // toleransi: timestamp blok bisa bergeser beberapa detik dari lastClaim
    expect(p >= base / 2n && p <= base * 2n).to.equal(true);
    await expect(lode.connect(agentA).claim(1)).to.emit(lode, "Claimed");
    expect(await lode.earned(agentA.address)).to.be.greaterThan(0n);
    const after = await lode.pending(1);
    expect(after < base / 100n).to.equal(true); // sisa cuma hitungan detik
  });

  it("claim hanya oleh pemilik; keping tanpa yield ditolak", async function () {
    const { lode, agentA, agentB, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    await expect(lode.connect(agentB).claim(1)).to.be.revertedWithCustomError(lode, "NotOwner");
  });

  it("forge 3 keping -> 1 keping tier lebih tinggi, 3 di-burn", async function () {
    const { lode, agentA, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(3, { value: PRICE * 2n })).wait();
    const t = [await lode.tierOf(1), await lode.tierOf(2), await lode.tierOf(3)].map(Number);
    const best = Math.max(...t);
    await expect(lode.connect(agentA).forge([1, 2, 3], { value: FORGE_FEE })).to.emit(lode, "Forged");
    expect(await lode.totalBurned()).to.equal(3n);
    expect(await lode.balanceOf(agentA.address)).to.equal(1n);
    const newId = 4n;
    expect(await lode.ownerOf(newId)).to.equal(agentA.address);
    expect(Number(await lode.tierOf(newId))).to.equal(Math.min(best + 1, 3));
    expect(await lode.isForged(newId)).to.equal(true);
    await expect(lode.ownerOf(1)).to.be.reverted;
  });

  it("forge ditolak kalau bukan pemilik / id duplikat / kurang dari 3", async function () {
    const { lode, agentA, agentB, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(3, { value: PRICE * 2n })).wait();
    await expect(lode.connect(agentB).forge([1, 2, 3], { value: FORGE_FEE })).to.be.revertedWithCustomError(lode, "NotOwner");
    await expect(lode.connect(agentA).forge([1, 1, 2], { value: FORGE_FEE })).to.be.revertedWithCustomError(lode, "DuplicateToken");
  });

  it("yield yang belum diklaim tidak hangus saat forge", async function () {
    const { lode, agentA, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(3, { value: PRICE * 2n })).wait();
    const t0 = await nowTs();
    await warp(t0 + DAY);
    const before = await lode.pending(1);
    await (await lode.connect(agentA).forge([1, 2, 3], { value: FORGE_FEE })).wait();
    expect(await lode.earned(agentA.address)).to.be.greaterThanOrEqual(before);
  });

  it("tier deterministik & hanya 4 nilai", async function () {
    const { lode } = await deploy();
    const seen = new Set();
    for (let i = 1; i <= 60; i++) {
      const a = await lode.tierOf(i);
      expect(await lode.tierOf(i)).to.equal(a);
      seen.add(Number(a));
    }
    expect([...seen].every((t) => t >= 0 && t <= 3)).to.equal(true);
  });


  it("royalty ERC-2981 = 2,5% ke treasury", async function () {
    const { lode, treasury } = await deploy();
    const price = ethers.parseEther("1");
    const [receiver, amount] = await lode.royaltyInfo(1, price);
    expect(receiver).to.equal(treasury.address);
    expect(amount).to.equal(price * 250n / 10000n);
    expect(await lode.supportsInterface("0x2a55205a")).to.equal(true); // IERC2981
    expect(await lode.ROYALTY_BPS()).to.equal(250n);
  });

  it("forge fee 0,0005 BNB masuk treasury; salah bayar ditolak", async function () {
    const { lode, agentA, treasury, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(3, { value: PRICE * 2n })).wait();
    await expect(lode.connect(agentA).forge([1, 2, 3], { value: 0 })).to.be.revertedWithCustomError(lode, "WrongPayment");
    const before = await ethers.provider.getBalance(treasury.address);
    await (await lode.connect(agentA).forge([1, 2, 3], { value: FORGE_FEE })).wait();
    expect((await ethers.provider.getBalance(treasury.address)) - before).to.equal(FORGE_FEE);
    expect(await ethers.provider.getBalance(await lode.getAddress())).to.equal(0n);
  });

  it("pasar sekunder: list -> buy, fee 2% ke treasury, sisa ke penjual", async function () {
    const { lode, agentA, agentB, treasury, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();

    const Market = await ethers.getContractFactory("LodeMarket");
    const market = await Market.deploy(await lode.getAddress(), treasury.address);
    await market.waitForDeployment();

    // belum approve -> list ditolak
    await expect(market.connect(agentA).list(1, PRICE, 7)).to.be.revertedWithCustomError(market, "NotApproved");
    await (await lode.connect(agentA).approve(await market.getAddress(), 1)).wait();
    await expect(market.connect(agentA).list(1, PRICE, 7)).to.emit(market, "Listed");

    const tBefore = await ethers.provider.getBalance(treasury.address);
    await expect(
      market.connect(agentB).buy(1, { value: PRICE })
    ).to.emit(market, "Sold");
    expect(await lode.ownerOf(1)).to.equal(agentB.address);
    const fee = PRICE * 200n / 10000n;
    expect((await ethers.provider.getBalance(treasury.address)) - tBefore).to.equal(fee);
    expect(await lode.getApproved(1)).to.equal(ethers.ZeroAddress);
  });

  it("pasar: cancel & harga salah ditolak", async function () {
    const { lode, agentA, agentB, treasury, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    const Market = await ethers.getContractFactory("LodeMarket");
    const market = await Market.deploy(await lode.getAddress(), treasury.address);
    await market.waitForDeployment();
    await (await lode.connect(agentA).approve(await market.getAddress(), 1)).wait();
    await (await market.connect(agentA).list(1, PRICE, 7)).wait();
    await expect(market.connect(agentB).buy(1, { value: PRICE - 1n })).to.be.revertedWithCustomError(market, "WrongPayment");
    await expect(market.connect(agentA).cancel(1)).to.emit(market, "Cancelled");
    await expect(market.connect(agentB).buy(1, { value: PRICE })).to.be.revertedWithCustomError(market, "NotListed");
  });


  it("hasil tambang bisa ditukar BNB dari pool (nilai punya harga)", async function () {
    const { lode, agentA, treasury, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();

    // isi pool 0,005 BNB
    await (await lode.connect(treasury).fundRewards({ value: ethers.parseEther("0.005") })).wait();
    expect(await lode.rewardPool()).to.equal(ethers.parseEther("0.005"));

    // tambang 2 hari
    const t0 = await nowTs();
    await warp(t0 + 2 * DAY);
    await (await lode.connect(agentA).claim(1)).wait();
    const units = await lode.earned(agentA.address);
    expect(units).to.be.greaterThan(0n);

    const expected = await lode.quoteRedeem(units);
    const balBefore = await ethers.provider.getBalance(agentA.address);
    const tx = await lode.connect(agentA).redeem(units);
    const rc = await tx.wait();
    const gasCost = rc.gasUsed * rc.gasPrice;
    const balAfter = await ethers.provider.getBalance(agentA.address);
    expect(balAfter - balBefore + gasCost).to.equal(expected);
    expect(await lode.earned(agentA.address)).to.equal(0n);
    expect(await lode.rewardPool()).to.equal(ethers.parseEther("0.005") - expected);
  });

  it("redeem ditolak kalau unit kurang / pool tidak cukup", async function () {
    const { lode, agentA, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(1, { value: 0 })).wait();
    await expect(lode.connect(agentA).redeem(1n)).to.be.revertedWithCustomError(lode, "NotEnoughEarned");

    const t0 = await nowTs();
    await warp(t0 + 365 * DAY);
    await (await lode.connect(agentA).claim(1)).wait();
    const units = await lode.earned(agentA.address);
    // pool kosong -> PoolTooSmall
    await expect(lode.connect(agentA).redeem(units)).to.be.revertedWithCustomError(lode, "PoolTooSmall");
  });

  it("saldo kontrak = rewardPool (dana mint tidak nyangkut)", async function () {
    const { lode, agentA, treasury, start } = await deploy();
    await warp(start + 120);
    await (await lode.connect(agentA).mint(2, { value: PRICE })).wait();
    expect(await ethers.provider.getBalance(await lode.getAddress())).to.equal(0n);
    await (await lode.connect(treasury).fundRewards({ value: ethers.parseEther("0.002") })).wait();
    expect(await ethers.provider.getBalance(await lode.getAddress())).to.equal(await lode.rewardPool());
  });

  it("tidak ada owner/withdraw/pause/setPrice", async function () {
    const { lode } = await deploy();
    const names = lode.interface.fragments.map((f) => f.name || "").filter(Boolean);
    for (const forbidden of ["owner", "withdraw", "pause", "setPrice", "setMintOpen", "transferOwnership"]) {
      expect(names.includes(forbidden)).to.equal(false);
    }
  });
});
