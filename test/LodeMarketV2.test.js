const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRICE = ethers.parseEther("0.0015");
const FORGE_FEE = ethers.parseEther("0.0005");
const FREE_QUOTA = 1000;
const UNIT_PRICE = 1000000000000n;
const DAY = 86400;

async function setup() {
  const [deployer, seller, buyer, other, treasury] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentRegistry");
  const reg = await Mock.deploy();
  await reg.waitForDeployment();

  const Lode = await ethers.getContractFactory("Lodepass");
  const start = (await ethers.provider.getBlock("latest")).timestamp;
  const lode = await Lode.deploy(await reg.getAddress(), treasury.address, PRICE, FORGE_FEE, FREE_QUOTA, UNIT_PRICE, start + 10);
  await lode.waitForDeployment();

  const M = await ethers.getContractFactory("LodeMarketV2");
  const market = await M.deploy(await lode.getAddress(), treasury.address);
  await market.waitForDeployment();

  await (await reg.set(seller.address, 1)).wait();
  await ethers.provider.send("evm_setNextBlockTimestamp", [start + 60]);
  await ethers.provider.send("evm_mine", []);
  await (await lode.connect(seller).mint(2, { value: PRICE })).wait(); // #1 free, #2 paid
  await (await lode.connect(seller).approve(await market.getAddress(), 1)).wait();
  await (await lode.connect(seller).approve(await market.getAddress(), 2)).wait();
  return { lode, market, reg, deployer, seller, buyer, other, treasury };
}

describe("LodeMarketV2 (asks + bids)", function () {
  it("list then buy: 2% fee to treasury, rest to seller", async function () {
    const { lode, market, seller, buyer, treasury } = await setup();
    await (await market.connect(seller).list(1, PRICE, 7)).wait();
    const before = await ethers.provider.getBalance(treasury.address);
    await (await market.connect(buyer).buy(1, { value: PRICE })).wait();
    expect(await lode.ownerOf(1)).to.equal(buyer.address);
    expect((await ethers.provider.getBalance(treasury.address)) - before).to.equal(PRICE * 200n / 10000n);
  });

  it("bid is escrowed; outbid refunds the previous bidder", async function () {
    const { market, seller, buyer, other } = await setup();
    const bidA = ethers.parseEther("0.002");
    await (await market.connect(buyer).bid(1, 7, { value: bidA })).wait();
    let b = await market.bestBid(1);
    expect(b.bidder).to.equal(buyer.address);
    expect(b.amount).to.equal(bidA);

    const before = await ethers.provider.getBalance(buyer.address);
    const bidB = ethers.parseEther("0.003");
    const tx = await market.connect(other).bid(1, 7, { value: bidB });
    await tx.wait();
    const after = await ethers.provider.getBalance(buyer.address);
    expect(after - before).to.equal(bidA); // refunded
    b = await market.bestBid(1);
    expect(b.bidder).to.equal(other.address);
  });

  it("bid must beat the standing bid", async function () {
    const { market, buyer, other } = await setup();
    await (await market.connect(buyer).bid(1, 7, { value: ethers.parseEther("0.002") })).wait();
    await expect(
      market.connect(other).bid(1, 7, { value: ethers.parseEther("0.002") })
    ).to.be.revertedWithCustomError(market, "BidTooLow");
  });

  it("seller accepts a bid: nft moves, fee to treasury, rest to seller", async function () {
    const { lode, market, seller, buyer, treasury } = await setup();
    const amount = ethers.parseEther("0.004");
    await (await market.connect(buyer).bid(1, 7, { value: amount })).wait();
    const before = await ethers.provider.getBalance(treasury.address);
    await (await market.connect(seller).acceptBid(1)).wait();
    expect(await lode.ownerOf(1)).to.equal(buyer.address);
    expect((await ethers.provider.getBalance(treasury.address)) - before).to.equal(amount * 200n / 10000n);
    const b = await market.bestBid(1);
    expect(b.bidder).to.equal(ethers.ZeroAddress);
  });

  it("acceptBid needs approval for this market", async function () {
    const { lode, market, seller, buyer } = await setup();
    await (await market.connect(buyer).bid(2, 7, { value: ethers.parseEther("0.002") })).wait();
    await (await lode.connect(seller).approve(ethers.ZeroAddress, 2)).wait(); // cabut approval
    await expect(market.connect(seller).acceptBid(2)).to.be.revertedWithCustomError(market, "NotApproved");
  });

  it("owner cannot bid on their own piece; dust bid rejected", async function () {
    const { market, seller } = await setup();
    await expect(
      market.connect(seller).bid(1, 7, { value: ethers.parseEther("0.002") })
    ).to.be.revertedWithCustomError(market, "BidderIsSeller");
    await expect(market.connect(seller).bid(1, 7, { value: 0 })).to.be.revertedWithCustomError(market, "BadPrice");
  });

  it("cancelBid refunds the bidder", async function () {
    const { market, buyer } = await setup();
    const amount = ethers.parseEther("0.003");
    await (await market.connect(buyer).bid(1, 7, { value: amount })).wait();
    const before = await ethers.provider.getBalance(buyer.address);
    await (await market.connect(buyer).cancelBid(1)).wait();
    const after = await ethers.provider.getBalance(buyer.address);
    expect(after > before).to.equal(true);
    expect((await market.bestBid(1)).bidder).to.equal(ethers.ZeroAddress);
  });

  it("expired bid cannot be accepted; expired listing cannot be bought", async function () {
    const { market, seller, buyer } = await setup();
    await (await market.connect(buyer).bid(1, 1, { value: ethers.parseEther("0.002") })).wait();
    const t0 = (await ethers.provider.getBlock("latest")).timestamp;
    await ethers.provider.send("evm_setNextBlockTimestamp", [t0 + 2 * DAY]);
    await ethers.provider.send("evm_mine", []);
    await expect(market.connect(seller).acceptBid(1)).to.be.revertedWithCustomError(market, "Expired");

    await (await market.connect(seller).list(2, PRICE, 1)).wait();
    const t1 = (await ethers.provider.getBlock("latest")).timestamp;
    await ethers.provider.send("evm_setNextBlockTimestamp", [t1 + 2 * DAY]);
    await ethers.provider.send("evm_mine", []);
    await expect(market.connect(buyer).buy(2, { value: PRICE })).to.be.revertedWithCustomError(market, "Expired");
  });

  it("no admin surface: no owner/withdraw/pause/upgrade", async function () {
    const { market } = await setup();
    const names = market.interface.fragments.map((f) => (f.name || "").toLowerCase());
    for (const f of ["owner", "withdraw", "pause", "setfee", "upgradeto", "sweep"]) {
      expect(names.includes(f)).to.equal(false);
    }
    expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
  });
});
