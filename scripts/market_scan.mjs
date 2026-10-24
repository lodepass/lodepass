// scripts/market_scan.mjs — cek listing aktif di LodeMarket (pasar kita sendiri)
import { ethers } from "ethers";

const LODE = "0x31b074C8e77e44F29df285F19d4fc76E6D927d01";
const MKT = "0xf607c6aD07c173056B7D4D63d0c9d26Ad9D3f4E2";
const RPC = "https://bsc-dataseed.bnbchain.org";

const p = new ethers.JsonRpcProvider(RPC, 56, { staticNetwork: true });
const lode = new ethers.Contract(LODE, [
  "function totalMinted() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function tierName(uint256) view returns (string)",
  "function tokenURI(uint256) view returns (string)",
], p);
const market = new ethers.Contract(MKT, [
  "function listing(uint256) view returns (address seller, uint96 price, uint64 expiry)",
  "function FEE_BPS() view returns (uint256)",
], p);

const total = Number(await lode.totalMinted());
const fee = Number(await market.FEE_BPS());
const now = Math.floor(Date.now() / 1000);
const active = [];

const tasks = [];
for (let id = 1; id <= total; id++) tasks.push(id);

const CONC = 25;
for (let i = 0; i < tasks.length; i += CONC) {
  const batch = tasks.slice(i, i + CONC);
  const res = await Promise.all(batch.map(async (id) => {
    try {
      const l = await market.listing(id);
      if (l.seller && l.seller !== ethers.ZeroAddress) {
        const owner = await lode.ownerOf(id).catch(() => null);
        return { id, seller: l.seller, price: ethers.formatEther(l.price), expiry: Number(l.expiry), expired: Number(l.expiry) < now, owner, listed: owner && owner.toLowerCase() === l.seller.toLowerCase() };
      }
    } catch (e) {}
    return null;
  }));
  for (const r of res) if (r) active.push(r);
}

console.log(`totalMinted: ${total} · fee pasar: ${fee / 100}%`);
console.log(`listing aktif: ${active.length}`);
active.sort((a, b) => Number(a.price) - Number(b.price));
for (const a of active.slice(0, 15)) {
  const net = Number(a.price) * (1 - fee / 10000);
  console.log(`  #${a.id} · ${a.price} BNB · net ${net.toFixed(6)} · ${a.expired ? "KEDALUWARSA" : "aktif"} · seller ${a.seller.slice(0, 8)}…${a.listed ? "" : " (bukan pemilik lagi)"}`);
}
if (active.length) console.log(`\nfloor pasar kita: ${active[0].price} BNB`);
