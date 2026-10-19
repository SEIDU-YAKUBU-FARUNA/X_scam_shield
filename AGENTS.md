# ArcShield — Decentralized Scam Registry

## Project Overview
Decentralized scam dictionary and verification marketplace.
Built entirely in Arc Studio for the Arc Microgrants competition.

**How it works:**
- Reporters register their wallet and submit scam reports (X handle + optional wallet + evidence)
- Searchers check any handle/wallet for free — clean results cost nothing
- Flagged results show a warning; the full evidence costs $5 USDC to unlock
- $5 splits on-chain: 50% treasury, 30% developer (immutable), 20% reporter (pull-payment)
- Admin (treasury wallet only) can update fee, update treasury, ban/unban reporters, delete/reactivate records

## Contract: ScamRegistry

**File:** `contracts/ScamRegistry.sol`

## Deployments

| Version | Network | Address | Status |
|---------|---------|---------|--------|
| v1 | Arc Testnet | `0x4168ed5d828ea97d47cc85e20279435460bc1c80` | Deprecated |
| v2 | Arc Testnet | `0x88aa4969c4e6581549da40dcba227198a35056e6` | Deprecated |
| v3 | Arc Testnet | `0x0d5e8fd24dc54d916bece0ad28119b71a70f85b1` | Deprecated |
| v4 | Arc Testnet | `0x1e1617223e9576aa737ff44e2593b0481ae8588f` | Deprecated |
| v5 | Arc Testnet | `0xc0a1f9c3eaf36e3cd36af13f7fef4275561ee957` | Deprecated |
| v6 | Arc Testnet | `0xa93a6225c727e5e00924d4c2538caa1217e8be53` | **Active (testnet)** |
| v1 | Arc Mainnet | (pending) | — |

## Key Addresses
- Owner / Treasury wallet (50% royalty): `0x7aDbb14b8dDF292AbFe9e7a28abc0433256f4048`
- Developer wallet (30% royalty, immutable): `0x4423ef244627b2f3d1D9587919b7c8864aBAB8dA`
- Initial lookup fee: `5000000` (= $5.00 USDC, 6 decimals)
- USDC address (Arc Testnet + Mainnet): `0x3600000000000000000000000000000000000000`

## Constructor (3 args)
`initialOwner` = treasury wallet (also becomes Ownable owner)
`_developer` = developer wallet (immutable, no setter)
`_initialFee` = 5000000 ($5.00 USDC)
```
["0x7aDbb14b8dDF292AbFe9e7a28abc0433256f4048", "0x4423ef244627b2f3d1D9587919b7c8864aBAB8dA", "5000000"]
```

## Network Switching (env-driven, no source changes needed)
Set in `.env` and restart the dev server:
- `VITE_NETWORK=testnet` → Arc Testnet (default)
- `VITE_NETWORK=mainnet` → Arc Mainnet

## Mainnet Deploy Steps

### Prerequisites
1. Complete mainnet enablement at https://console.circle.com/
2. Create a **mainnet** Standard Developer API Key in the Circle Console
3. Replace `CIRCLE_API_KEY` in `.env` with the mainnet key
4. Entity secret (`CIRCLE_ENTITY_SECRET`) carries over — same account

### Deploy the contract
5. Create a mainnet deployer wallet:
   ```
   bun run scripts/self-deploy.ts --create-wallet
   ```
6. Fund the deployer wallet with USDC on Arc Mainnet (use the Circle Console or bridge from another chain)
7. Deploy:
   ```
   bun run deploy:self ScamRegistry '["0x7aDbb14b8dDF292AbFe9e7a28abc0433256f4048","0x4423ef244627b2f3d1D9587919b7c8864aBAB8dA","5000000"]' --wallet-id <id> --wallet-address <addr> --skip-funding
   ```
8. Note the deployed contract address from the output

### Wire mainnet into the app
9. Add to `.env`:
   ```
   VITE_SCAM_REGISTRY_ADDRESS=<mainnet contract address>
   VITE_NETWORK=mainnet
   ```
10. Restart the dev server — the badge will show "Arc Mainnet"
11. Verify on https://explorer.arc.io

### After mainnet deploy
- Update the Deployments table above with the mainnet address
- Deploy the app to Hugging Face or Netlify (Integrations menu) for the public link required by the microgrant
- Push to GitHub (Integrations menu → GitHub)
- Record one example transaction hash from the first real lookup on mainnet

## Fee Split (on-chain, immutable ratio)
- 50% → treasury / owner (`0x7aDbb14b8dDF292AbFe9e7a28abc0433256f4048`)
- 30% → developer (`0x4423ef244627b2f3d1D9587919b7c8864aBAB8dA`) — immutable, no setter
- 20% → reporter (pull-payment via `claimRewards()`)

## Frontend Architecture
- `src/App.tsx` — tab shell (Verify / Earn / Admin)
- `src/config.ts` — `ACTIVE_CHAIN_ID` and `NETWORK_LABEL` driven by `VITE_NETWORK`
- `src/components/SearchPanel.tsx` — free check + paid USDC unlock + full record reveal
- `src/components/RegisterPanel.tsx` — register, submit scam, claim rewards, on-chain record history
- `src/components/AdminPanel.tsx` — treasury-only: fee/treasury management, reporter ban/unban, record delete/reactivate, reporter directory, stats
- `src/contracts.ts` — ABI + address (reads `VITE_SCAM_REGISTRY_ADDRESS`)

## Security Review Summary
All audit findings resolved:
1. `abi.encode` (not `encodePacked`) for collision-proof record keys
2. Events on all admin setter functions (`TreasuryUpdated`, `LookupFeeUpdated`, etc.)
3. `checkExists()` returns metadata only — evidence gated behind paid `lookupAndPay()`
4. Pull-payment for reporter rewards (`claimRewards`) + CEI pattern in `lookupAndPay`
5. Empty-wallet collision fixed — `walletIndex` only set when wallet is non-empty
6. `developer` is mutable — `setDeveloper()` callable only by current developer wallet, not by owner/treasury
7. `setTreasury` also calls `_transferOwnership` — `owner()` and `treasury()` always in sync

## Microgrant Submission Checklist
- [ ] Arc Studio project URL (from browser address bar)
- [ ] Live app URL (Hugging Face or Netlify)
- [ ] Mainnet contract address + example tx hash (explorer.arc.io link)
- [ ] Public GitHub repo URL
- [ ] Video walkthrough (build in Arc Studio + mainnet transaction)
- [ ] Short description of the project
- [ ] Public builder profile (GitHub / X / Farcaster)
