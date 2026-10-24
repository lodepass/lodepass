# Lodepass — an on-chain mining pass for Binance Agent ID (.ai) holders

A pass that **only a wallet holding a Binance Agent ID can mint** (Binance Agentic Wallet, `.ai`).
The piece is not just a picture: it **mines yield on-chain**, and **three pieces can be forged into one higher tier** (supply shrinks, mining rate rises).
All art is drawn by the contract itself (SVG from the tokenId) — no IPFS, no server.

## Flow

```
mint a piece -> mine (yield accrues per second) -> claim (recorded in `earned`)
                       |
                       +--> forge 3 pieces -> 1 higher tier piece (tier +1)
```

| item | design |
|---|---|
| Gate | `IAgentRegistry.balanceOf(wallet) > 0` — read straight from the on-chain registry |
| Art | 100% on-chain SVG (data URI) |
| Admin | **no owner, no pause, no withdraw, no setPrice** — rules are locked in `immutable` fields at deploy |
| Mint proceeds | forwarded to `treasury` in the same transaction (contract balance is always 0) |
| Tiers | Common 60% · Uncommon 25% · Rare 12% · Legendary 3% (deterministic from `keccak256(tokenId)`) |
| Mining rate | 1 / 3 / 8 / 20 units per day for tier 0 / 1 / 2 / 3 |
| Forge | 3 pieces (any tiers) → 1 piece at highest tier + 1, capped at 3 |

## Parameters

- Name `Lodepass` · symbol `LODE`
- Supply: **3,333** · Max per wallet: **5**
- **First piece free** (gas only), the rest cost `priceWei` (default 0.0015 BNB)
- Mint opens at `startTime` (immutable)

## Deployed on BSC (56)

| contract | address |
|---|---|
| Lodepass | `0x31b074C8e77e44F29df285F19d4fc76E6D927d01` |
| LodeMarket (secondary market) | `0xf607c6aD07c173056B7D4D63d0c9d26Ad9D3f4E2` |
| treasury (immutable) | `0x5088fD836CD682CD3a719D35Ba93986506801FEE` |
| deployer | `0xCeE0f1901f19e7982456b68e2404992360eD2599` |

Mint opened 2026-10-24 14:24:02 UTC. Every parameter is in `deployments/bsc.json`.

## Contract

`contracts/Lodepass.sol`

- `mint(uint256 quantity)` — payable, Agent ID gate, free tier, forwards ETH to the treasury
- `pending(uint256 tokenId)` / `claim(uint256 tokenId)` — per-piece on-chain yield
- `earned(address)` — total units claimed (an on-chain ledger, not a token yet)
- `redeem(uint256 units)` — swaps units for BNB out of `rewardPool`
- `fundRewards()` — anyone can top up the pool
- `forge(uint256[3] ids)` — burns 3 pieces, mints 1 higher tier (unclaimed yield is settled first)
- `tierOf` / `tierName` / `rateOf` / `svgOf` / `tokenURI`
- `totalMinted`, `totalBurned`, `mintedBy`, `freeUsed`

## Value mechanics

1. **Capped supply** of 3,333 and an `.ai` gate — a narrow but real buyer set.
2. **Forge burns supply** — every forge removes three pieces from circulation.
3. **Mining units redeem for BNB** through `redeem()` at a `unitPriceWei` locked at deploy, paid out of `rewardPool`.
4. **The pool is funded from revenue** (`fundRewards()`): the treasury sends a share of mint, forge and market fees.
5. **An in-house market** with a 2% fee gives liquidity a home and adds fee revenue.

With `unitPriceWei = 5e12` (0.000005 BNB per unit):

| tier | units/day | BNB/day | 30 days | payback at 0.0015 |
|---|---|---|---|---|
| Common | 1 | 0.0000050 | ~1,800 IDR | ~300 days |
| Uncommon | 3 | 0.0000150 | ~5,500 IDR | ~100 days |
| Rare | 8 | 0.0000400 | ~14,700 IDR | ~38 days |
| Legendary | 20 | 0.0001000 | ~36,700 IDR | ~15 days |

The pool is **finite** (first come, first served): with 800 pieces minted and a 0.3 BNB pool, emission is about 0.006 BNB/day, so the pool lasts roughly 50 days. It has to keep being topped up from revenue. No perpetual promise.

## Tests

```bash
npm install
npx hardhat compile
npx hardhat test
```

31 tests: mint window, Agent ID gate, free-first-unit, payment, treasury and zero contract balance,
wallet caps, `tokenURI` (JSON + SVG + Rate), yield accrual and claim, forge 3 to 1 with burn and fee,
unclaimed yield survival, deterministic tiers, ERC-2981 royalty, market list/buy/cancel, redeem from the pool,
and **no admin functions**. On top of that, 11 adversarial tests with real attacker contracts:
reentrancy on mint, redeem and market buy, pool drain attempts, forge double-spend, tier cap,
self-buy, expired and stale listings.

## Deploy (BSC)

```bash
export DEPLOYER_KEY=0x...          # burner, not the main wallet
export TREASURY=0x...              # immutable recipient of mint proceeds
export PRICE_WEI=1500000000000000  # 0.0015 BNB (optional)
export FORGE_FEE_WEI=500000000000000
export UNIT_PRICE_WEI=5000000000000
export START_TIME=<unix ts>        # default now+15m
npx hardhat run scripts/deploy_all.js --network bsc
```

Agent ID registry on BSC: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` (`balanceOf(wallet) > 0`).

## Layout

```
contracts/Lodepass.sol                main contract
contracts/LodeMarket.sol              secondary market (list/cancel/buy, 2% fee)
contracts/mocks/                      test registry + attacker contracts
test/                                 31 tests (functional + adversarial)
scripts/deploy_all.js                 deploy both contracts to BSC
scripts/render_art.js                 render on-chain SVG into art/
scripts/stats.py                      on-chain stats for daily reports
posts/                                announcement, thread and reply copy
site/index.html                       static mint page
```

## Honest notes for buyers

- No admin functions: after deploy nobody can change the price, close the mint or pull funds.
- `earned` is an **on-chain ledger**, not a sellable token. Real rewards, if any, come in a later phase and will be announced separately.
- Secondary value is not guaranteed by the contract; it depends on whether buyers show up.
- Always verify the contract address from this repo plus the explorer. Name clones exist.
