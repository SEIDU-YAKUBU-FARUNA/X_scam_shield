import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { createPublicClient, http } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { Shield, Loader2, CheckCircle, AlertTriangle, Users, DollarSign, Wallet, Trash2, ChevronDown, ChevronUp, ExternalLink, RotateCcw, Clock, Eye, Search, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { SCAM_REGISTRY_ABI, SCAM_REGISTRY_ADDRESS, USDC_DECIMALS } from '../contracts'
import { ACTIVE_CHAIN_ID, NETWORK_LABEL, ARC_MAINNET_CHAIN_ID } from '../config'

type RecordStatusValue = 0 | 1 | 2

const EXPLORER_TX = ACTIVE_CHAIN_ID === ARC_MAINNET_CHAIN_ID
  ? 'https://explorer.arc.io/tx/'
  : 'https://explorer.testnet.arc.io/tx/'

const ARC_RPC_URL = ACTIVE_CHAIN_ID === ARC_MAINNET_CHAIN_ID
  ? 'https://rpc.mainnet.arc.io'
  : 'https://rpc.testnet.arc.io'

function formatUsdc(raw: bigint): string {
  return (Number(raw) / 10 ** USDC_DECIMALS).toFixed(2)
}
function parseUsdc(val: string): bigint {
  return BigInt(Math.round(parseFloat(val) * 10 ** USDC_DECIMALS))
}

const PAGE_SIZE = 50n

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
  profileUrl: string
  registered: boolean
  banned: boolean
  totalSubmissions: bigint
  totalRewardsEarned: bigint
}

interface ScamRecord {
  xHandle: string
  walletAddress: string
  profileLink: string
  evidenceUrl: string
  description: string
  reporter: string
  timestamp: bigint
  active: boolean
  status: number  // 0=Reported, 1=UnderReview, 2=Verified
  corroborationCount: bigint
}

interface RecordWithKey extends ScamRecord {
  key: `0x${string}`
  reporterHandle?: string
  reporterProfileUrl?: string  // Reporter's own X profile link (fetched from getReporter)
}

function getPublicClient() {
  return createPublicClient({ transport: http(ARC_RPC_URL) })
}

