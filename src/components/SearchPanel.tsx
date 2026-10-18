import { useState, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { erc20Abi, createPublicClient, http, defineChain } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { Search, AlertTriangle, CheckCircle, Loader2, ExternalLink, ShieldCheck, Lock, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { SCAM_REGISTRY_ABI, SCAM_REGISTRY_ADDRESS } from '../contracts'
import { getUsdc, requireChain, buildTxExplorerUrl } from '../onchain-facts'
import { formatUsdc } from '../onchain-money'
import { ACTIVE_CHAIN_ID, NETWORK_LABEL } from '../config'

type CheckState = 'idle' | 'checking' | 'no-match' | 'match-found'

interface RevealedRecord {
  xHandle: string
  walletAddress: string
  evidenceUrl: string
  description: string
  reporter: string
  timestamp: bigint
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

// Build a public viem client directly so we can call view functions without wagmi refetch stale-arg issues
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

export function SearchPanel() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const [query, setQuery] = useState('')
  const [checkState, setCheckState] = useState<CheckState>('idle')
  const [lockedQuery, setLockedQuery] = useState('')
  const [revealedRecord, setRevealedRecord] = useState<RevealedRecord | null>(null)

  const isWrongChain = isConnected && chainId !== ACTIVE_CHAIN_ID

  const usdcFact = getUsdc(ACTIVE_CHAIN_ID)
  const USDC_ADDRESS = usdcFact?.address as `0x${string}`

  // Lookup fee
  const { data: lookupFeeRaw } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS,
    abi: SCAM_REGISTRY_ABI,
    functionName: 'lookupFee',
    chainId: ACTIVE_CHAIN_ID,
  })
  const fee = lookupFeeRaw ?? 5_000_000n
  const formattedFee = formatUsdc(fee)

  // USDC balance of connected wallet (D: show balance)
  const { data: usdcBalanceRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ACTIVE_CHAIN_ID,
    query: { enabled: !!address },
  })
  const usdcBalance = usdcBalanceRaw ?? 0n
  const formattedBalance = formatUsdc(usdcBalance)
  const hasSufficientBalance = usdcBalance >= fee

  // USDC allowance
  const { refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, SCAM_REGISTRY_ADDRESS] : undefined,
    chainId: ACTIVE_CHAIN_ID,
    query: { enabled: !!address },
  })

  // Approve + lookup write hooks
  const { writeContract: approveUsdc, data: approveTxHash, isPending: isApprovePending, error: approveError } = useWriteContract()
  const { isSuccess: isApproveSuccess, isLoading: isApproveConfirming } = useWaitForTransactionReceipt({ hash: approveTxHash })

  const { writeContract: doLookup, data: lookupTxHash, isPending: isLookupPending, error: lookupError } = useWriteContract()
  const { isSuccess: isLookupSuccess, isLoading: isLookupConfirming } = useWaitForTransactionReceipt({ hash: lookupTxHash })

  // C: After payment confirms, read the full record from chain via direct viem call
  useEffect(() => {
    if (!isLookupSuccess || !lockedQuery) return
    toast.success('Payment confirmed — fetching full report…')
    const client = getPublicClient()
    void (async () => {
      try {
        // handleIndex returns the record key for this handle
        const key = await client.readContract({
          address: SCAM_REGISTRY_ADDRESS,
          abi: SCAM_REGISTRY_ABI,
          functionName: 'handleIndex',
          args: [lockedQuery.toLowerCase()],
        })
        if (!key || key === '0x0000000000000000000000000000000000000000000000000000000000000000') {
          // Try walletIndex too
          const wKey = await client.readContract({
            address: SCAM_REGISTRY_ADDRESS,
            abi: SCAM_REGISTRY_ABI,
            functionName: 'walletIndex',
            args: [lockedQuery.toLowerCase()],
          })
          if (!wKey || wKey === '0x0000000000000000000000000000000000000000000000000000000000000000') {
            toast.error('Record not found after payment — check ArcScan for the transaction.')
            return
          }
          const rec = await client.readContract({
            address: SCAM_REGISTRY_ADDRESS,
            abi: SCAM_REGISTRY_ABI,
            functionName: 'getRecordByKey',
            args: [wKey],
          }) as RevealedRecord
          setRevealedRecord(rec)
        } else {
          const rec = await client.readContract({
            address: SCAM_REGISTRY_ADDRESS,
            abi: SCAM_REGISTRY_ABI,
            functionName: 'getRecordByKey',
            args: [key],
          }) as RevealedRecord
          setRevealedRecord(rec)
        }
      } catch (e) {
        toast.error('Could not fetch record details — check ArcScan for the transaction.')
        console.error(e)
      }
    })()
  }, [isLookupSuccess, lockedQuery])

  // Fire lookup after approval confirms
  useEffect(() => {
    if (!isApproveSuccess || !lockedQuery) return
    doLookup({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'lookupAndPay', args: [lockedQuery], chainId: ACTIVE_CHAIN_ID })
  }, [isApproveSuccess, lockedQuery, doLookup])

  // Error toasts
  useEffect(() => {
    if (!approveError) return
    toast.error(approveError.message.split('\n')[0].slice(0, 120))
  }, [approveError])
  useEffect(() => {
    if (!lookupError) return
    const msg = lookupError.message
    if (msg.includes('RecordNotFound') || msg.includes('not found')) {
      toast.error('Record not found — it may have been deactivated.')
    } else {
      toast.error(msg.split('\n')[0].slice(0, 120))
    }
  }, [lookupError])

  const isRevealed = isLookupSuccess && !!lookupTxHash
  const isPayBusy = isApprovePending || isApproveConfirming || isLookupPending || isLookupConfirming

  // Normalise a query the same way the contract does: strip leading @, lowercase
  const normaliseQuery = (raw: string) => raw.trim().replace(/^@+/, '').toLowerCase()

  // B: Use direct viem readContract call — avoids wagmi refetch stale-args bug
  const handleCheck = async () => {
    const q = normaliseQuery(query)
    if (!q) return
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    setLockedQuery(q)
    setCheckState('checking')
    setRevealedRecord(null)
    try {
      const client = getPublicClient()
      const result = await client.readContract({
        address: SCAM_REGISTRY_ADDRESS,
        abi: SCAM_REGISTRY_ABI,
        functionName: 'checkExists',
        args: [q],
      }) as [boolean, `0x${string}`, bigint]
      setCheckState(result[0] ? 'match-found' : 'no-match')
    } catch (e: unknown) {
      toast.error((e instanceof Error ? e.message.split('\n')[0] : 'Check failed').slice(0, 80))
      setCheckState('idle')
    }
  }

  const handlePay = async () => {
    if (!address || !isConnected) { toast.error('Connect your wallet first.'); return }
    if (isWrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    // D: Check balance before attempting
    if (!hasSufficientBalance) {
      toast.error(`Insufficient USDC balance. You have $${formattedBalance} but need $${formattedFee}.`)
      return
    }
    const { data: freshAllowance } = await refetchAllowance()
    const currentAllowance = freshAllowance ?? 0n
    if (currentAllowance < fee) {
      approveUsdc({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [SCAM_REGISTRY_ADDRESS, fee], chainId: ACTIVE_CHAIN_ID })
    } else {
      doLookup({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'lookupAndPay', args: [lockedQuery], chainId: ACTIVE_CHAIN_ID })
    }
  }

  const explorerUrl = lookupTxHash ? buildTxExplorerUrl(ACTIVE_CHAIN_ID, lookupTxHash) : undefined
  const payLabel = isApprovePending ? 'Approve USDC in wallet…'
    : isApproveConfirming ? 'Waiting for approval…'
    : isLookupPending ? 'Confirm payment in wallet…'
    : isLookupConfirming ? 'Confirming on-chain…'
    : `Unlock Full Report — $${formattedFee} USDC`

  return (
    <div className="flex flex-col gap-5">
      {/* Search card */}
      <div className="rounded-3xl p-6" style={glass.card}>
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck className="size-5" style={{ color: 'var(--accent)' }} />
          <span className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Verify a Profile</span>
        </div>
        <p className="mb-5 text-sm" style={{ color: 'var(--muted)' }}>Enter an X handle or wallet address to check the scam registry.</p>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
            <input type="text" value={query}
              onChange={(e) => { setQuery(e.target.value); setCheckState('idle'); setRevealedRecord(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCheck() }}
              placeholder="@handle or 0x wallet address"
              className="w-full rounded-xl py-3 pl-9 pr-4 text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(18,45,69,0.12)', color: 'var(--ink)' }} />
          </div>
          {!isConnected ? <ConnectKitButton /> : (
            <button onClick={() => void handleCheck()} disabled={!query.trim() || checkState === 'checking'}
              className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--accent)' }}>
              {checkState === 'checking' ? <><Loader2 className="size-4 animate-spin" />Checking…</> : isWrongChain ? `Switch to ${NETWORK_LABEL}` : 'Check'}
            </button>
          )}
        </div>

        {/* D: Balance display */}
        {isConnected && (
          <div className="mt-3 flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
            <span>Free for clean lookups. Flagged records unlock for <span className="font-semibold" style={{ color: 'var(--accent)' }}>${formattedFee} USDC</span>.</span>
            <span className="flex items-center gap-1">
              <Wallet className="size-3" />
              <span style={{ color: usdcBalance > 0n ? 'var(--ink)' : 'var(--danger)' }}>${formattedBalance}</span>
            </span>
          </div>
        )}
        {!isConnected && (
          <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
            Free for clean lookups. Flagged records unlock for <span className="font-semibold" style={{ color: 'var(--accent)' }}>${formattedFee} USDC</span>.
          </p>
        )}
      </div>

      {/* Clean result */}
      {checkState === 'no-match' && (
        <div className="rounded-2xl p-5" style={{ ...glass.card, border: '1.5px solid rgba(26,128,71,0.25)' }}>
          <div className="flex items-start gap-3">
            <CheckCircle className="mt-0.5 size-5 shrink-0" style={{ color: 'var(--success)' }} />
            <div>
              <p className="font-semibold" style={{ color: 'var(--success)' }}>Not found in registry</p>
              <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                <span className="mono font-medium" style={{ color: 'var(--ink)' }}>{lockedQuery}</span>{' '}is not currently flagged. Always stay vigilant online.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Match found — pay to unlock */}
      {checkState === 'match-found' && !isRevealed && (
        <div className="rounded-2xl p-5" style={{ ...glass.card, border: '1.5px solid rgba(186,43,76,0.25)' }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" style={{ color: 'var(--danger)' }} />
            <div className="flex-1">
              <p className="font-semibold" style={{ color: 'var(--danger)' }}>⚠️ Scam alert — this account is flagged</p>
              <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                <span className="mono font-medium" style={{ color: 'var(--ink)' }}>{lockedQuery}</span>{' '}is in our registry.
                Pay <span className="font-bold tabular-nums" style={{ color: 'var(--ink)' }}>${formattedFee} USDC</span> to unlock the full evidence report.
              </p>

              {/* Fee split breakdown */}
              <div className="mt-3 rounded-xl p-3" style={glass.inner}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>Where your ${formattedFee} goes</p>
                <div className="flex flex-col gap-1.5 text-xs">
                  {([
                    { label: 'Platform treasury', pct: '50%', amt: (parseFloat(formattedFee) * 0.5).toFixed(2) },
                    { label: 'Developer royalty', pct: '30%', amt: (parseFloat(formattedFee) * 0.3).toFixed(2) },
                    { label: 'Reporter reward', pct: '20%', amt: (parseFloat(formattedFee) * 0.2).toFixed(2), highlight: true },
                  ] as { label: string; pct: string; amt: string; highlight?: boolean }[]).map(({ label, pct, amt, highlight }) => (
                    <div key={label} className="flex justify-between">
                      <span style={{ color: 'var(--muted)' }}>{label}</span>
                      <span className="font-semibold" style={{ color: highlight ? 'var(--success)' : 'var(--ink)' }}>{pct} · ${amt}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
                <Lock className="size-3" /> Two steps: (1) approve USDC, (2) pay and unlock
              </div>

              {/* D: Insufficient balance warning */}
              {isConnected && !hasSufficientBalance && (
                <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(186,43,76,0.07)', border: '1px solid rgba(186,43,76,0.2)' }}>
                  <AlertTriangle className="size-3.5 shrink-0" style={{ color: 'var(--danger)' }} />
                  <p className="text-xs" style={{ color: 'var(--danger)' }}>
                    Your balance is ${formattedBalance} USDC — you need ${formattedFee}. Get test USDC from the sidebar.
                  </p>
                </div>
              )}

              <button onClick={() => void handlePay()} disabled={!isConnected || isPayBusy || !hasSufficientBalance}
                className="mt-4 w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'var(--danger)' }}>
                {isPayBusy
                  ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />{payLabel}</span>
                  : payLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C: Revealed full record after payment */}
      {isRevealed && (
        <div className="rounded-2xl p-5" style={{ ...glass.card, border: '1.5px solid rgba(186,43,76,0.3)' }}>
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="size-4" style={{ color: 'var(--danger)' }} />
            <span className="display text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--danger)' }}>VERIFIED SCAM PROFILE — FULL REPORT</span>
          </div>

          {revealedRecord ? (
            <div className="flex flex-col gap-3">
              {/* Handle + wallet */}
              <div className="rounded-xl p-4" style={glass.inner}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>Identity</span>
                </div>
                <p className="font-bold" style={{ color: 'var(--ink)' }}>@{revealedRecord.xHandle}</p>
                {revealedRecord.walletAddress && (
                  <p className="mono mt-1 text-xs break-all" style={{ color: 'var(--muted)' }}>{revealedRecord.walletAddress}</p>
                )}
              </div>

              {/* Description */}
              {revealedRecord.description && (
                <div className="rounded-xl p-4" style={glass.inner}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>Scam Description</p>
                  <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--ink)' }}>{revealedRecord.description}</p>
                </div>
              )}

              {/* Evidence URL */}
              {revealedRecord.evidenceUrl && (
                <a href={revealedRecord.evidenceUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold"
                  style={{ background: 'rgba(186,43,76,0.07)', border: '1px solid rgba(186,43,76,0.15)', color: 'var(--danger)' }}>
                  <ExternalLink className="size-4 shrink-0" /> View Evidence
                </a>
              )}

              {/* Reporter + timestamp */}
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
                <span>Reporter: <span className="mono">{revealedRecord.reporter.slice(0, 6)}…{revealedRecord.reporter.slice(-4)}</span></span>
                <span>{new Date(Number(revealedRecord.timestamp) * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
              <Loader2 className="size-4 animate-spin" /> Loading record…
            </div>
          )}

          {/* Always show ArcScan link */}
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noreferrer"
              className="mt-4 flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--accent-hover)' }}>
              <ExternalLink className="size-3" /> View payment transaction on ArcScan
            </a>
          )}

          <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>Reporter's 20% reward has been accrued and is claimable by them.</p>
        </div>
      )}
    </div>
  )
}
