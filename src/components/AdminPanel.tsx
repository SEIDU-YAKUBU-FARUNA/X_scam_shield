import { useState, useEffect, useRef } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { createPublicClient, http, defineChain } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { Shield, Loader2, CheckCircle, AlertTriangle, Users, DollarSign, Wallet, Trash2, ChevronDown, ChevronUp, ExternalLink, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { SCAM_REGISTRY_ABI, SCAM_REGISTRY_ADDRESS } from '../contracts'
import { formatUsdc, parseUsdc } from '../onchain-money'
import { requireChain, buildTxExplorerUrl } from '../onchain-facts'
import { ACTIVE_CHAIN_ID, NETWORK_LABEL } from '../config'

const glass = {
  card: {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(32px) saturate(180%)',
    WebkitBackdropFilter: 'blur(32px) saturate(180%)',
    border: '1px solid rgba(18,45,69,0.12)',
    borderRadius: '1.5rem',
  } as React.CSSProperties,
  inner: {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(18,45,69,0.09)',
    borderRadius: '1rem',
  } as React.CSSProperties,
}

interface ReporterEntry {
  wallet: string
  handle: string
  registered: boolean
  banned: boolean
  totalSubmissions: bigint
  totalRewardsEarned: bigint
}

interface ScamRecord {
  xHandle: string
  walletAddress: string
  evidenceUrl: string
  description: string
  reporter: string
  timestamp: bigint
  active: boolean
}

interface RecordWithKey extends ScamRecord {
  key: `0x${string}`
  reporterHandle?: string
}

function getPublicClient() {
  const fact = requireChain(ACTIVE_CHAIN_ID)
  const viemChain = defineChain({
    id: fact.chainId,
    name: fact.name,
    nativeCurrency: { name: fact.nativeCurrency.symbol, symbol: fact.nativeCurrency.symbol, decimals: fact.nativeCurrency.decimals },
    rpcUrls: { default: { http: fact.rpcUrls as [string, ...string[]] } },
  })
  return createPublicClient({ chain: viemChain, transport: http(fact.rpcUrls[0]) })
}

export function AdminPanel() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const [newFeeInput, setNewFeeInput] = useState('')
  const [newTreasury, setNewTreasury] = useState('')

  // Per-action pending tracking — stores the wallet/key currently being actioned
  const [pendingBanWallet, setPendingBanWallet] = useState<string | null>(null)
  const [pendingDeactivateKey, setPendingDeactivateKey] = useState<string | null>(null)
  const [pendingReactivateKey, setPendingReactivateKey] = useState<string | null>(null)

  // All records loaded from chain (paginated via getRecordKeysPaginated)
  const allRecordsRef = useRef<RecordWithKey[]>([])
  const [recordsVersion, setRecordsVersion] = useState(0)
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsLoaded, setRecordsLoaded] = useState(0)

  // All reporters
  const reportersRef = useRef<ReporterEntry[]>([])
  const [reportersVersion, setReportersVersion] = useState(0)
  const [isLoadingReporters, setIsLoadingReporters] = useState(false)

  const isWrongChain = isConnected && chainId !== ACTIVE_CHAIN_ID

  // Gate: treasury = owner
  const { data: treasuryAddress, refetch: refetchTreasury } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS,
    abi: SCAM_REGISTRY_ABI,
    functionName: 'treasury',
    chainId: ACTIVE_CHAIN_ID,
  })

  const isOwner = isConnected && !!treasuryAddress &&
    address?.toLowerCase() === (treasuryAddress as string).toLowerCase()

  // Stats
  const { data: lookupFeeRaw, refetch: refetchFee } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'lookupFee', chainId: ACTIVE_CHAIN_ID,
  })
  const { data: totalQueriesRaw } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'totalQueries', chainId: ACTIVE_CHAIN_ID,
  })
  const { data: totalRevenueRaw } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'totalRevenue', chainId: ACTIVE_CHAIN_ID,
  })
  const { data: currentDeveloper } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'developer', chainId: ACTIVE_CHAIN_ID,
  })

  // Write hooks
  const { writeContract: setFee, data: feeTxHash, isPending: isFeePending, error: feeError, reset: resetFee } = useWriteContract()
  const { isLoading: isFeeConfirming, isSuccess: isFeeSuccess } = useWaitForTransactionReceipt({ hash: feeTxHash })

  const { writeContract: setTreas, data: treasTxHash, isPending: isTreasPending, error: treasError, reset: resetTreas } = useWriteContract()
  const { isLoading: isTreasConfirming, isSuccess: isTreasSuccess } = useWaitForTransactionReceipt({ hash: treasTxHash })

  const { writeContract: setBan, data: banTxHash, isPending: isBanPending, error: banError } = useWriteContract()
  const { isLoading: isBanConfirming, isSuccess: isBanSuccess } = useWaitForTransactionReceipt({ hash: banTxHash })

  const { writeContract: deactivate, data: deactivateTxHash, isPending: isDeactivatePending, error: deactivateError } = useWriteContract()
  const { isLoading: isDeactivateConfirming, isSuccess: isDeactivateSuccess } = useWaitForTransactionReceipt({ hash: deactivateTxHash })

  const { writeContract: reactivate, data: reactivateTxHash, isPending: isReactivatePending, error: reactivateError } = useWriteContract()
  const { isLoading: isReactivateConfirming, isSuccess: isReactivateSuccess } = useWaitForTransactionReceipt({ hash: reactivateTxHash })

  // Clear per-card pending state once the tx confirms or errors
  useEffect(() => {
    if (isBanSuccess || banError) setPendingBanWallet(null)
  }, [isBanSuccess, banError])
  useEffect(() => {
    if (isDeactivateSuccess || deactivateError) setPendingDeactivateKey(null)
  }, [isDeactivateSuccess, deactivateError])
  useEffect(() => {
    if (isReactivateSuccess || reactivateError) setPendingReactivateKey(null)
  }, [isReactivateSuccess, reactivateError])

  // Success toasts + reload
  useEffect(() => { if (isFeeSuccess) { toast.success('Lookup fee updated!'); void refetchFee() } }, [isFeeSuccess, refetchFee])
  useEffect(() => {
    if (isTreasSuccess) {
      toast.success('Treasury wallet updated! Admin access now requires the new wallet.')
      void refetchTreasury()
    }
  }, [isTreasSuccess, refetchTreasury])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isBanSuccess) { toast.success('Ban status updated!'); loadReporters() } }, [isBanSuccess])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isDeactivateSuccess) { toast.success('Record deactivated.'); loadAllRecords() } }, [isDeactivateSuccess])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isReactivateSuccess) { toast.success('Record reactivated!'); loadAllRecords() } }, [isReactivateSuccess])

  // Error toasts
  useEffect(() => { if (feeError) toast.error(feeError.message.split('\n')[0].slice(0, 100)) }, [feeError])
  useEffect(() => { if (treasError) toast.error(treasError.message.split('\n')[0].slice(0, 100)) }, [treasError])
  useEffect(() => { if (banError) toast.error(banError.message.split('\n')[0].slice(0, 100)) }, [banError])
  useEffect(() => { if (deactivateError) toast.error(deactivateError.message.split('\n')[0].slice(0, 100)) }, [deactivateError])
  useEffect(() => { if (reactivateError) toast.error(reactivateError.message.split('\n')[0].slice(0, 100)) }, [reactivateError])

  // Load all records using paginated view — 50 per page, resolves reporter handles in parallel
  const loadAllRecords = () => {
    setIsLoadingRecords(true)
    const client = getPublicClient()
    const PAGE = 50n
    void (async () => {
      try {
        const records: RecordWithKey[] = []
        let offset = 0n
        let total = 0n
        // First page also tells us the total
        do {
          const result = await client.readContract({
            address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
            functionName: 'getRecordKeysPaginated',
            args: [offset, PAGE],
          }) as [`0x${string}`[], bigint]
          const [page, tot] = result
          total = tot
          setRecordsTotal(Number(total))
          // Fetch each record + reporter handle in parallel
          const fetched = await Promise.all(page.map(async (key) => {
            const rec = await client.readContract({
              address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
              functionName: 'getRecordByKey', args: [key],
            }) as ScamRecord
            let reporterHandle: string | undefined
            try {
              const r = await client.readContract({
                address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
                functionName: 'getReporter', args: [rec.reporter as `0x${string}`],
              }) as ReporterEntry
              if (r.registered) reporterHandle = r.handle
            } catch { /* ignore */ }
            return { ...rec, key, reporterHandle }
          }))
          records.push(...fetched)
          setRecordsLoaded(records.length)
          offset += PAGE
        } while (offset < total)
        // Sort newest first
        records.sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
        allRecordsRef.current = records
        setRecordsVersion(v => v + 1)
      } catch (e) {
        console.error('Failed to load records', e)
        toast.error('Failed to load records. Try refreshing.')
      } finally {
        setIsLoadingRecords(false)
      }
    })()
  }

  // Load all reporters
  const loadReporters = () => {
    setIsLoadingReporters(true)
    const client = getPublicClient()
    void (async () => {
      try {
        const addrs = await client.readContract({
          address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'getReporterList',
        }) as `0x${string}`[]
        const reporters = await Promise.all(addrs.map(addr =>
          client.readContract({
            address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
            functionName: 'getReporter', args: [addr],
          }) as Promise<ReporterEntry>
        ))
        reporters.sort((a, b) => Number(b.totalSubmissions) - Number(a.totalSubmissions))
        reportersRef.current = reporters
        setReportersVersion(v => v + 1)
      } catch (e) {
        console.error('Failed to load reporters', e)
      } finally {
        setIsLoadingReporters(false)
      }
    })()
  }

  // Load on mount once owner confirmed
  const loadedRef = useRef(false)
  useEffect(() => {
    if (!isOwner || loadedRef.current) return
    loadedRef.current = true
    loadAllRecords()
    loadReporters()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner])

  const formattedFee = lookupFeeRaw ? formatUsdc(lookupFeeRaw) : '—'
  const formattedRevenue = totalRevenueRaw ? formatUsdc(totalRevenueRaw) : '0.00'
  const allRecords = recordsVersion >= 0 ? allRecordsRef.current : []
  const allReporters = reportersVersion >= 0 ? reportersRef.current : []
  const activeRecords = allRecords.filter(r => r.active)
  const topReporters = [...allReporters].slice(0, 5)

  const handleSetFee = () => {
    if (!newFeeInput) return
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    try {
      const raw = parseUsdc(newFeeInput)
      setFee({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'setLookupFee', args: [raw], chainId: ACTIVE_CHAIN_ID })
    } catch { toast.error('Invalid fee amount.') }
  }

  const handleSetTreasury = () => {
    if (!newTreasury.trim()) return
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    if (!window.confirm(`Update treasury to ${newTreasury.trim()}?\n\nIMPORTANT: This also transfers admin access to the new wallet. Make sure this address is correct — you will lose admin access from your current wallet.`)) return
    setTreas({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'setTreasury', args: [newTreasury.trim() as `0x${string}`], chainId: ACTIVE_CHAIN_ID })
  }

  const handleBan = (wallet: `0x${string}`, currentlyBanned: boolean) => {
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    setPendingBanWallet(wallet)
    setBan({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'setBanStatus', args: [wallet, !currentlyBanned], chainId: ACTIVE_CHAIN_ID })
  }

  const handleDeactivate = (key: `0x${string}`, xHandle: string) => {
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    if (!window.confirm(`Delete report for @${xHandle}? You can reactivate it later.`)) return
    setPendingDeactivateKey(key)
    deactivate({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'deactivateRecord', args: [key], chainId: ACTIVE_CHAIN_ID })
  }

  const handleReactivate = (key: `0x${string}`, xHandle: string) => {
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    if (!window.confirm(`Reactivate report for @${xHandle}? It will appear in search results again.`)) return
    setPendingReactivateKey(key)
    reactivate({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'reactivateRecord', args: [key], chainId: ACTIVE_CHAIN_ID })
  }

  // ── Gate screens ──────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl p-8" style={glass.card}>
        <Shield className="size-8" style={{ color: 'var(--accent)' }} />
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect the treasury wallet to access the admin panel.</p>
        <ConnectKitButton />
      </div>
    )
  }
  if (isWrongChain) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl p-8" style={glass.card}>
        <AlertTriangle className="size-8" style={{ color: 'var(--danger)' }} />
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Please switch to {NETWORK_LABEL}.</p>
        <button onClick={() => switchChain({ chainId: ACTIVE_CHAIN_ID })}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
          Switch to {NETWORK_LABEL}
        </button>
      </div>
    )
  }
  if (!isOwner) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl p-8" style={glass.card}>
        <Shield className="size-8" style={{ color: 'var(--subtle)' }} />
        <p className="text-sm" style={{ color: 'var(--muted)' }}>This panel is restricted to the treasury wallet.</p>
        <p className="mono text-xs" style={{ color: 'var(--subtle)' }}>
          Connect: {treasuryAddress ? `${(treasuryAddress as string).slice(0, 6)}...${(treasuryAddress as string).slice(-4)}` : '—'}
        </p>
      </div>
    )
  }

  // ── Admin UI ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">

      {/* Stats */}
      <div className="rounded-3xl p-6" style={glass.card}>
        <div className="mb-4 flex items-center gap-2">
          <Shield className="size-5" style={{ color: 'var(--accent)' }} />
          <span className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Admin Dashboard</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Active Records" value={String(activeRecords.length)} />
          <StatCard label="Total Queries" value={String(totalQueriesRaw ?? 0)} />
          <StatCard label="Total Fees Collected" value={`$${formattedRevenue}`} />
          <StatCard label="Current Fee" value={`$${formattedFee}`} />
        </div>
      </div>

      {/* Fee management */}
      <div className="rounded-2xl p-5" style={glass.card}>
        <div className="mb-3 flex items-center gap-2">
          <DollarSign className="size-4" style={{ color: 'var(--accent)' }} />
          <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Lookup Fee</span>
        </div>
        <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
          Current: <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>${formattedFee} USDC</span>. Split is always 50% treasury / 30% developer / 20% reporter.
        </p>
        <div className="flex gap-2">
          <input type="number" min="0.01" step="0.01" value={newFeeInput}
            onChange={(e) => { setNewFeeInput(e.target.value); if (isFeeSuccess) resetFee() }}
            placeholder="New fee (e.g. 5.00)"
            className="flex-1 rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(18,45,69,0.12)', color: 'var(--ink)' }} />
          <button onClick={handleSetFee} disabled={!newFeeInput || isFeePending || isFeeConfirming}
            className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)' }}>
            {isFeePending || isFeeConfirming ? <Loader2 className="size-4 animate-spin" /> : isFeeSuccess ? <CheckCircle className="size-4" /> : null}
            {isFeePending ? 'Confirm…' : isFeeConfirming ? 'Saving…' : isFeeSuccess ? 'Updated' : 'Update'}
          </button>
        </div>
      </div>

      {/* Developer wallet — read-only, permanent */}
      <div className="rounded-2xl p-5" style={glass.card}>
        <div className="mb-2 flex items-center gap-2">
          <Wallet className="size-4" style={{ color: 'var(--accent)' }} />
          <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Developer Wallet (30%) — Permanent</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>This address is immutable and cannot be changed after deploy.</p>
        <p className="mono mt-2 text-xs break-all rounded-xl px-4 py-3"
          style={{ background: 'rgba(18,45,69,0.04)', border: '1px solid rgba(18,45,69,0.08)', color: 'var(--ink)' }}>
          {currentDeveloper ? String(currentDeveloper) : '—'}
        </p>
      </div>

      {/* Treasury wallet */}
      <div className="rounded-2xl p-5" style={glass.card}>
        <div className="mb-3 flex items-center gap-2">
          <Wallet className="size-4" style={{ color: 'var(--accent)' }} />
          <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Treasury Wallet (50%)</span>
        </div>
        <p className="mb-3 mono text-xs break-all" style={{ color: 'var(--muted)' }}>
          Current: {treasuryAddress ? String(treasuryAddress) : '—'}
        </p>
        <div className="mb-2 flex items-start gap-2 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(186,43,76,0.05)', border: '1px solid rgba(186,43,76,0.15)' }}>
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--danger)' }} />
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            Updating treasury also transfers admin access to the new wallet. You will lose admin access from your current wallet.
          </p>
        </div>
        <div className="flex gap-2">
          <input type="text" value={newTreasury} onChange={(e) => { setNewTreasury(e.target.value); if (isTreasSuccess) resetTreas() }}
            placeholder="New 0x address…"
            className="mono flex-1 rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(18,45,69,0.12)', color: 'var(--ink)' }} />
          <button onClick={handleSetTreasury} disabled={!newTreasury.trim() || isTreasPending || isTreasConfirming}
            className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)' }}>
            {isTreasPending || isTreasConfirming ? <Loader2 className="size-4 animate-spin" /> : isTreasSuccess ? <CheckCircle className="size-4" /> : null}
            {isTreasPending ? 'Confirm…' : isTreasConfirming ? 'Saving…' : isTreasSuccess ? 'Updated' : 'Update'}
          </button>
        </div>
      </div>

      {/* All records — paginated load, per-record action state */}
      <div className="rounded-2xl p-5" style={glass.card}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="size-4" style={{ color: 'var(--accent)' }} />
            <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>All Scam Records</span>
          </div>
          <div className="flex items-center gap-2">
            {isLoadingRecords && (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                <Loader2 className="inline size-3 animate-spin mr-1" />
                {recordsLoaded}/{recordsTotal}
              </span>
            )}
            <span className="rounded-full px-2.5 py-0.5 text-xs font-bold"
              style={{ background: 'rgba(186,43,76,0.1)', color: 'var(--danger)' }}>
              {activeRecords.length} active
            </span>
            <button onClick={loadAllRecords} className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
              <RotateCcw className="size-3" /> Refresh
            </button>
          </div>
        </div>

        {allRecords.length === 0 && !isLoadingRecords && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No records yet.</p>
        )}

        <div className="flex flex-col gap-3">
          {allRecords.map((rec) => (
            <RecordCard
              key={rec.key}
              record={rec}
              onDeactivate={handleDeactivate}
              onReactivate={handleReactivate}
              isThisDeactivateBusy={pendingDeactivateKey === rec.key && (isDeactivatePending || isDeactivateConfirming)}
              isThisReactivateBusy={pendingReactivateKey === rec.key && (isReactivatePending || isReactivateConfirming)}
              deactivateTxHash={pendingDeactivateKey === rec.key ? deactivateTxHash : undefined}
              reactivateTxHash={pendingReactivateKey === rec.key ? reactivateTxHash : undefined}
            />
          ))}
        </div>
      </div>

      {/* Reporter directory */}
      <div className="rounded-2xl p-5" style={glass.card}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="size-4" style={{ color: 'var(--accent)' }} />
            <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Reporter Directory</span>
          </div>
          <div className="flex items-center gap-2">
            {isLoadingReporters && <Loader2 className="size-3.5 animate-spin" style={{ color: 'var(--subtle)' }} />}
            <span className="rounded-full px-2.5 py-0.5 text-xs font-bold"
              style={{ background: 'rgba(26,128,71,0.12)', color: 'var(--success)' }}>
              {allReporters.length}
            </span>
            <button onClick={loadReporters} className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
              <RotateCcw className="size-3" /> Refresh
            </button>
          </div>
        </div>

        {/* Top reporters leaderboard */}
        {topReporters.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
              Top Reporters by Submissions
            </p>
            <div className="flex flex-col gap-2">
              {topReporters.map((r, i) => (
                <div key={r.wallet} className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{ background: i === 0 ? 'rgba(26,128,71,0.08)' : 'rgba(18,45,69,0.04)', border: '1px solid rgba(18,45,69,0.07)' }}>
                  <span className="text-xs font-bold tabular-nums w-4 shrink-0" style={{ color: 'var(--subtle)' }}>#{i + 1}</span>
                  <span className="font-semibold text-sm flex-1" style={{ color: 'var(--ink)' }}>@{r.handle}</span>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>{String(r.totalSubmissions)} reports</span>
                  {r.banned && <span className="rounded-full px-1.5 py-0.5 text-xs" style={{ background: 'rgba(186,43,76,0.1)', color: 'var(--danger)' }}>Banned</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {allReporters.length === 0 && !isLoadingReporters && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No reporters registered yet.</p>
        )}

        <div className="flex flex-col gap-2">
          {allReporters.map((r) => (
            <ReporterCard
              key={r.wallet}
              reporter={r}
              onBan={handleBan}
              isThisBanBusy={pendingBanWallet === r.wallet && (isBanPending || isBanConfirming)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────

function RecordCard({
  record, onDeactivate, onReactivate, isThisDeactivateBusy, isThisReactivateBusy, deactivateTxHash, reactivateTxHash,
}: {
  record: RecordWithKey
  onDeactivate: (key: `0x${string}`, handle: string) => void
  onReactivate: (key: `0x${string}`, handle: string) => void
  isThisDeactivateBusy: boolean
  isThisReactivateBusy: boolean
  deactivateTxHash?: `0x${string}`
  reactivateTxHash?: `0x${string}`
}) {
  const [expanded, setExpanded] = useState(false)
  const deactivateTxUrl = deactivateTxHash ? buildTxExplorerUrl(ACTIVE_CHAIN_ID, deactivateTxHash) : undefined
  const reactivateTxUrl = reactivateTxHash ? buildTxExplorerUrl(ACTIVE_CHAIN_ID, reactivateTxHash) : undefined

  return (
    <div className="rounded-xl p-4"
      style={{
        background: record.active ? 'rgba(255,255,255,0.45)' : 'rgba(186,43,76,0.04)',
        border: `1px solid ${record.active ? 'rgba(18,45,69,0.09)' : 'rgba(186,43,76,0.2)'}`,
        borderRadius: '0.75rem',
        opacity: record.active ? 1 : 0.75,
      }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>@{record.xHandle}</span>
            {record.active
              ? <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(26,128,71,0.1)', color: 'var(--success)' }}>Active</span>
              : <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(186,43,76,0.1)', color: 'var(--danger)' }}>Deactivated</span>
            }
            {record.walletAddress && (
              <span className="mono rounded px-1.5 py-0.5 text-xs" style={{ background: 'rgba(18,45,69,0.07)', color: 'var(--muted)' }}>
                {record.walletAddress.slice(0, 6)}…{record.walletAddress.slice(-4)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
            Reported by:{' '}
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>
              {record.reporterHandle ? `@${record.reporterHandle}` : 'unknown'}
            </span>
            {' · '}
            <span className="mono">{record.reporter.slice(0, 6)}…{record.reporter.slice(-4)}</span>
            {' · '}
            {new Date(Number(record.timestamp) * 1000).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setExpanded(e => !e)} className="rounded-lg p-1.5"
            style={{ background: 'rgba(18,45,69,0.06)', color: 'var(--subtle)' }}>
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          {record.active ? (
            <button onClick={() => onDeactivate(record.key, record.xHandle)}
              disabled={isThisDeactivateBusy}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-40"
              style={{ background: 'var(--danger)' }}>
              {isThisDeactivateBusy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              {isThisDeactivateBusy ? 'Deleting…' : 'Delete'}
            </button>
          ) : (
            <button onClick={() => onReactivate(record.key, record.xHandle)}
              disabled={isThisReactivateBusy}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-40"
              style={{ background: 'var(--success)' }}>
              {isThisReactivateBusy ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle className="size-3" />}
              {isThisReactivateBusy ? 'Reactivating…' : 'Reactivate'}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2 text-xs">
          {record.description && (
            <p style={{ color: 'var(--muted)' }}>{record.description}</p>
          )}
          {record.evidenceUrl && (
            <a href={record.evidenceUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1" style={{ color: 'var(--accent)' }}>
              <ExternalLink className="size-3" /> Evidence link
            </a>
          )}
          <p className="mono break-all" style={{ color: 'var(--subtle)' }}>Key: {record.key}</p>
          {deactivateTxUrl && (
            <a href={deactivateTxUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1" style={{ color: 'var(--accent-hover)' }}>
              <ExternalLink className="size-3" /> Deactivation tx
            </a>
          )}
          {reactivateTxUrl && (
            <a href={reactivateTxUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1" style={{ color: 'var(--success)' }}>
              <ExternalLink className="size-3" /> Reactivation tx
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function ReporterCard({
  reporter: r, onBan, isThisBanBusy,
}: {
  reporter: ReporterEntry
  onBan: (wallet: `0x${string}`, banned: boolean) => void
  isThisBanBusy: boolean
}) {
  return (
    <div className="rounded-xl p-3"
      style={{
        background: r.banned ? 'rgba(186,43,76,0.04)' : 'rgba(255,255,255,0.45)',
        border: `1px solid ${r.banned ? 'rgba(186,43,76,0.15)' : 'rgba(18,45,69,0.09)'}`,
        borderRadius: '0.75rem',
      }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>@{r.handle}</p>
            {r.banned && <span className="rounded-full px-1.5 py-0.5 text-xs" style={{ background: 'rgba(186,43,76,0.1)', color: 'var(--danger)' }}>Banned</span>}
          </div>
          <p className="mono text-xs mt-0.5 truncate" style={{ color: 'var(--subtle)' }}>{r.wallet}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {String(r.totalSubmissions)} reports · ${formatUsdc(r.totalRewardsEarned)} earned
          </p>
        </div>
        <button onClick={() => onBan(r.wallet as `0x${string}`, r.banned)} disabled={isThisBanBusy}
          className="shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-40"
          style={{ background: r.banned ? 'var(--success)' : 'var(--danger)' }}>
          {isThisBanBusy
            ? <Loader2 className="size-3 animate-spin" />
            : r.banned
              ? <><CheckCircle className="size-3" /> Unban</>
              : <><Trash2 className="size-3" /> Ban</>
          }
        </button>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(18,45,69,0.09)', borderRadius: '0.75rem' }}>
      <p className="text-xs" style={{ color: 'var(--subtle)' }}>{label}</p>
      <p className="display mt-0.5 text-lg font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{value}</p>
    </div>
  )
}