export function AdminPanel() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const [newFeeInput, setNewFeeInput] = useState('')
  const [newTreasury, setNewTreasury] = useState('')
  const [newDevInput, setNewDevInput] = useState('')

  // Per-action pending tracking — stores the wallet/key currently being actioned
  const [pendingBanWallet, setPendingBanWallet] = useState<string | null>(null)
  const [pendingDeactivateKey, setPendingDeactivateKey] = useState<string | null>(null)
  const [pendingReactivateKey, setPendingReactivateKey] = useState<string | null>(null)
  const [pendingStatusKey, setPendingStatusKey] = useState<string | null>(null)

  // Admin record search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'found' | 'not-found'>('idle')
  const [searchedRecord, setSearchedRecord] = useState<RecordWithKey | null>(null)

  // Records: lazy-loaded page by page
  const allRecordsRef = useRef<RecordWithKey[]>([])
  const [recordsVersion, setRecordsVersion] = useState(0)
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)
  const [recordsOffset, setRecordsOffset] = useState(0)
  const [recordsTotal, setRecordsTotal] = useState<number | null>(null)

  // Reporters: lazy-loaded page by page
  const allReportersRef = useRef<ReporterEntry[]>([])
  const [reportersVersion, setReportersVersion] = useState(0)
  const [isLoadingReporters, setIsLoadingReporters] = useState(false)
  const [reportersOffset, setReportersOffset] = useState(0)
  const [reportersTotal, setReportersTotal] = useState<number | null>(null)

  const isWrongChain = isConnected && chainId !== ACTIVE_CHAIN_ID

  // Gate: either treasury or developer can access
  const { data: treasuryAddress, refetch: refetchTreasury } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'treasury', chainId: ACTIVE_CHAIN_ID,
  })
  const { data: developerAddress, refetch: refetchDeveloper } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'developer', chainId: ACTIVE_CHAIN_ID,
  })

  const isTreasury = isConnected && !!treasuryAddress &&
    address?.toLowerCase() === (treasuryAddress as string).toLowerCase()
  const isDeveloper = isConnected && !!developerAddress &&
    address?.toLowerCase() === (developerAddress as string).toLowerCase()
  const isOwner = isTreasury || isDeveloper

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

  const { writeContract: setDev, data: devTxHash, isPending: isDevPending, error: devError, reset: resetDev } = useWriteContract()
  const { isLoading: isDevConfirming, isSuccess: isDevSuccess } = useWaitForTransactionReceipt({ hash: devTxHash })

  const { writeContract: setBan, data: banTxHash, isPending: isBanPending, error: banError } = useWriteContract()
  const { isLoading: isBanConfirming, isSuccess: isBanSuccess } = useWaitForTransactionReceipt({ hash: banTxHash })

  const { writeContract: deactivate, data: deactivateTxHash, isPending: isDeactivatePending, error: deactivateError } = useWriteContract()
  const { isLoading: isDeactivateConfirming, isSuccess: isDeactivateSuccess } = useWaitForTransactionReceipt({ hash: deactivateTxHash })

  const { writeContract: reactivate, data: reactivateTxHash, isPending: isReactivatePending, error: reactivateError } = useWriteContract()
  const { isLoading: isReactivateConfirming, isSuccess: isReactivateSuccess } = useWaitForTransactionReceipt({ hash: reactivateTxHash })

  const { writeContract: setStatus, data: statusTxHash, isPending: isStatusPending, error: statusError } = useWriteContract()
  const { isLoading: isStatusConfirming, isSuccess: isStatusSuccess } = useWaitForTransactionReceipt({ hash: statusTxHash })

  // ── Lazy record loader — fetches one page (PAGE_SIZE) at a time ─────
  const loadRecordPage = useCallback((offset: number, reset = false) => {
    setIsLoadingRecords(true)
    const client = getPublicClient()
    void (async () => {
      try {
        const result = await client.readContract({
          address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
          functionName: 'getRecordKeysPaginated',
          args: [BigInt(offset), PAGE_SIZE],
        }) as [`0x${string}`[], bigint]
        const [page, total] = result
        setRecordsTotal(Number(total))

        // Fetch each record + reporter handle in parallel
        const fetched = await Promise.all(page.map(async (key) => {
          const rec = await client.readContract({
            address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
            functionName: 'getRecordByKey', args: [key],
          }) as ScamRecord
          let reporterHandle: string | undefined
          let reporterProfileUrl: string | undefined
          try {
            // Load the reporter's registered identity so the admin can see
            // who submitted this report — their handle and their X profile link
            const r = await client.readContract({
              address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
              functionName: 'getReporter', args: [rec.reporter as `0x${string}`],
            }) as ReporterEntry
            if (r.registered) {
              reporterHandle = r.handle
              reporterProfileUrl = r.profileUrl
            }
          } catch { /* ignore */ }
          return { ...rec, key, reporterHandle, reporterProfileUrl }
        }))

        // Sort newest-first within this batch then merge
        fetched.sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
        if (reset) {
          allRecordsRef.current = fetched
        } else {
          allRecordsRef.current = [...allRecordsRef.current, ...fetched]
        }
        setRecordsOffset(offset + fetched.length)
        setRecordsVersion(v => v + 1)
      } catch (e) {
        console.error('Failed to load records', e)
        toast.error('Failed to load records. Try refreshing.')
      } finally {
        setIsLoadingRecords(false)
      }
    })()
  }, [])

  // ── Lazy reporter loader — fetches one page (PAGE_SIZE) at a time ───
  const loadReporterPage = useCallback((offset: number, reset = false) => {
    setIsLoadingReporters(true)
    const client = getPublicClient()
    void (async () => {
      try {
        const result = await client.readContract({
          address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
          functionName: 'getReporterListPaginated',
          args: [BigInt(offset), PAGE_SIZE],
        }) as [`0x${string}`[], bigint]
        const [page, total] = result
        setReportersTotal(Number(total))

        const reporters = await Promise.all(page.map(addr =>
          client.readContract({
            address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
            functionName: 'getReporter', args: [addr],
          }) as Promise<ReporterEntry>
        ))
        reporters.sort((a, b) => Number(b.totalSubmissions) - Number(a.totalSubmissions))

        if (reset) {
          allReportersRef.current = reporters
        } else {
          allReportersRef.current = [...allReportersRef.current, ...reporters]
        }
        setReportersOffset(offset + reporters.length)
        setReportersVersion(v => v + 1)
      } catch (e) {
        console.error('Failed to load reporters', e)
        toast.error('Failed to load reporters. Try refreshing.')
      } finally {
        setIsLoadingReporters(false)
      }
    })()
  }, [])

  // Load first page once owner confirmed
  const loadedRef = useRef(false)
  useEffect(() => {
    if (!isOwner || loadedRef.current) return
    loadedRef.current = true
    loadRecordPage(0, true)
    loadReporterPage(0, true)
  }, [isOwner, loadRecordPage, loadReporterPage])

  // Per-card busy state: clear when tx confirms or errors
  useEffect(() => { if (isBanSuccess || banError) setPendingBanWallet(null) }, [isBanSuccess, banError])
  useEffect(() => { if (isDeactivateSuccess || deactivateError) setPendingDeactivateKey(null) }, [isDeactivateSuccess, deactivateError])
  useEffect(() => { if (isReactivateSuccess || reactivateError) setPendingReactivateKey(null) }, [isReactivateSuccess, reactivateError])

  // Success toasts + reload
  useEffect(() => { if (isFeeSuccess) { toast.success('Lookup fee updated!'); void refetchFee() } }, [isFeeSuccess, refetchFee])
  useEffect(() => {
    if (isTreasSuccess) {
      toast.success('Treasury wallet updated! Admin access now requires the new wallet.')
      void refetchTreasury()
    }
  }, [isTreasSuccess, refetchTreasury])
  useEffect(() => {
    if (isDevSuccess) {
      toast.success('Developer wallet updated!')
      void refetchDeveloper()
    }
  }, [isDevSuccess, refetchDeveloper])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isBanSuccess) { toast.success('Ban status updated!'); loadReporterPage(0, true); setReportersOffset(0) } }, [isBanSuccess])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isDeactivateSuccess) { toast.success('Record deactivated.'); loadRecordPage(0, true); setRecordsOffset(0) } }, [isDeactivateSuccess])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isReactivateSuccess) { toast.success('Record reactivated!'); loadRecordPage(0, true); setRecordsOffset(0) } }, [isReactivateSuccess])

  // Status effect
  useEffect(() => { if (isStatusSuccess || statusError) setPendingStatusKey(null) }, [isStatusSuccess, statusError])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isStatusSuccess) { toast.success('Record status updated!'); loadRecordPage(0, true); setRecordsOffset(0) } }, [isStatusSuccess])

  // Error toasts
  useEffect(() => { if (feeError) toast.error(feeError.message.split('\n')[0].slice(0, 100)) }, [feeError])
  useEffect(() => { if (treasError) toast.error(treasError.message.split('\n')[0].slice(0, 100)) }, [treasError])
  useEffect(() => { if (devError) toast.error(devError.message.split('\n')[0].slice(0, 100)) }, [devError])
  useEffect(() => { if (banError) toast.error(banError.message.split('\n')[0].slice(0, 100)) }, [banError])
  useEffect(() => { if (deactivateError) toast.error(deactivateError.message.split('\n')[0].slice(0, 100)) }, [deactivateError])
  useEffect(() => { if (reactivateError) toast.error(reactivateError.message.split('\n')[0].slice(0, 100)) }, [reactivateError])
  useEffect(() => { if (statusError) toast.error(statusError.message.split('\n')[0].slice(0, 100)) }, [statusError])

  const formattedFee     = lookupFeeRaw ? formatUsdc(lookupFeeRaw) : '—'
  const formattedRevenue = totalRevenueRaw ? formatUsdc(totalRevenueRaw) : '0.00'
  const allRecords       = recordsVersion >= 0 ? allRecordsRef.current : []
  const allReporters     = reportersVersion >= 0 ? allReportersRef.current : []
  const activeRecords    = allRecords.filter(r => r.active)
  const topReporters     = [...allReporters].slice(0, 5)
  const hasMoreRecords   = recordsTotal !== null && recordsOffset < recordsTotal
  const hasMoreReporters = reportersTotal !== null && reportersOffset < reportersTotal

  const handleSetFee = () => {
    if (!newFeeInput) return
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    try {
      const raw = parseUsdc(newFeeInput)
      setFee({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'setLookupFee', args: [raw], chainId: ACTIVE_CHAIN_ID })
    } catch { toast.error('Invalid fee amount.') }
  }

  const handleSetDeveloper = () => {
    if (!newDevInput.trim()) return
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    if (!window.confirm(`Update developer wallet to ${newDevInput.trim()}?\n\nYou will lose developer admin access from your current wallet.`)) return
    setDev({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'setDeveloper', args: [newDevInput.trim() as `0x${string}`], chainId: ACTIVE_CHAIN_ID })
  }

  const handleSetTreasury = () => {
    if (!newTreasury.trim()) return
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    if (!window.confirm(`Update treasury to ${newTreasury.trim()}?\n\nIMPORTANT: This transfers admin access to the new wallet. Make sure this address is correct.`)) return
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

  const handleSetStatus = (key: `0x${string}`, newStatus: RecordStatusValue) => {
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    setPendingStatusKey(key)
    setStatus({
      address: SCAM_REGISTRY_ADDRESS,
      abi: SCAM_REGISTRY_ABI,
      functionName: 'setRecordStatus',
      args: [key, newStatus],
      chainId: ACTIVE_CHAIN_ID,
    })
  }

  const handleAdminSearch = async () => {
    const q = searchQuery.trim().replace(/^@+/, '').toLowerCase()
    if (!q) return
    setSearchState('searching')
    setSearchedRecord(null)
    const client = getPublicClient()
    try {
      const result = await client.readContract({
        address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
        functionName: 'checkExists', args: [q],
      }) as [boolean, `0x${string}`, bigint, number, bigint]
      if (!result[0]) { setSearchState('not-found'); return }
      // Get the record key via handleIndex or walletIndex
      let key = await client.readContract({
        address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
        functionName: 'handleIndex', args: [q],
      })
      const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'
      if (!key || key === ZERO) {
        key = await client.readContract({
          address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
          functionName: 'walletIndex', args: [q],
        })
      }
      if (!key || key === ZERO) { setSearchState('not-found'); return }
      const rec = await client.readContract({
        address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
        functionName: 'getRecordByKey', args: [key],
      }) as ScamRecord
      let reporterHandle: string | undefined
      let reporterProfileUrl: string | undefined
      try {
        // Fetch reporter identity so admin can see who submitted this report
        const r = await client.readContract({
          address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI,
          functionName: 'getReporter', args: [rec.reporter as `0x${string}`],
        }) as ReporterEntry
        if (r.registered) {
          reporterHandle = r.handle
          reporterProfileUrl = r.profileUrl
        }
      } catch { /* ignore */ }
      setSearchedRecord({ ...rec, key, reporterHandle, reporterProfileUrl })
      setSearchState('found')
    } catch (e) {
      toast.error('Search failed. Try again.')
      console.error(e)
      setSearchState('idle')
    }
  }

  // ── Gate screens ──────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl p-8" style={glass.card}>
        <Shield className="size-8" style={{ color: 'var(--accent)' }} />
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect the treasury or developer wallet to access the admin panel.</p>
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
        <p className="text-sm" style={{ color: 'var(--muted)' }}>This panel is restricted to the treasury or developer wallet.</p>
        <div className="flex flex-col gap-1 text-center">
          <p className="mono text-xs" style={{ color: 'var(--subtle)' }}>
            Treasury: {treasuryAddress ? `${(treasuryAddress as string).slice(0, 6)}...${(treasuryAddress as string).slice(-4)}` : '—'}
          </p>
          <p className="mono text-xs" style={{ color: 'var(--subtle)' }}>
            Developer: {developerAddress ? `${(developerAddress as string).slice(0, 6)}...${(developerAddress as string).slice(-4)}` : '—'}
          </p>
        </div>
      </div>
    )
  }

  // ── Admin UI ─────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* Stats */}
      <div className="rounded-3xl p-6" style={glass.card}>
        <div className="mb-4 flex items-center gap-2">
          <Shield className="size-5" style={{ color: 'var(--accent)' }} />
          <span className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Admin Dashboard</span>
          <span className="ml-auto rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ background: isTreasury ? 'rgba(26,128,71,0.1)' : 'rgba(18,45,69,0.07)', color: isTreasury ? 'var(--success)' : 'var(--subtle)' }}>
            {isTreasury ? 'Treasury' : 'Developer'} access
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Active Records" value={recordsTotal !== null ? String(activeRecords.length) : '…'} />
          <StatCard label="Total Queries" value={String(totalQueriesRaw ?? '…')} />
          <StatCard label="Total Fees Collected" value={totalRevenueRaw ? `$${formattedRevenue}` : '…'} />
          <StatCard label="Current Fee" value={lookupFeeRaw ? `$${formattedFee}` : '…'} />
        </div>
      </div>

      {/* Lookup Fee — treasury can update, developer view-only */}
      <div className="rounded-2xl p-5" style={glass.card}>
        <div className="mb-3 flex items-center gap-2">
          <DollarSign className="size-4" style={{ color: 'var(--accent)' }} />
          <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Lookup Fee</span>
          {isDeveloper && !isTreasury && (
            <span className="ml-auto rounded-full px-2 py-0.5 text-xs" style={{ background: 'rgba(18,45,69,0.07)', color: 'var(--subtle)' }}>View only</span>
          )}
        </div>
        <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
          Current: <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>${formattedFee} USDC</span>. Split is always 50% treasury / 30% developer / 20% reporter.
        </p>
        {isTreasury && (
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
        )}
      </div>

      {/* Developer Wallet — developer can update own wallet; treasury sees read-only */}
      <div className="rounded-2xl p-5" style={glass.card}>
        <div className="mb-2 flex items-center gap-2">
          <Wallet className="size-4" style={{ color: 'var(--accent)' }} />
          <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Developer Wallet (30%)</span>
          {isTreasury && !isDeveloper && (
            <span className="ml-auto rounded-full px-2 py-0.5 text-xs" style={{ background: 'rgba(18,45,69,0.07)', color: 'var(--subtle)' }}>View only</span>
          )}
        </div>
        <p className="mb-2 mono text-xs break-all" style={{ color: 'var(--muted)' }}>
          Current: {currentDeveloper ? String(currentDeveloper) : '—'}
        </p>
        {isDeveloper && (
          <>
            <div className="mb-2 flex items-start gap-2 rounded-xl px-3 py-2.5"
              style={{ background: 'rgba(186,43,76,0.05)', border: '1px solid rgba(186,43,76,0.15)' }}>
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--danger)' }} />
              <p className="text-xs" style={{ color: 'var(--danger)' }}>
                Updating your wallet means you lose developer access from your current wallet.
              </p>
            </div>
            <div className="flex gap-2">
              <input type="text" value={newDevInput} onChange={(e) => { setNewDevInput(e.target.value); if (isDevSuccess) resetDev() }}
                placeholder="New 0x address…"
                className="mono flex-1 rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(18,45,69,0.12)', color: 'var(--ink)' }} />
              <button onClick={handleSetDeveloper} disabled={!newDevInput.trim() || isDevPending || isDevConfirming}
                className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'var(--accent)' }}>
                {isDevPending || isDevConfirming ? <Loader2 className="size-4 animate-spin" /> : isDevSuccess ? <CheckCircle className="size-4" /> : null}
                {isDevPending ? 'Confirm…' : isDevConfirming ? 'Saving…' : isDevSuccess ? 'Updated' : 'Update'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Treasury Wallet — treasury can update; developer sees read-only */}
      <div className="rounded-2xl p-5" style={glass.card}>
        <div className="mb-3 flex items-center gap-2">
          <Wallet className="size-4" style={{ color: 'var(--accent)' }} />
          <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Treasury Wallet (50%)</span>
          {isDeveloper && !isTreasury && (
            <span className="ml-auto rounded-full px-2 py-0.5 text-xs" style={{ background: 'rgba(18,45,69,0.07)', color: 'var(--subtle)' }}>View only</span>
          )}
        </div>
        <p className="mb-3 mono text-xs break-all" style={{ color: 'var(--muted)' }}>
          Current: {treasuryAddress ? String(treasuryAddress) : '—'}
        </p>
        {isTreasury && (
          <>
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
          </>
        )}
      </div>

      {/* Admin record search */}
      <div className="rounded-2xl p-5" style={glass.card}>
        <div className="mb-3 flex items-center gap-2">
          <Search className="size-4" style={{ color: 'var(--accent)' }} />
          <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Search & Classify a Record</span>
        </div>
        <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
          Search by X handle or wallet address to find a specific record and classify it directly.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchState('idle'); setSearchedRecord(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdminSearch() }}
              placeholder="@handle or 0x wallet address"
              className="w-full rounded-xl py-3 pl-9 pr-4 text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(18,45,69,0.12)', color: 'var(--ink)' }}
            />
          </div>
          <button
            onClick={() => void handleAdminSearch()}
            disabled={!searchQuery.trim() || searchState === 'searching'}
            className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)' }}>
            {searchState === 'searching' ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            {searchState === 'searching' ? 'Searching…' : 'Search'}
          </button>
        </div>

        {/* No result */}
        {searchState === 'not-found' && (
          <div className="mt-3 flex items-center gap-2 rounded-xl px-4 py-3"
            style={{ background: 'rgba(18,45,69,0.05)', border: '1px solid rgba(18,45,69,0.1)' }}>
            <XCircle className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              No active record found for <span className="mono font-medium" style={{ color: 'var(--ink)' }}>{searchQuery}</span>
            </p>
          </div>
        )}

        {/* Found record — full RecordCard with classify/delete/reactivate */}
        {searchState === 'found' && searchedRecord && (
          <div className="mt-3">
            <RecordCard
              record={searchedRecord}
              onDeactivate={(key, handle) => {
                handleDeactivate(key, handle)
                setSearchedRecord(prev => prev ? { ...prev, active: false } : prev)
              }}
              onReactivate={(key, handle) => {
                handleReactivate(key, handle)
                setSearchedRecord(prev => prev ? { ...prev, active: true } : prev)
              }}
              onSetStatus={(key, newStatus) => {
                handleSetStatus(key, newStatus)
                setSearchedRecord(prev => prev ? { ...prev, status: newStatus } : prev)
              }}
              isThisDeactivateBusy={pendingDeactivateKey === searchedRecord.key && (isDeactivatePending || isDeactivateConfirming)}
              isThisReactivateBusy={pendingReactivateKey === searchedRecord.key && (isReactivatePending || isReactivateConfirming)}
              isThisStatusBusy={pendingStatusKey === searchedRecord.key && (isStatusPending || isStatusConfirming)}
              deactivateTxHash={pendingDeactivateKey === searchedRecord.key ? deactivateTxHash : undefined}
              reactivateTxHash={pendingReactivateKey === searchedRecord.key ? reactivateTxHash : undefined}
            />
          </div>
        )}
      </div>

      {/* All records — lazy-loaded, 50 per page */}
      <div className="rounded-2xl p-5" style={glass.card}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="size-4" style={{ color: 'var(--accent)' }} />
            <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>All Scam Records</span>
          </div>
          <div className="flex items-center gap-2">
            {isLoadingRecords && <Loader2 className="size-3.5 animate-spin" style={{ color: 'var(--subtle)' }} />}
            <span className="rounded-full px-2.5 py-0.5 text-xs font-bold"
              style={{ background: 'rgba(186,43,76,0.1)', color: 'var(--danger)' }}>
              {recordsTotal !== null ? `${activeRecords.length}/${recordsTotal} loaded` : '…'}
            </span>
            <button onClick={() => { setRecordsOffset(0); loadRecordPage(0, true) }}
              className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
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
              onSetStatus={handleSetStatus}
              isThisDeactivateBusy={pendingDeactivateKey === rec.key && (isDeactivatePending || isDeactivateConfirming)}
              isThisReactivateBusy={pendingReactivateKey === rec.key && (isReactivatePending || isReactivateConfirming)}
              isThisStatusBusy={pendingStatusKey === rec.key && (isStatusPending || isStatusConfirming)}
              deactivateTxHash={pendingDeactivateKey === rec.key ? deactivateTxHash : undefined}
              reactivateTxHash={pendingReactivateKey === rec.key ? reactivateTxHash : undefined}
            />
          ))}
        </div>

        {hasMoreRecords && (
          <button onClick={() => loadRecordPage(recordsOffset)} disabled={isLoadingRecords}
            className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold transition-all disabled:opacity-40"
            style={{ background: 'rgba(18,45,69,0.06)', color: 'var(--ink)' }}>
            {isLoadingRecords ? <><Loader2 className="inline size-3.5 animate-spin mr-1.5" />Loading…</> : `Load more (${recordsTotal - recordsOffset} remaining)`}
          </button>
        )}
      </div>

      {/* Reporter directory — lazy-loaded, 50 per page */}
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
              {reportersTotal !== null ? `${allReporters.length}/${reportersTotal}` : '…'}
            </span>
            <button onClick={() => { setReportersOffset(0); loadReporterPage(0, true) }}
              className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
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

        {hasMoreReporters && (
          <button onClick={() => loadReporterPage(reportersOffset)} disabled={isLoadingReporters}
            className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold transition-all disabled:opacity-40"
            style={{ background: 'rgba(18,45,69,0.06)', color: 'var(--ink)' }}>
            {isLoadingReporters ? <><Loader2 className="inline size-3.5 animate-spin mr-1.5" />Loading…</> : `Load more (${reportersTotal - reportersOffset} remaining)`}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────

const STATUS_CONFIG: Record<number, { label: string; bg: string; color: string; border: string }> = {
  0: { label: 'Reported', bg: 'rgba(180,83,9,0.09)', color: '#b45309', border: 'rgba(180,83,9,0.22)' },
  1: { label: 'Under Review', bg: 'rgba(194,65,12,0.09)', color: '#c2410c', border: 'rgba(194,65,12,0.22)' },
  2: { label: 'Verified', bg: 'rgba(186,43,76,0.09)', color: '#ba2b4c', border: 'rgba(186,43,76,0.22)' },
}

function RecordCard({
  record, onDeactivate, onReactivate, onSetStatus,
  isThisDeactivateBusy, isThisReactivateBusy, isThisStatusBusy,
  deactivateTxHash, reactivateTxHash,
}: {
  record: RecordWithKey
  onDeactivate: (key: `0x${string}`, handle: string) => void
  onReactivate: (key: `0x${string}`, handle: string) => void
  onSetStatus: (key: `0x${string}`, status: RecordStatusValue) => void
  isThisDeactivateBusy: boolean
  isThisReactivateBusy: boolean
  isThisStatusBusy: boolean
  deactivateTxHash?: `0x${string}`
  reactivateTxHash?: `0x${string}`
}) {
  const [expanded, setExpanded] = useState(false)
  const deactivateTxUrl = deactivateTxHash ? `${EXPLORER_TX}${deactivateTxHash}` : undefined
  const reactivateTxUrl = reactivateTxHash ? `${EXPLORER_TX}${reactivateTxHash}` : undefined
  const statusCfg = STATUS_CONFIG[record.status] ?? STATUS_CONFIG[0]

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
            {/* Active/Deactivated badge */}
            {record.active
              ? <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(26,128,71,0.1)', color: 'var(--success)' }}>Active</span>
              : <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(186,43,76,0.1)', color: 'var(--danger)' }}>Deactivated</span>
            }
            {/* Status badge */}
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold flex items-center gap-1"
              style={{ background: statusCfg.bg, color: statusCfg.color, border: `1px solid ${statusCfg.border}` }}>
              {record.status === 0 && <AlertTriangle className="size-2.5" />}
              {record.status === 1 && <Clock className="size-2.5" />}
              {record.status === 2 && <Eye className="size-2.5" />}
              {statusCfg.label}
            </span>
            {record.walletAddress && (
              <span className="mono rounded px-1.5 py-0.5 text-xs" style={{ background: 'rgba(18,45,69,0.07)', color: 'var(--muted)' }}>
                {record.walletAddress.slice(0, 6)}…{record.walletAddress.slice(-4)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
            Reported by:{' '}
            {/* Show reporter's X handle as a clickable link to their profile */}
            {record.reporterProfileUrl ? (
              <a href={record.reporterProfileUrl} target="_blank" rel="noopener noreferrer"
                className="font-semibold hover:underline inline-flex items-center gap-0.5"
                style={{ color: 'var(--ink)' }}>
                {record.reporterHandle ? `@${record.reporterHandle}` : 'unknown'}
                <ExternalLink className="size-2.5 ml-0.5" />
              </a>
            ) : (
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                {record.reporterHandle ? `@${record.reporterHandle}` : 'unknown'}
              </span>
            )}
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

      {/* Status classification buttons — only for active records */}
      {record.active && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Classify:</span>
          {([
            { status: 0 as RecordStatusValue, label: 'Reported', icon: <AlertTriangle className="size-3" /> },
            { status: 1 as RecordStatusValue, label: 'Under Review', icon: <Clock className="size-3" /> },
            { status: 2 as RecordStatusValue, label: 'Verify', icon: <Eye className="size-3" /> },
          ]).map(({ status, label, icon }) => {
            const isActive = record.status === status
            const cfg = STATUS_CONFIG[status]
            return (
              <button
                key={status}
                onClick={() => !isActive && onSetStatus(record.key, status)}
                disabled={isActive || isThisStatusBusy}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all disabled:cursor-default"
                style={{
                  background: isActive ? cfg.bg : 'rgba(18,45,69,0.05)',
                  color: isActive ? cfg.color : 'var(--subtle)',
                  border: `1px solid ${isActive ? cfg.border : 'rgba(18,45,69,0.1)'}`,
                  opacity: isThisStatusBusy && !isActive ? 0.4 : 1,
                }}>
                {isThisStatusBusy && !isActive ? <Loader2 className="size-3 animate-spin" /> : icon}
                {label}
                {isActive && ' ✓'}
              </button>
            )
          })}
        </div>
      )}

      {expanded && (
        <div className="mt-3 flex flex-col gap-2 text-xs">
          {record.description && <p style={{ color: 'var(--muted)' }}>{record.description}</p>}
          {record.profileLink && (
            <a href={record.profileLink} target="_blank" rel="noreferrer"
              className="flex items-center gap-1" style={{ color: 'var(--danger)' }}>
              <ExternalLink className="size-3" /> View Scam Profile
            </a>
          )}
          {record.evidenceUrl && (
            <a href={record.evidenceUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1" style={{ color: 'var(--accent)' }}>
              <ExternalLink className="size-3" /> Evidence link
            </a>
          )}
          {Number(record.corroborationCount) > 0 && (
            <p style={{ color: 'var(--muted)' }}>{String(record.corroborationCount)} corroboration{Number(record.corroborationCount) !== 1 ? 's' : ''}</p>
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
          {r.profileUrl && (
            <a href={r.profileUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-xs mt-0.5" style={{ color: 'var(--accent)' }}>
              <ExternalLink className="size-3" /> View X Profile
            </a>
          )}
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
