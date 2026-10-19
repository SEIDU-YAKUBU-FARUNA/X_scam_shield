/**
 * ArcShield — Decentralized Scam Dictionary & Verification Marketplace
 * Built with Arc Studio on Arc Mainnet
 */

import { useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Search, UserPlus, Settings } from 'lucide-react'
import { SearchPanel } from './components/SearchPanel'
import { RegisterPanel } from './components/RegisterPanel'
import { AdminPanel } from './components/AdminPanel'
import { SCAM_REGISTRY_ADDRESS, SCAM_REGISTRY_ABI } from './contracts'
import { ACTIVE_CHAIN_ID, NETWORK_LABEL } from './config'

type Tab = 'search' | 'register' | 'admin'

const BASE_NAV: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'search', label: 'Verify', icon: Search },
  { id: 'register', label: 'Earn', icon: UserPlus },
]

function Header({ tab, setTab, showAdmin }: { tab: Tab; setTab: (t: Tab) => void; showAdmin: boolean }) {
  const nav = showAdmin ? [...BASE_NAV, { id: 'admin' as Tab, label: 'Admin', icon: Settings }] : BASE_NAV
  return (
    <header
      className="sticky top-0 z-40 px-4 py-3"
      style={{
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '1px solid rgba(18,45,69,0.10)',
      }}
    >
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
        {/* Logo — Arc Studio product mark */}
        <div className="flex items-center gap-2">
          <div
            className="flex size-9 items-center justify-center rounded-xl shadow-sm"
            style={{ background: '#0f1f30' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 2L4 5.5V11C4 15.42 7.38 19.55 12 21C16.62 19.55 20 15.42 20 11V5.5L12 2Z"
                fill="white"
                fillOpacity="0.15"
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M9 12L11 14L15 10"
                stroke="white"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="display text-base font-bold" style={{ color: 'var(--ink)' }}>ArcShield</span>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: 'rgba(18,45,69,0.08)', color: 'var(--muted)' }}
          >
            {NETWORK_LABEL}
          </span>
        </div>
        <ConnectKitButton />
      </div>

      {/* Nav tabs — Admin only shown when treasury or developer wallet is connected */}
      <div className="mx-auto mt-3 flex max-w-lg gap-1 rounded-2xl p-1" style={{ background: 'rgba(18,45,69,0.06)' }}>
        {nav.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-all"
            style={{
              background: tab === id ? 'rgba(255,255,255,0.9)' : 'transparent',
              color: tab === id ? 'var(--ink)' : 'var(--subtle)',
              boxShadow: tab === id ? '0 1px 6px rgba(18,45,69,0.08)' : 'none',
            }}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
    </header>
  )
}

// Contract address banner shown when not yet deployed
function DeployBanner() {
  const isPlaceholder = SCAM_REGISTRY_ADDRESS === '0x0000000000000000000000000000000000000000'
  if (!isPlaceholder) return null
  return (
    <div
      className="mx-auto mb-4 max-w-lg rounded-xl px-4 py-3 text-sm"
      style={{
        background: 'rgba(186,43,76,0.08)',
        border: '1px solid rgba(186,43,76,0.2)',
        borderRadius: '0.75rem',
        color: 'var(--danger)',
      }}
    >
      Contract not yet deployed. Set <code className="mono text-xs">VITE_SCAM_REGISTRY_ADDRESS</code> in <code className="mono text-xs">.env</code> after deploying to Arc Mainnet.
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('search')
  const { address, isConnected } = useAccount()

  // Read treasury + developer addresses to decide whether to show the Admin tab
  const { data: treasuryAddress } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS,
    abi: SCAM_REGISTRY_ABI,
    functionName: 'treasury',
    chainId: ACTIVE_CHAIN_ID,
  })
  const { data: developerAddress } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS,
    abi: SCAM_REGISTRY_ABI,
    functionName: 'developer',
    chainId: ACTIVE_CHAIN_ID,
  })

  const isTreasury = isConnected && !!treasuryAddress &&
    address?.toLowerCase() === (treasuryAddress as string).toLowerCase()
  const isDeveloper = isConnected && !!developerAddress &&
    address?.toLowerCase() === (developerAddress as string).toLowerCase()
  const isAdmin = isTreasury || isDeveloper

  // If admin tab was active and wallet disconnects / switches, fall back to Verify
  const safeTab: Tab = tab === 'admin' && !isAdmin ? 'search' : tab

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <Header tab={safeTab} setTab={setTab} showAdmin={isAdmin} />

      <main className="mx-auto max-w-lg px-4 py-6">
        <DeployBanner />

        {safeTab === 'search' && <SearchPanel />}
        {safeTab === 'register' && <RegisterPanel />}
        {safeTab === 'admin' && <AdminPanel />}
      </main>
    </div>
  )
}
