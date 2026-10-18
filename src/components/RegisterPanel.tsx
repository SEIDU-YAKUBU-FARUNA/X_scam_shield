import { useState, useEffect, useRef } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { createPublicClient, http, defineChain } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { UserPlus, CheckCircle, Loader2, Gift, ExternalLink, TrendingUp, AlertTriangle, Plus, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { SCAM_REGISTRY_ABI, SCAM_REGISTRY_ADDRESS } from '../contracts'
import { formatUsdc } from '../onchain-money'
import { buildTxExplorerUrl, requireChain } from '../onchain-facts'
import { ACTIVE_CHAIN_ID, NETWORK_LABEL } from '../config'

// Reuse the same direct viem client pattern as SearchPanel
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

// Normalise handle: strip leading @, lowercase — mirrors contract _toLower
const normaliseHandle = (raw: string) => raw.trim().replace(/^@+/, '').toLowerCase()

// Full on-chain record returned by getRecordByKey
interface OnChainRecord {
  xHandle: string
  walletAddress: string
  evidenceUrl: string
  description: string
  reporter: string
  timestamp: bigint
  active: boolean
}

// Tracks a record submitted this session (optimistic, before chain confirm)
interface SubmittedRecord {
  xHandle: string
  walletAddress: string
  evidenceUrl: string
  description: string
  txHash?: `0x${string}`
}

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

export function RegisterPanel() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const [handle, setHandle] = useState('')
  const [showSubmitForm, setShowSubmitForm] = useState(false)
  const [scamHandle, setScamHandle] = useState('')
  const [scamWallet, setScamWallet] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [description, setDescription] = useState('')
  const [additionalInfo, setAdditionalInfo] = useState('')

  // Records submitted this session — pushed from the click handler, not from an effect
  const [submittedRecords, setSubmittedRecords] = useState<SubmittedRecord[]>([])

  // On-chain records: stored in a ref, re-render triggered by a counter
  // This satisfies the linter (no setState in effect) while still updating the UI
  const onChainRecordsRef = useRef<OnChainRecord[]>([])
  const [onChainVersion, setOnChainVersion] = useState(0) // bump to re-render
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)

  const isWrongChain = isConnected && chainId !== ACTIVE_CHAIN_ID

  const { data: reporterData, refetch: refetchReporter } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS,
    abi: SCAM_REGISTRY_ABI,
    functionName: 'getReporter',
    args: address ? [address] : undefined,
    chainId: ACTIVE_CHAIN_ID,
    query: { enabled: !!address },
  })

  const { data: pendingRewardsRaw, refetch: refetchRewards } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS,
    abi: SCAM_REGISTRY_ABI,
    functionName: 'pendingRewards',
    args: address ? [address] : undefined,
    chainId: ACTIVE_CHAIN_ID,
    query: { enabled: !!address },
  })

  const reporter = reporterData as {
    wallet: string; handle: string; registered: boolean; banned: boolean;
    totalSubmissions: bigint; totalRewardsEarned: bigint
  } | undefined

  const isRegistered = reporter?.registered ?? false
  const isBanned = reporter?.banned ?? false
  const pendingRewards = pendingRewardsRaw

  const { writeContract: register, data: regTxHash, isPending: isRegPending, error: regError } = useWriteContract()
  const { isLoading: isRegConfirming, isSuccess: isRegSuccess } = useWaitForTransactionReceipt({ hash: regTxHash })

  const {
    writeContract: reportScam,
    data: reportTxHash,
    isPending: isReportPending,
    error: reportError,
    reset: resetReport,
  } = useWriteContract()
  const { isLoading: isReportConfirming, isSuccess: isReportSuccess } = useWaitForTransactionReceipt({ hash: reportTxHash })

  const { writeContract: claimRewards, data: claimTxHash, isPending: isClaimPending, error: claimError } = useWriteContract()
  const { isLoading: isClaimConfirming, isSuccess: isClaimSuccess } = useWaitForTransactionReceipt({ hash: claimTxHash })

  // Load on-chain records — uses getRecordsByReporter (reporter-targeted, no full registry scan)
  // Uses a ref+counter pattern to avoid setState-in-effect lint violation while still re-rendering
  const loadOnChainRecords = (reporterAddr: string) => {
    setIsLoadingRecords(true)
    const client = getPublicClient()
    void (async () => {
      try {
        // getRecordsByReporter returns only this reporter's keys, newest first — no full scan needed
        const keys = await client.readContract({
          address: SCAM_REGISTRY_ADDRESS,
          abi: SCAM_REGISTRY_ABI,
          functionName: 'getRecordsByReporter',
          args: [reporterAddr as `0x${string}`],
        }) as `0x${string}`[]
        const records: OnChainRecord[] = []
        for (const key of keys) {
          try {
            const rec = await client.readContract({
              address: SCAM_REGISTRY_ADDRESS,
              abi: SCAM_REGISTRY_ABI,
              functionName: 'getRecordByKey',
              args: [key],
            }) as OnChainRecord
            records.push(rec)
          } catch {
            // skip any record that fails to decode
          }
        }
        onChainRecordsRef.current = records
        setOnChainVersion(v => v + 1) // trigger re-render
      } catch (e) {
        console.error('Failed to load on-chain records', e)
      } finally {
        setIsLoadingRecords(false)
      }
    })()
  }

  // Trigger load when reporter is confirmed registered + pre-open form on first registration
  const prevRegistered = useRef(false)
  useEffect(() => {
    if (!address || !isRegistered || prevRegistered.current) return
    prevRegistered.current = true
    loadOnChainRecords(address)
    // Pre-open submit form so a fresh reporter can immediately submit
    setShowSubmitForm(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isRegistered])

  // Success toasts + refetch
  useEffect(() => {
    if (isRegSuccess) {
      toast.success('Registered! You can now submit scam reports.')
      void refetchReporter()
    }
  }, [isRegSuccess, refetchReporter])

  useEffect(() => {
    if (isReportSuccess && reportTxHash) {
      toast.success('Scam report submitted on-chain!')
      void refetchReporter()
      void refetchRewards()
      if (address) loadOnChainRecords(address)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReportSuccess, reportTxHash])

  useEffect(() => {
    if (isClaimSuccess) {
      toast.success('Rewards claimed!')
      void refetchRewards()
    }
  }, [isClaimSuccess, refetchRewards])

  // Error toasts
  useEffect(() => {
    if (!regError) return
    const msg = regError.message.split('\n')[0]
    toast.error(msg.length > 120 ? msg.slice(0, 120) + '…' : msg)
  }, [regError])

  useEffect(() => {
    if (!reportError) return
    const raw = reportError.message
    if (raw.includes('AlreadyReported')) {
      toast.error('Already reported — this scammer is already in the registry.')
    } else if (raw.includes('NotRegistered')) {
      toast.error('You must register before submitting a report.')
    } else {
      const msg = raw.split('\n')[0]
      toast.error(msg.length > 120 ? msg.slice(0, 120) + '…' : msg)
    }
  }, [reportError])

  useEffect(() => {
    if (!claimError) return
    const msg = claimError.message.split('\n')[0]
    toast.error(msg.length > 120 ? msg.slice(0, 120) + '…' : msg)
  }, [claimError])

  const handleRegister = () => {
    if (!handle.trim()) { toast.error('Enter your handle or name first.'); return }
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    register({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'registerReporter', args: [handle.trim()], chainId: ACTIVE_CHAIN_ID })
  }

  const handleReport = () => {
    if (!scamHandle.trim()) { toast.error('Scammer X handle is required.'); return }
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    const normHandle = normaliseHandle(scamHandle)
    const parts = [description.trim(), additionalInfo.trim()].filter(Boolean)
    const fullDesc = parts.join('\n\nAdditional info: ')
    // Optimistic record pushed at click time
    setSubmittedRecords(prev => [...prev, {
      xHandle: normHandle,
      walletAddress: scamWallet.trim(),
      evidenceUrl: evidenceUrl.trim(),
      description: fullDesc,
      txHash: undefined,
    }])
    reportScam({
      address: SCAM_REGISTRY_ADDRESS,
      abi: SCAM_REGISTRY_ABI,
      functionName: 'reportScam',
      args: [normHandle, scamWallet.trim(), evidenceUrl.trim(), fullDesc],
      chainId: ACTIVE_CHAIN_ID,
    })
  }

  const handleClaim = () => {
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    claimRewards({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'claimRewards', chainId: ACTIVE_CHAIN_ID })
  }

  const handleSubmitAnother = () => {
    setScamHandle('')
    setScamWallet('')
    setEvidenceUrl('')
    setDescription('')
    setAdditionalInfo('')
    resetReport()
    setShowSubmitForm(true)
  }

  const claimExplorerUrl = claimTxHash ? buildTxExplorerUrl(ACTIVE_CHAIN_ID, claimTxHash) : undefined
  const formattedPending = pendingRewards ? formatUsdc(pendingRewards) : '0.00'
  const formattedEarned = reporter?.totalRewardsEarned ? formatUsdc(reporter.totalRewardsEarned) : '0.00'

  // Derive on-chain records from ref (onChainVersion triggers re-reads of the ref)
  const onChainRecords = onChainVersion >= 0 ? onChainRecordsRef.current : []

  return (
    <div className="flex flex-col gap-5">
      {/* Register card */}
      <div className="rounded-3xl p-6" style={glass.card}>
        <div className="mb-1 flex items-center gap-2">
          <UserPlus className="size-5" style={{ color: 'var(--accent)' }} />
          <span className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Register to Earn</span>
        </div>
        <p className="mb-5 text-sm" style={{ color: 'var(--muted)' }}>
          Connect your wallet to register as a reporter. Every verified scam you submit earns you 20% of each lookup fee.
        </p>

        {!isConnected ? (
          <ConnectKitButton label="Connect Wallet to Register" />
        ) : isWrongChain ? (
          <button onClick={() => switchChain({ chainId: ACTIVE_CHAIN_ID })} className="w-full rounded-xl py-3 text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
            Switch to {NETWORK_LABEL}
          </button>
        ) : isRegistered ? (
          <div className="rounded-2xl p-4" style={{ ...glass.inner, border: '1.5px solid rgba(26,128,71,0.25)' }}>
            <div className="flex items-center gap-2">
              <CheckCircle className="size-4" style={{ color: 'var(--success)' }} />
              <span className="font-semibold text-sm" style={{ color: 'var(--success)' }}>Registered as @{reporter?.handle}</span>
              {isBanned && <span className="ml-auto rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(186,43,76,0.1)', color: 'var(--danger)' }}>Banned</span>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <StatCard label="Submissions" value={String(reporter?.totalSubmissions ?? 0)} />
              <StatCard label="Total Earned" value={`$${formattedEarned}`} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Your X Handle or Name *" placeholder="@yourhandle or your name" value={handle} onChange={setHandle} />
            <button onClick={handleRegister} disabled={!handle.trim() || isRegPending || isRegConfirming}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'var(--accent)' }}>
              {isRegPending ? <><Loader2 className="size-4 animate-spin" /> Confirm in wallet…</> : isRegConfirming ? <><Loader2 className="size-4 animate-spin" /> Registering…</> : isRegSuccess ? <><CheckCircle className="size-4" /> Registered!</> : 'Register Wallet'}
            </button>
          </div>
        )}
      </div>

      {/* On-chain records (persists across refresh) + session optimistic records */}
      {isRegistered && (onChainRecords.length > 0 || submittedRecords.length > 0 || isLoadingRecords) && (
        <div className="rounded-2xl p-5" style={glass.card}>
          <div className="mb-3 flex items-center gap-2">
            <FileText className="size-4" style={{ color: 'var(--accent)' }} />
            <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Your Submitted Reports</span>
            {!isLoadingRecords && (
              <span className="ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: 'rgba(26,128,71,0.12)', color: 'var(--success)' }}>
                {onChainRecords.length}
              </span>
            )}
            {isLoadingRecords && <Loader2 className="ml-auto size-3.5 animate-spin" style={{ color: 'var(--subtle)' }} />}
          </div>

          {isLoadingRecords && onChainRecords.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Loading your on-chain reports…</p>
          )}

          {/* On-chain confirmed records */}
          <div className="flex flex-col gap-3">
            {onChainRecords.map((rec, i) => (
              <OnChainRecordCard key={`onchain-${rec.xHandle}-${i}`} record={rec} />
            ))}
          </div>

          {/* Optimistic records from this session not yet reflected in on-chain list */}
          {submittedRecords
            .filter(sr => !onChainRecords.some(oc => oc.xHandle === sr.xHandle))
            .map((rec, i, arr) => {
              const isLast = i === arr.length - 1
              const txHash = isLast && isReportSuccess ? reportTxHash : rec.txHash
              return <SubmittedRecordCard key={`session-${rec.xHandle}-${i}`} record={rec} txHash={txHash} />
            })}
        </div>
      )}

      {/* Pending rewards + Claim */}
      {isRegistered && !isBanned && (
        <div className="rounded-2xl p-5" style={glass.card}>
          <div className="mb-3 flex items-center gap-2">
            <Gift className="size-4" style={{ color: 'var(--accent)' }} />
            <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Pending Rewards</span>
          </div>
          <div className="flex items-baseline gap-1 mb-4">
            <span className="display text-3xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{pendingRewards === undefined ? '…' : `$${formattedPending}`}</span>
            <span className="text-base font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
          <button onClick={handleClaim} disabled={!pendingRewards || pendingRewards === 0n || isClaimPending || isClaimConfirming}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)' }}>
            {isClaimPending ? <><Loader2 className="size-4 animate-spin" /> Confirm in wallet…</> : isClaimConfirming ? <><Loader2 className="size-4 animate-spin" /> Claiming…</> : isClaimSuccess ? <><CheckCircle className="size-4" /> Claimed!</> : 'Claim USDC Rewards'}
          </button>
          {claimExplorerUrl && isClaimSuccess && (
            <a href={claimExplorerUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 text-xs" style={{ color: 'var(--accent-hover)' }}>View on ArcScan <ExternalLink className="size-3" /></a>
          )}
        </div>
      )}

      {/* Submit report */}
      {isRegistered && !isBanned && (
        <div className="rounded-2xl p-5" style={glass.card}>
          {/* Header row — always visible */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4" style={{ color: 'var(--accent)' }} />
              <span className="display text-sm font-bold" style={{ color: 'var(--ink)' }}>Submit a Scam Report</span>
            </div>
            {!showSubmitForm && (
              <button onClick={handleSubmitAnother}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-all hover:scale-[1.02]"
                style={{ background: 'var(--accent)' }}>
                <Plus className="size-3.5" /> New Report
              </button>
            )}
            {showSubmitForm && (
              <button onClick={() => setShowSubmitForm(false)}
                className="text-lg font-light leading-none"
                style={{ color: 'var(--subtle)' }}>−</button>
            )}
          </div>

          {/* Expanded form — hidden after successful submission until "New Report" is tapped */}
          {showSubmitForm && !isReportSuccess && (
            <div className="mt-4 flex flex-col gap-3">
              <div className="rounded-xl px-4 py-3 text-xs" style={{ background: 'rgba(18,45,69,0.05)', color: 'var(--muted)' }}>
                Scammer X handle is required. All other fields are optional but improve verification quality.
              </div>

              <Field label="Scammer X Handle *" placeholder="@scamaccount" value={scamHandle} onChange={setScamHandle} />
              <Field label="Scammer Wallet Address" placeholder="0x... (optional)" value={scamWallet} onChange={setScamWallet} mono />
              <Field label="Evidence URL" placeholder="https://... (optional — screenshot, post, proof link)" value={evidenceUrl} onChange={setEvidenceUrl} />

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>Scam Description</p>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the scam tactic — fake NFT, rug pull, impersonation, phishing..."
                  rows={3} className="w-full resize-none rounded-xl px-4 py-3 text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(18,45,69,0.12)', color: 'var(--ink)' }} />
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>Additional Information</p>
                <textarea value={additionalInfo} onChange={(e) => setAdditionalInfo(e.target.value)}
                  placeholder="Other context — date of scam, amount stolen, victims, related accounts..."
                  rows={2} className="w-full resize-none rounded-xl px-4 py-3 text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(18,45,69,0.12)', color: 'var(--ink)' }} />
              </div>

              <div className="flex items-start gap-2 rounded-xl px-4 py-3" style={{ background: 'rgba(186,43,76,0.06)', border: '1px solid rgba(186,43,76,0.15)' }}>
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--danger)' }} />
                <p className="text-xs" style={{ color: 'var(--danger)' }}>
                  Duplicate submissions are blocked on-chain. If this handle is already reported, your transaction will revert and no fee is charged.
                </p>
              </div>

              <button onClick={handleReport} disabled={isReportPending || isReportConfirming}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'var(--accent)' }}>
                {isReportPending ? <><Loader2 className="size-4 animate-spin" /> Confirm in wallet…</>
                  : isReportConfirming ? <><Loader2 className="size-4 animate-spin" /> Submitting on-chain…</>
                  : 'Submit Report On-Chain'}
              </button>
            </div>
          )}

          {/* Success banner — shown after report confirms, before "New Report" is tapped */}
          {showSubmitForm && isReportSuccess && (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: 'rgba(26,128,71,0.08)', border: '1px solid rgba(26,128,71,0.2)' }}>
                <CheckCircle className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Report submitted on-chain!</p>
              </div>
              <button onClick={handleSubmitAnother}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white"
                style={{ background: 'var(--accent)' }}>
                <Plus className="size-4" /> Submit Another Report
              </button>
            </div>
          )}

          {/* Prompt to open the form */}
          {!showSubmitForm && submittedRecords.length === 0 && onChainRecords.length === 0 && (
            <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
              Tap <strong>New Report</strong> to submit a scammer and start earning.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function OnChainRecordCard({ record }: { record: OnChainRecord }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(26,128,71,0.06)', border: '1px solid rgba(26,128,71,0.18)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <CheckCircle className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
          <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>@{record.xHandle}</span>
          {record.walletAddress && (
            <span className="mono rounded px-1.5 py-0.5 text-xs" style={{ background: 'rgba(18,45,69,0.07)', color: 'var(--muted)' }}>
              {record.walletAddress.slice(0, 6)}…{record.walletAddress.slice(-4)}
            </span>
          )}
        </div>
        <span className="text-xs shrink-0" style={{ color: 'var(--subtle)' }}>
          {new Date(Number(record.timestamp) * 1000).toLocaleDateString()}
        </span>
      </div>
      {record.description && (
        <p className="mt-2 text-xs line-clamp-2" style={{ color: 'var(--muted)' }}>{record.description}</p>
      )}
      {record.evidenceUrl && (
        <a href={record.evidenceUrl} target="_blank" rel="noreferrer"
          className="mt-1.5 flex items-center gap-1 text-xs"
          style={{ color: 'var(--accent)' }}>
          Evidence link <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}

function SubmittedRecordCard({ record, txHash }: { record: SubmittedRecord; txHash?: `0x${string}` }) {
  const explorerUrl = txHash ? buildTxExplorerUrl(ACTIVE_CHAIN_ID, txHash) : undefined
  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(26,128,71,0.06)', border: '1px solid rgba(26,128,71,0.18)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <CheckCircle className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
          <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>@{record.xHandle}</span>
          {record.walletAddress && (
            <span className="mono rounded px-1.5 py-0.5 text-xs" style={{ background: 'rgba(18,45,69,0.07)', color: 'var(--muted)' }}>
              {record.walletAddress.slice(0, 6)}…{record.walletAddress.slice(-4)}
            </span>
          )}
        </div>
        {explorerUrl && (
          <a href={explorerUrl} target="_blank" rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs"
            style={{ color: 'var(--accent-hover)' }}>
            Tx <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      {record.description && (
        <p className="mt-2 text-xs line-clamp-2" style={{ color: 'var(--muted)' }}>{record.description}</p>
      )}
      {record.evidenceUrl && (
        <a href={record.evidenceUrl} target="_blank" rel="noreferrer"
          className="mt-1.5 flex items-center gap-1 text-xs"
          style={{ color: 'var(--accent)' }}>
          Evidence link <ExternalLink className="size-3" />
        </a>
      )}
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

function Field({ label, placeholder, value, onChange, mono }: { label: string; placeholder: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>{label}</p>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full rounded-xl px-4 py-3 text-sm outline-none ${mono ? 'mono' : ''}`}
        style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(18,45,69,0.12)', color: 'var(--ink)' }} />
    </div>
  )
}
