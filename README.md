# ArcShield — Decentralized Scam Registry

Built with [Arc Studio](https://studio.arc.io)

ArcShield is a decentralized scam verification marketplace built on [Arc Mainnet](https://arc.io). Anyone can register as a reporter and submit scam reports linking an X (Twitter) account to on-chain evidence. When someone wants to verify whether an account is a scammer, they search for free — a clean result costs nothing, but a verified result costs $5 USDC to unlock the full evidence. That fee splits automatically on-chain: 50% to the platform treasury, 30% to the developer, and 20% to the reporter who originally submitted the tip.

---

## Live Deployment

| | |
|--|--|
| **Live App** | https://merry-capybara-248aa2.netlify.app |
| **Network** | Arc Mainnet (Chain ID: 1482601649) |
| **Contract** | `0xa06f9E8A1312aEE15837D02B543c800174Aacef4` |
| **Deploy Tx** | `0xf5e1c9db3360710152434bd9f90fc6919af87787b9a3a4ff8b0b9723e1c92315` |
| **Explorer** | [View on Arc Explorer](https://explorer.arc.io/address/0xa06f9E8A1312aEE15837D02B543c800174Aacef4) |

---

## What It Does

**For searchers (anyone):**
- Search any X handle or wallet address for free
- Clean result = no charge, green card shown
- Verified scam = 3-second notice then $5 USDC payment unlocks the full evidence (profile link, wallet, description, evidence URL, reporter identity)
- Reported and Under Review records are hidden from public search until verified by an admin

**For reporters (registered wallets):**
- Register your wallet with your X handle and profile URL
- Submit scam reports: handle (required), profile link (required), wallet address, evidence URL, description (all optional except handle and profile link)
- Duplicate reports on the same handle are stored as corroborations — the original reporter earns the 20% reward
- Track the status of your reports (Reported / Under Review / Verified) from your dashboard
- Claim your USDC rewards any time

**For admins (treasury wallet and developer wallet):**
- Classify records: Reported → Under Review → Verified
- Delete fake or malicious records (deactivate)
- Recover wrongly deleted records (reactivate)
- Ban and unban reporters
- Search any record by handle or wallet directly from the admin panel
- Treasury wallet: update lookup fee, update treasury address
- Developer wallet: update developer wallet address
- Both roles: full access to all records and reporter directory

---

## How the Fee Split Works

Every $5 USDC payment is split automatically on-chain at the moment of payment:

| Recipient | Share | Amount |
|-----------|-------|--------|
| Treasury wallet | 50% | $2.50 |
| Developer wallet | 30% | $1.50 |
| Reporter (original submitter) | 20% | $1.00 |

Reporters accumulate rewards and claim them whenever they want using the **Claim USDC Rewards** button.

---

## Tech Stack

- **Blockchain:** Arc Mainnet (USDC as native gas token)
- **Smart Contract:** Solidity 0.8.20, OpenZeppelin 5.x
- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Wallet:** wagmi v2 + ConnectKit + viem
- **USDC:** `0x3600000000000000000000000000000000000000` (Arc Mainnet and Testnet)

---

## Development

### Prerequisites

- [Bun](https://bun.sh/) (package manager)
- [Foundry](https://getfoundry.sh/) (for contract compilation and testing)
- A wallet with USDC on Arc Mainnet or Arc Testnet

### Install

```bash
bun install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Purpose |
|----------|---------|
| `VITE_SCAM_REGISTRY_ADDRESS` | Deployed contract address |
| `VITE_NETWORK` | `testnet` or `mainnet` — controls which chain the app targets |
| `CIRCLE_API_KEY` | Circle Developer API key (required for developer-controlled wallet flows only) |
| `CIRCLE_ENTITY_SECRET` | Circle Entity Secret (required for developer-controlled wallet flows only) |
| `RPC_PROXY_BASE_URL` | Optional — Arc Studio RPC proxy (not required outside Arc Studio) |
| `RPC_PROXY_TOKEN` | Optional — Arc Studio RPC proxy token |

### Run locally

```bash
bun run dev
```

Open http://localhost:5173 in your browser.

### Build for production

```bash
bun run build
```

Output goes to `dist/`.

### Run contract tests

```bash
bun run contracts:test
```

### Lint and typecheck

```bash
bun run check
```

---

## Smart Contract

**File:** `contracts/ScamRegistry.sol`

The contract is written in Solidity 0.8.20 and inherits from OpenZeppelin's `Ownable`. Key design decisions:

- **Duplicate prevention:** a handle can only have one primary record; additional submissions are stored as corroborations
- **Pull-payment pattern:** reporter rewards accumulate in `pendingRewards[address]` and are claimed explicitly — no push payments that could be blocked
- **Status model:** every record starts as `Reported` (an allegation, not proof). Admins classify it to `UnderReview` or `Verified`. Only `Verified` records are visible to public searchers
- **Dual admin roles:** the treasury wallet (owner) and developer wallet each have a separate role. Treasury controls fees and treasury address. Developer controls developer address. Both can classify, delete, reactivate, and ban
- **Ownership sync:** `setTreasury` also calls `_transferOwnership` so treasury and Ownable owner are always the same address
- **Immutable USDC:** the USDC token address is set once at deploy time and cannot be changed

### Deploy to Arc Testnet

```bash
forge create contracts/ScamRegistry.sol:ScamRegistry \
  --rpc-url https://rpc.testnet.arc.io \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --constructor-args \
    <treasury_wallet> \
    <developer_wallet> \
    5000000
```

### Deploy to Arc Mainnet

```bash
forge create contracts/ScamRegistry.sol:ScamRegistry \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --constructor-args \
    <treasury_wallet> \
    <developer_wallet> \
    5000000
```

Constructor args:
- `initialOwner` — treasury wallet address (becomes contract owner)
- `_developer` — developer wallet address (30% fee recipient, can update own address)
- `_initialFee` — lookup fee in USDC with 6 decimals (e.g. `5000000` = $5.00)

---

## Submission — Arc Microgrants

This project was built entirely in [Arc Studio](https://studio.arc.io) for the Arc Microgrants competition. Every contract, test, and line of frontend code was written, reviewed, and deployed using Arc Studio.

- Contracts written and security-reviewed in Arc Studio
- Deployed to Arc Mainnet with real USDC moving through the fee-split logic
- Frontend built in Arc Studio and deployed to Netlify
