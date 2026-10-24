# Lodepass — pass tambang on-chain untuk pemegang Binance Agent ID (.ai)

Pass yang **hanya bisa di-mint oleh wallet yang punya Agent ID** (Binance Agentic Wallet, `.ai`).
Kepingnya bukan cuma gambar: tiap keping **menambang yield on-chain**, dan **3 keping bisa ditempa jadi 1 keping tier lebih tinggi** (supply mengecil, laju tambang naik).
Semua art digambar **kontrak itu sendiri** (SVG dari tokenId) — tanpa IPFS, tanpa server.

## Alur

```
mint keping -> mine (yield nambah tiap detik) -> claim (catat ke earned)
                     |
                     +--> forge 3 keping -> 1 keping tier atas (tier +1)
```

| hal | desain |
|---|---|
| Gate | `IAgentRegistry.balanceOf(wallet) > 0` — dibaca langsung dari registry on-chain |
| Art | 100% on-chain SVG (data-uri) |
| Admin | **tidak ada owner, pause, withdraw, setPrice** — aturan dikunci di `immutable` saat deploy |
| Uang mint | langsung diteruskan ke `treasury` di transaksi yang sama (saldo kontrak selalu 0) |
| Tier | Common 60% · Uncommon 25% · Rare 12% · Legendary 3% (deterministik dari `keccak256(tokenId)`) |
| Laju tambang | 1 / 3 / 8 / 20 unit per hari untuk tier 0 / 1 / 2 / 3 |
| Forge | 3 keping (boleh beda tier) → 1 keping dengan tier tertinggi +1, dibatasi 3 |

## Parameter

- Nama `Lodepass` · simbol `LODE`
- Supply: **3.333** · Maks per wallet: **5**
- **Keping pertama gratis** (cuma gas), sisanya `priceWei` (default 0,0015 BNB)
- Buka mint: `startTime` (immutable)

## Kontrak

`contracts/Lodepass.sol`

- `mint(uint256 quantity)` — payable, gate Agent ID, free tier, teruskan ETH ke treasury
- `pending(uint256 tokenId)` / `claim(uint256 tokenId)` — yield on-chain per keping
- `earned(address)` — total unit yang sudah diklaim (ledger on-chain, bukan token)
- `forge(uint256[3] ids)` — burn 3 keping, mint 1 keping tier atas (yield yang belum cair ikut diselamatkan)
- `tierOf` / `tierName` / `rateOf` / `svgOf` / `tokenURI`
- `totalMinted`, `totalBurned`, `mintedBy`, `freeUsed`

## Mesin nilai (kenapa keping punya harga)

1. **Supply dibatasi** 3.333; gate `.ai` bikin pembelinya set yang sempit tapi nyata.
2. **Forge 3→1 membakar supply** — tiap forge mengurangi jumlah keping di pasar.
3. **Hasil tambang bisa ditukar BNB**: `earned` (unit) ditukar lewat `redeem()` dengan harga `unitPriceWei` yang dikunci saat deploy, dibayar dari `rewardPool`.
4. **Pool diisi dari pendapatan** (`fundRewards()`): treasury menyetor sebagian hasil mint/forge/fee pasar.
5. **Pasar sendiri** dengan fee 2% → likuiditas selalu punya tempat, dan fee-nya menambah pemasukan.

Contoh dengan `unitPriceWei = 5e12` (0,000005 BNB per unit):
| tier | unit/hari | BNB/hari | 30 hari | balik modal (0,0015) |
|---|---|---|---|---|
| Common | 1 | 0,0000050 | Rp 1.837 | ±300 hari |
| Uncommon | 3 | 0,0000150 | Rp 5.511 | ±100 hari |
| Rare | 8 | 0,0000400 | Rp 14.695 | ±38 hari |
| Legendary | 20 | 0,0001000 | Rp 36.738 | ±15 hari |

Pool bersifat **terbatas** (first come): dengan 800 keping ter-mint dan pool 0,3 BNB, emisi ±0,006 BNB/hari → pool tahan ±50 hari. Bukan janji abadi — pool harus terus diisi dari pendapatan.

## Tes

```bash
npm install
npx hardhat compile
npx hardhat test
```

13 tes: jam buka, gate Agent ID, gratis-1, pembayaran, treasury & saldo kontrak 0, batas wallet,
`tokenURI` (JSON + SVG + Rate), yield per hari & claim, claim bukan pemilik, forge 3→1 + burn,
forge ditolak (bukan pemilik / id duplikat), yield tidak hangus saat forge, tier deterministik,
dan **tidak ada fungsi admin**.

## Alamat live (BSC 56)

| kontrak | alamat |
|---|---|
| Lodepass | `0x31b074C8e77e44F29df285F19d4fc76E6D927d01` |
| LodeMarket (pasar) | `0xf607c6aD07c173056B7D4D63d0c9d26Ad9D3f4E2` |
| treasury (immutable) | `0x5088fD836CD682CD3a719D35Ba93986506801FEE` |
| deployer | `0xCeE0f1901f19e7982456b68e2404992360eD2599` |

Mint dibuka 2026-10-24 14:24:02 UTC. Semua parameter di `deployments/bsc.json`.

## Deploy (BSC)

```bash
export DEPLOYER_KEY=0x...          # burner, jangan wallet utama
export TREASURY=0x...              # penerima hasil mint (immutable)
export PRICE_WEI=1500000000000000  # 0,0015 BNB (opsional)
export START_TIME=<unix ts>        # default now+1h
npx hardhat run scripts/deploy.js --network bsc
```

Registry Agent ID di BSC: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` (`balanceOf(wallet) > 0`).

## Struktur

```
contracts/Lodepass.sol                kontrak utama
contracts/mocks/MockAgentRegistry.sol registry tiruan untuk tes
test/Lodepass.test.js                13 tes
scripts/deploy.js                    deploy BSC
scripts/render_art.js                render SVG ke art/ tanpa deploy
site/index.html                      halaman mint statis
```

## Catatan jujur untuk pembeli

- Tidak ada fungsi admin: setelah deploy tidak ada yang bisa ubah harga, tutup mint, atau tarik dana.
- `earned` adalah **catatan on-chain**, bukan token yang bisa dijual — reward nyata (kalau ada) menyusul di fase berikutnya dan bakal diumumkan terpisah.
- Nilai keping di pasar sekunder tidak dijamin kontrak; itu tergantung ada/tidaknya pembeli.
- Alamat kontrak wajib dicek dari repo ini + explorer. Banyak nama mirip di luar sana.
