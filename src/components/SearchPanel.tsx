/**
 * SearchPanel — Verify tab
 *
 * This component lets anyone search the ArcShield registry to see if an
 * X account or wallet address has been reported.
 *
 * Flow:
 *   1. User types a handle or wallet and presses Check.
 *   2. checkExists() is called for free — it returns (found, status, corroborations).
 *      - Not found → green "No record" card, no fee.
 *      - Found (any status) → 3-second countdown notice, then wallet opens.
 *   3. After the countdown, two transactions fire in sequence:
 *      a. approve() — user allows the contract to take $5 USDC from their wallet.
 *      b. lookupAndPay() — contract takes the $5 and returns the full record.
 *   4. Full evidence card shown: profile link, wallet, description, reporter, corroborations.
 *
 * Why two transactions?
 *   USDC is an ERC-20 token. Before any contract can spend your USDC, you must
 *   explicitly "approve" it — this is a safety mechanism built into ERC-20.
 *   So step (a) approves, then step (b) actually moves the money.
 */
import { useState, useEffect, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import { createPublicClient, http } from 'viem';
import { Search, ShieldCheck, AlertTriangle, AlertOctagon, ExternalLink, Users, Shield } from 'lucide-react';
import { SCAM_REGISTRY_ABI, SCAM_REGISTRY_ADDRESS, ERC20_ABI, USDC_ADDRESS, USDC_DECIMALS } from '../contracts';
import { ACTIVE_CHAIN_ID, NETWORK_LABEL, ARC_MAINNET_CHAIN_ID } from '../config';

// Explorer base URL — switches automatically based on VITE_NETWORK env var
const EXPLORER_BASE = ACTIVE_CHAIN_ID === ARC_MAINNET_CHAIN_ID
  ? 'https://explorer.arc.io/tx/'
  : 'https://explorer.testnet.arc.io/tx/';

const ARC_RPC = ACTIVE_CHAIN_ID === ARC_MAINNET_CHAIN_ID
  ? 'https://rpc.mainnet.arc.io'
  : 'https://rpc.testnet.arc.io';

function getPublicClient() {
  return createPublicClient({ transport: http(ARC_RPC) });
}

// 0=Reported, 1=UnderReview, 2=Verified
const STATUS_LABEL = ['Reported',        'Under Review',       'Verified'         ] as const;
const STATUS_COLOR = ['text-amber-700',  'text-orange-700',    'text-red-700'     ] as const;
const STATUS_BG    = ['bg-amber-50',     'bg-orange-50',       'bg-red-50'        ] as const;
const STATUS_BORDER= ['border-amber-200','border-orange-200',  'border-red-200'   ] as const;
const STATUS_ICON  = [AlertTriangle,      AlertOctagon,         AlertOctagon       ] as const;

interface CheckResult {
  found: boolean;
  reporter: `0x${string}`;
  timestamp: bigint;
  status: number;
  corroborationCount: bigint;
}

interface RevealedRecord {
  xHandle: string;
  walletAddress: string;
  profileLink: string;
  evidenceUrl: string;
  description: string;
  reporter: `0x${string}`;
  timestamp: bigint;
  active: boolean;
  status: number;
  corroborationCount: bigint;
}

interface Corroboration {
  reporter: `0x${string}`;
  reporterHandle: string;
  reporterProfileUrl: string;
  timestamp: bigint;
}

type Phase =
  | 'idle'
  | 'checking'
  | 'not-found'
  | 'countdown'          // brief notice before wallet opens
  | 'approving'
  | 'paying'
  | 'confirming'
  | 'revealed'
  | 'error';

export function SearchPanel() {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [countdown, setCountdown] = useState(3);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [revealedRecord, setRevealedRecord] = useState<RevealedRecord | null>(null);
  const [corroborations, setCorroborations] = useState<Corroboration[]>([]);
  const [reporterHandle, setReporterHandle] = useState<string>('');
  const [reporterProfileUrl, setReporterProfileUrl] = useState<string>('');
  const [lockedQuery, setLockedQuery] = useState('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wrongChain = chainId !== ACTIVE_CHAIN_ID;

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: lookupFeeRaw } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS,
    abi: SCAM_REGISTRY_ABI,
    functionName: 'lookupFee',
    query: { enabled: true },
  });

  const lookupFee = lookupFeeRaw ?? 5_000_000n;
  const usdcBalanceNum = Number(usdcBalance ?? 0n) / 10 ** USDC_DECIMALS;
  const feeDollars = (Number(lookupFee) / 10 ** USDC_DECIMALS).toFixed(2);
  const hasEnough = (usdcBalance ?? 0n) >= lookupFee;

  const { writeContract: doApprove, data: approveTxHash, error: approveError, reset: resetApprove } = useWriteContract();
  const { isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash });

  const { writeContract: doLookup, data: lookupTxHash, error: lookupError, reset: resetLookup } = useWriteContract();
  const { isSuccess: isLookupSuccess } = useWaitForTransactionReceipt({ hash: lookupTxHash });

  // After approval, fire the lookup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isApproveSuccess || phase !== 'approving') return;
    setPhase('paying');
    resetLookup();
    doLookup({
      address: SCAM_REGISTRY_ADDRESS,
      abi: SCAM_REGISTRY_ABI,
      functionName: 'lookupAndPay',
      args: [lockedQuery],
      chainId: ACTIVE_CHAIN_ID,
    });
  }, [isApproveSuccess]);

  // After lookup tx confirmed, read the record
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isLookupSuccess || phase !== 'paying') return;
    setPhase('confirming');
    void (async () => {
      try {
        const client = getPublicClient();
        const normQuery = lockedQuery.toLowerCase().replace(/^@/, '');
        const [hKey, wKey] = await Promise.all([
          client.readContract({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'handleIndex', args: [normQuery] }).catch(() => null),
          client.readContract({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'walletIndex', args: [normQuery] }).catch(() => null),
        ]);
        const key = (hKey && hKey !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? hKey : wKey);
        if (!key) { setPhase('error'); return; }

        const [rec, corrs] = await Promise.all([
          client.readContract({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'getRecordByKey', args: [key] }) as Promise<RevealedRecord>,
          client.readContract({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'getCorroborations', args: [key] }).catch(() => []) as Promise<Corroboration[]>,
        ]);

        // Load reporter handle and profile URL so searchers can verify who made the report
        const reporter = await client.readContract({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'getReporter', args: [rec.reporter] }).catch(() => null) as { handle?: string; profileUrl?: string } | null;
        setReporterHandle(reporter?.handle ?? '');
        setReporterProfileUrl(reporter?.profileUrl ?? '');
        setRevealedRecord(rec);
        setCorroborations(corrs);
        setPhase('revealed');
      } catch {
        setPhase('error');
        toast.error('Could not read record from chain. Try again.');
      }
    })();
  }, [isLookupSuccess]);

  // Approval error
  useEffect(() => {
    if (!approveError) return;
    setPhase('error');
    toast.error(approveError.message?.split('\n')[0] ?? 'Approval failed');
    resetApprove();
  }, [approveError]);

  // Lookup error
  useEffect(() => {
    if (!lookupError) return;
    setPhase('error');
    const msg = lookupError.message?.split('\n')[0] ?? 'Payment failed';
    toast.error(msg);
    resetLookup();
  }, [lookupError]);

  async function handleCheck() {
    if (!query.trim()) return;
    if (wrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return; }

    setPhase('checking');
    setCheckResult(null);
    setRevealedRecord(null);
    setCorroborations([]);
    setReporterHandle('');
    setReporterProfileUrl('');
    const q = query.trim();

    try {
      const client = getPublicClient();
      const result = await client.readContract({
        address: SCAM_REGISTRY_ADDRESS,
        abi: SCAM_REGISTRY_ABI,
        functionName: 'checkExists',
        args: [q],
      }) as [boolean, `0x${string}`, bigint, number, bigint];

      const cr: CheckResult = {
        found:               result[0],
        reporter:            result[1],
        timestamp:           result[2],
        status:              result[3],
        corroborationCount:  result[4],
      };
      setCheckResult(cr);
      setLockedQuery(q);

      if (!cr.found) {
        setPhase('not-found');
        return;
      }

      // Only Verified records (status === 2) are visible to the public and trigger the fee.
      // Reported (0) and Under Review (1) are treated as "not found" for searchers —
      // they are hidden until an admin classifies the record as Verified.
      if (cr.status !== 2) {
        setPhase('not-found');
        return;
      }

      if (!address) {
        toast.info('Connect your wallet to unlock the full report for $' + feeDollars + ' USDC.');
        setPhase('not-found');
        return;
      }

      if (!hasEnough) {
        toast.error(`Insufficient USDC balance. You need $${feeDollars} USDC. Get test USDC from the sidebar.`);
        setPhase('not-found');
        return;
      }

      // Start the 3-second countdown notice before opening the wallet
      setCountdown(3);
      setPhase('countdown');
    } catch {
      setPhase('error');
      toast.error('Failed to check. Make sure you are on ' + NETWORK_LABEL + '.');
    }
  }

  // Countdown timer
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== 'countdown') {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      return;
    }
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          // Fire approval
          setPhase('approving');
          resetApprove();
          doApprove({
            address: USDC_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [SCAM_REGISTRY_ADDRESS, lookupFee],
            chainId: ACTIVE_CHAIN_ID,
          });
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [phase]);

  function handleReset() {
    setPhase('idle');
    setCheckResult(null);
    setRevealedRecord(null);
    setCorroborations([]);
    setReporterHandle('');
    setReporterProfileUrl('');
    setQuery('');
    setLockedQuery('');
    resetApprove();
    resetLookup();
  }

  const statusLabel = checkResult ? STATUS_LABEL[checkResult.status] ?? 'Reported' : '';
  const statusColor = checkResult ? STATUS_COLOR[checkResult.status] ?? STATUS_COLOR[0] : '';
  const statusBg    = checkResult ? STATUS_BG[checkResult.status]    ?? STATUS_BG[0]    : '';
  const statusBorder= checkResult ? STATUS_BORDER[checkResult.status]?? STATUS_BORDER[0]: '';
  const StatusIcon  = checkResult ? STATUS_ICON[checkResult.status]  ?? AlertTriangle   : AlertTriangle;

  return (
    <div className="space-y-4 pb-8">
      {/* Search box */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Search size={18} className="text-blue-500" />
          <h3 className="font-semibold text-gray-900">Verify an Account</h3>
        </div>

        {address && (
          <div className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2 mb-4">
            <span>Your USDC balance</span>
            <span className={`font-semibold ${hasEnough ? 'text-green-600' : 'text-red-500'}`}>
              ${usdcBalanceNum.toFixed(2)} USDC
            </span>
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); if (phase !== 'idle') handleReset(); }}
            onKeyDown={e => { if (e.key === 'Enter' && phase === 'idle') void handleCheck(); }}
            placeholder="Enter X handle or wallet address…"
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            disabled={phase === 'checking' || phase === 'countdown' || phase === 'approving' || phase === 'paying' || phase === 'confirming'}
          />
          <button
            onClick={() => { if (phase === 'idle') void handleCheck(); else handleReset(); }}
            className="px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-xl text-sm hover:bg-blue-700 transition flex items-center gap-2"
          >
            {phase === 'checking' ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Search size={16} />}
            {phase === 'idle' ? 'Check' : phase === 'checking' ? 'Checking…' : 'Reset'}
          </button>
        </div>

        {!address && (
          <p className="text-xs text-gray-400 mt-3 text-center">
            Connect your wallet to pay ${feeDollars} USDC to unlock full evidence on flagged accounts.
          </p>
        )}
      </div>

      {/* Not found */}
      {phase === 'not-found' && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 flex items-center gap-4">
          <ShieldCheck size={32} className="text-green-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800">No record found</p>
            <p className="text-sm text-green-600 mt-0.5">"{lockedQuery}" has no reports in the ArcShield registry.</p>
          </div>
        </div>
      )}

      {/* Countdown notice */}
      {phase === 'countdown' && checkResult && (
        <div className={`${statusBg} border ${statusBorder} rounded-2xl p-6`}>
          <div className="flex items-start gap-4">
            <StatusIcon size={32} className={`${statusColor} flex-shrink-0 mt-0.5`} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className={`font-bold text-lg ${statusColor}`}>{statusLabel} — Record Found</span>
              </div>
              {Number(checkResult.corroborationCount) > 0 && (
                <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
                  <Users size={12} />
                  {checkResult.corroborationCount.toString()} additional reporter{Number(checkResult.corroborationCount) !== 1 ? 's' : ''} confirmed this
                </div>
              )}
              <div className="bg-white bg-opacity-70 rounded-xl p-4 border border-white">
                <p className="text-sm font-semibold text-gray-800 mb-1">Unlocking full evidence in {countdown}…</p>
                <p className="text-xs text-gray-600">Your wallet will open to approve and pay <strong>${feeDollars} USDC</strong>. Two steps: approve then pay.</p>
                <div className="mt-3 text-xs text-gray-500 grid grid-cols-3 gap-2 text-center">
                  <div className="bg-gray-50 rounded-lg p-2">
                    <div className="font-bold text-gray-800">${ (Number(lookupFee) * 0.5 / 10 ** USDC_DECIMALS).toFixed(2) }</div>
                    <div>Treasury (50%)</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <div className="font-bold text-gray-800">${ (Number(lookupFee) * 0.3 / 10 ** USDC_DECIMALS).toFixed(2) }</div>
                    <div>Developer (30%)</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <div className="font-bold text-gray-800">${ (Number(lookupFee) * 0.2 / 10 ** USDC_DECIMALS).toFixed(2) }</div>
                    <div>Reporter (20%)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Approving / Paying / Confirming */}
      {(phase === 'approving' || phase === 'paying' || phase === 'confirming') && checkResult && (
        <div className={`${statusBg} border ${statusBorder} rounded-2xl p-6`}>
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 border-3 border-gray-300 border-t-blue-600 rounded-full animate-spin flex-shrink-0" style={{ borderWidth: 3 }} />
            <div>
              <p className={`font-semibold ${statusColor}`}>
                {phase === 'approving' ? 'Approving USDC…' : phase === 'paying' ? 'Processing payment…' : 'Confirming…'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {phase === 'approving' ? 'Step 1 of 2 — confirm in your wallet' : phase === 'paying' ? 'Step 2 of 2 — confirm the payment in your wallet' : 'Waiting for transaction confirmation…'}
              </p>
              {lookupTxHash && (
                <a href={`${EXPLORER_BASE}${lookupTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2">
                  View transaction <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Revealed record */}
      {phase === 'revealed' && revealedRecord && (
        <div className={`${statusBg} border ${statusBorder} rounded-2xl p-6 space-y-4`}>
          <div className="flex items-start gap-3">
            <StatusIcon size={28} className={`${statusColor} flex-shrink-0 mt-0.5`} />
            <div>
              <p className={`font-bold text-lg ${statusColor}`}>{statusLabel} — @{revealedRecord.xHandle}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Reported {new Date(Number(revealedRecord.timestamp) * 1000).toLocaleDateString()}
                {Number(revealedRecord.corroborationCount) > 0 && (
                  <span className="ml-2">
                    · <Users size={11} className="inline" /> {revealedRecord.corroborationCount.toString()} corroboration{Number(revealedRecord.corroborationCount) !== 1 ? 's' : ''}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* View Scam Profile */}
          <a href={revealedRecord.profileLink} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-red-600 text-white font-semibold rounded-xl text-sm hover:bg-red-700 transition">
            <ExternalLink size={16} /> View Scam Profile
          </a>

          {/* Details grid */}
          <div className="grid gap-3 text-sm bg-white bg-opacity-70 rounded-xl p-4 border border-white">
            {revealedRecord.walletAddress && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-0.5">Wallet Address</p>
                <p className="font-mono text-xs text-gray-700 break-all">{revealedRecord.walletAddress}</p>
              </div>
            )}
            {revealedRecord.description && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-0.5">Description</p>
                <p className="text-gray-700">{revealedRecord.description}</p>
              </div>
            )}
            {revealedRecord.evidenceUrl && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-0.5">Evidence</p>
                <a href={revealedRecord.evidenceUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 hover:underline text-xs">
                  View evidence <ExternalLink size={11} />
                </a>
              </div>
            )}
            {/* Reporter identity — show handle, wallet snippet, and link to their X profile */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Reported by</p>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-xs text-gray-700">
                  <Shield size={11} className="text-gray-400 flex-shrink-0" />
                  {reporterHandle && <span className="font-semibold">@{reporterHandle}</span>}
                  <span className="font-mono text-gray-500">{revealedRecord.reporter.slice(0, 6)}…{revealedRecord.reporter.slice(-4)}</span>
                </div>
                {reporterProfileUrl && (
                  <a href={reporterProfileUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-600 hover:underline text-xs w-fit">
                    View Reporter Profile <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Corroborations */}
          {corroborations.length > 0 && (
            <div className="bg-white bg-opacity-70 rounded-xl p-4 border border-white">
              <div className="flex items-center gap-2 mb-3">
                <Users size={14} className="text-gray-500" />
                <p className="text-xs font-semibold text-gray-700">{corroborations.length} Reporter{corroborations.length !== 1 ? 's' : ''} Also Confirmed This</p>
              </div>
              <div className="space-y-2">
                {corroborations.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs text-gray-600">
                    <span className="font-medium">@{c.reporterHandle}</span>
                    <a href={c.reporterProfileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline flex items-center gap-0.5">
                      profile <ExternalLink size={10} />
                    </a>
                    <span className="text-gray-400">{new Date(Number(c.timestamp) * 1000).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tx link */}
          {lookupTxHash && (
            <a href={`${EXPLORER_BASE}${lookupTxHash}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
              View payment transaction <ExternalLink size={12} />
            </a>
          )}

          <button onClick={handleReset} className="w-full py-2 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50 transition">
            Search another account
          </button>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
          <p className="text-red-700 font-semibold text-sm">Something went wrong.</p>
          <button onClick={handleReset} className="mt-2 text-xs text-blue-600 hover:underline">Try again</button>
        </div>
      )}

      {/* How it works */}
      {phase === 'idle' && (
        <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">How it works</h4>
          <div className="space-y-2 text-xs text-gray-500">
            <div className="flex items-start gap-2">
              <ShieldCheck size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
              <span><strong>Not found</strong> — No reports on record. No fee.</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertOctagon size={13} className="text-red-500 mt-0.5 flex-shrink-0" />
              <span><strong>Verified scam found</strong> — Admin-confirmed. Pay ${feeDollars} USDC to unlock the full evidence and reporter identity.</span>
            </div>
            <div className="flex items-start gap-2 border-t border-gray-200 pt-2 mt-1">
              <Shield size={13} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <span className="text-gray-400">Unverified or under-review reports are not shown to searchers. Only admin-confirmed scams are visible.</span>
            </div>
            <div className="flex items-start gap-2 pt-1 border-t border-gray-200">
              <Users size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />
              <span>The fee splits 50% platform / 30% developer / 20% original reporter.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
