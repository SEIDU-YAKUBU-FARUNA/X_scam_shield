/**
 * RegisterPanel — Earn tab
 *
 * This component handles everything a reporter needs:
 *
 *   1. REGISTER: Connect wallet → enter your X handle + profile URL → register once on-chain.
 *      Registration is permanent and wallet-bound (one wallet = one reporter identity).
 *
 *   2. SUBMIT REPORT: After registering, submit scam reports.
 *      - X handle and profile link are required.
 *      - Wallet address, evidence URL, description, additional info are optional.
 *      - If the same handle was already reported, your submission is stored as a
 *        CORROBORATION (adds credibility but earns no reward).
 *
 *   3. EARN: Every time someone pays $5 to unlock one of your reports, you earn 20%
 *      ($1.00). Rewards accumulate in pendingRewards[yourWallet] on-chain.
 *
 *   4. CLAIM: Hit "Claim USDC Rewards" to withdraw your accumulated earnings.
 *
 *   5. ACTIVITY: Your full on-chain transaction history is loaded from contract events
 *      (registrations, reports, corroborations, reward claims).
 *
 * On-chain records are loaded via getRecordsByReporter() — an O(1) targeted query
 * that only fetches YOUR records, not the entire registry. This scales to millions
 * of total records without slowing down.
 */
import { useState, useEffect, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { toast } from 'sonner';
import { createPublicClient, http } from 'viem';
import { UserPlus, FileText, Award, ChevronDown, ChevronUp, ExternalLink, Plus, Activity, ArrowUpRight } from 'lucide-react';
import { SCAM_REGISTRY_ABI, SCAM_REGISTRY_ADDRESS, USDC_DECIMALS } from '../contracts';
import { ACTIVE_CHAIN_ID, NETWORK_LABEL, ARC_MAINNET_CHAIN_ID } from '../config';
import { useSwitchChain } from 'wagmi';

const EXPLORER_BASE = ACTIVE_CHAIN_ID === ARC_MAINNET_CHAIN_ID
  ? 'https://explorer.arc.io/tx/'
  : 'https://explorer.testnet.arc.io/tx/';

const ARC_RPC = ACTIVE_CHAIN_ID === ARC_MAINNET_CHAIN_ID
  ? 'https://rpc.mainnet.arc.io'
  : 'https://rpc.testnet.arc.io';

function getPublicClient() {
  return createPublicClient({ transport: http(ARC_RPC) });
}

interface SubmittedRecord {
  xHandle: string;
  profileLink: string;
  walletAddress?: string;
  description?: string;
  submittedAt: Date;
}

interface ActivityItem {
  type: 'register' | 'report' | 'corroborate' | 'claim';
  handle?: string;
  amount?: string;
  txHash: string;
  timestamp: number;
}

interface OnChainRecord {
  key: string;
  xHandle: string;
  profileLink: string;
  walletAddress: string;
  description: string;
  evidenceUrl: string;
  timestamp: bigint;
  status: number;
  corroborationCount: bigint;
}

const STATUS_LABEL = ['Reported', 'Under Review', 'Verified'];
const STATUS_COLOR = ['bg-amber-100 text-amber-800', 'bg-orange-100 text-orange-800', 'bg-red-100 text-red-800'];

function StatusBadge({ status }: { status: number }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[status] ?? STATUS_COLOR[0]}`}>
      {STATUS_LABEL[status] ?? 'Reported'}
    </span>
  );
}

function OnChainRecordCard({ record }: { record: OnChainRecord }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(Number(record.timestamp) * 1000).toLocaleDateString();
  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-gray-900 truncate">@{record.xHandle}</span>
          <StatusBadge status={record.status} />
          {Number(record.corroborationCount) > 0 && (
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
              +{record.corroborationCount.toString()} corroboration{Number(record.corroborationCount) !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-1">{date}</p>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm border-t pt-3">
          {record.walletAddress && <p className="text-gray-600">Wallet: <span className="font-mono text-xs">{record.walletAddress}</span></p>}
          {record.description && <p className="text-gray-700">{record.description}</p>}
          {record.evidenceUrl && (
            <a href={record.evidenceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline text-xs">
              Evidence <ExternalLink size={12} />
            </a>
          )}
          <a href={record.profileLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline text-xs">
            View Scam Profile <ExternalLink size={12} />
          </a>
        </div>
      )}
    </div>
  );
}

function SubmittedRecordCard({ record, txHash }: { record: SubmittedRecord; txHash?: string }) {
  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl p-4">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-900">@{record.xHandle}</span>
        <StatusBadge status={0} />
      </div>
      <p className="text-xs text-gray-500 mt-1">Submitted {record.submittedAt.toLocaleTimeString()}</p>
      {record.description && <p className="text-sm text-gray-700 mt-2">{record.description}</p>}
      {txHash && (
        <a href={`${EXPLORER_BASE}${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2">
          View transaction <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

function ActivityFeed({ address }: { address: `0x${string}` }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const client = getPublicClient();
        const [regLogs, reportLogs, corrLogs, claimLogs] = await Promise.all([
          client.getLogs({
            address: SCAM_REGISTRY_ADDRESS,
            event: { type: 'event', name: 'ReporterRegistered', inputs: [{ name: 'wallet', type: 'address', indexed: true }, { name: 'handle', type: 'string', indexed: false }] } as const,
            args: { wallet: address },
            fromBlock: 0n,
          }).catch(() => []),
          client.getLogs({
            address: SCAM_REGISTRY_ADDRESS,
            event: { type: 'event', name: 'ScamReported', inputs: [{ name: 'key', type: 'bytes32', indexed: true }, { name: 'xHandle', type: 'string', indexed: false }, { name: 'walletAddress', type: 'string', indexed: false }, { name: 'reporter', type: 'address', indexed: true }] } as const,
            args: { reporter: address },
            fromBlock: 0n,
          }).catch(() => []),
          client.getLogs({
            address: SCAM_REGISTRY_ADDRESS,
            event: { type: 'event', name: 'ScamCorroborated', inputs: [{ name: 'key', type: 'bytes32', indexed: true }, { name: 'reporter', type: 'address', indexed: true }, { name: 'totalCorroborations', type: 'uint256', indexed: false }] } as const,
            args: { reporter: address },
            fromBlock: 0n,
          }).catch(() => []),
          client.getLogs({
            address: SCAM_REGISTRY_ADDRESS,
            event: { type: 'event', name: 'RewardClaimed', inputs: [{ name: 'reporter', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] } as const,
            args: { reporter: address },
            fromBlock: 0n,
          }).catch(() => []),
        ]);

        const all: ActivityItem[] = [];

        for (const log of regLogs) {
          all.push({ type: 'register', txHash: log.transactionHash ?? '', timestamp: Number(log.blockNumber ?? 0n) });
        }
        for (const log of reportLogs) {
          const args = log.args as { xHandle?: string };
          all.push({ type: 'report', handle: args.xHandle ?? '', txHash: log.transactionHash ?? '', timestamp: Number(log.blockNumber ?? 0n) });
        }
        for (const log of corrLogs) {
          all.push({ type: 'corroborate', txHash: log.transactionHash ?? '', timestamp: Number(log.blockNumber ?? 0n) });
        }
        for (const log of claimLogs) {
          const args = log.args as { amount?: bigint };
          const amt = args.amount ?? 0n;
          all.push({ type: 'claim', amount: `$${(Number(amt) / 10 ** USDC_DECIMALS).toFixed(2)}`, txHash: log.transactionHash ?? '', timestamp: Number(log.blockNumber ?? 0n) });
        }

        all.sort((a, b) => b.timestamp - a.timestamp);
        setItems(all.slice(0, 20));
      } catch { /* silent */ } finally {
        setLoading(false);
      }
    }
    void load();
  }, [address]);

  const typeConfig = {
    register:    { label: 'Registered as reporter',  color: 'bg-green-100 text-green-700',  icon: UserPlus  },
    report:      { label: 'Submitted report',         color: 'bg-amber-100 text-amber-700',  icon: FileText  },
    corroborate: { label: 'Added corroboration',      color: 'bg-blue-100 text-blue-700',    icon: Plus      },
    claim:       { label: 'Claimed rewards',          color: 'bg-purple-100 text-purple-700', icon: Award    },
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={18} className="text-blue-500" />
        <h3 className="font-semibold text-gray-900">Your Transaction Activity</h3>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Loading activity…
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No transactions yet. Register and submit your first report to see activity here.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => {
            const cfg = typeConfig[item.type];
            const Icon = cfg.icon;
            return (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50">
                <span className={`p-1.5 rounded-lg ${cfg.color}`}>
                  <Icon size={14} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {cfg.label}{item.handle ? `: @${item.handle}` : ''}{item.amount ? ` — ${item.amount} USDC` : ''}
                  </p>
                  <p className="text-xs text-gray-400">Block #{item.timestamp}</p>
                </div>
                {item.txHash && (
                  <a href={`${EXPLORER_BASE}${item.txHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 flex-shrink-0">
                    <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RegisterPanel() {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  // Registration form
  const [regHandle, setRegHandle] = useState('');
  const [regProfileUrl, setRegProfileUrl] = useState('');

  // Scam report form
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [scamHandle, setScamHandle] = useState('');
  const [scamProfileLink, setScamProfileLink] = useState('');
  const [scamWallet, setScamWallet] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [scamDescription, setScamDescription] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');

  // On-chain records (persist across refresh)
  const onChainRecordsRef = useRef<OnChainRecord[]>([]);
  const [onChainVersion, setOnChainVersion] = useState(0);
  const onChainRecords = onChainRecordsRef.current;

  // Session-submitted records (optimistic, before on-chain load)
  const submittedRecordsRef = useRef<SubmittedRecord[]>([]);
  const [submittedCount, setSubmittedCount] = useState(0);
  const submittedRecords = submittedRecordsRef.current;

  // Wagmi hooks
  const { data: reporterData, refetch: refetchReporter } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS,
    abi: SCAM_REGISTRY_ABI,
    functionName: 'getReporter',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: pendingRewardsRaw, refetch: refetchRewards } = useReadContract({
    address: SCAM_REGISTRY_ADDRESS,
    abi: SCAM_REGISTRY_ABI,
    functionName: 'pendingRewards',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { writeContract: writeRegister, data: regTxHash, isPending: isRegPending, isSuccess: isRegSuccess, error: regError, reset: resetReg } = useWriteContract();
  const { isLoading: isRegConfirming, isSuccess: isRegConfirmed } = useWaitForTransactionReceipt({ hash: regTxHash });

  const { writeContract: writeReport, data: reportTxHash, isPending: isReportPending, isSuccess: isReportSuccess, error: reportError, reset: resetReport } = useWriteContract();
  const { isLoading: isReportConfirming, isSuccess: isReportConfirmed } = useWaitForTransactionReceipt({ hash: reportTxHash });

  const { writeContract: writeClaim, data: claimTxHash, isPending: isClaimPending, error: claimError, reset: resetClaim } = useWriteContract();
  const { isLoading: isClaimConfirming, isSuccess: isClaimConfirmed } = useWaitForTransactionReceipt({ hash: claimTxHash });

  const isRegistered = reporterData?.registered === true;
  const isBanned = reporterData?.banned === true;
  const pendingRewards = pendingRewardsRaw ?? 0n;
  const pendingRewardsUsdc = (Number(pendingRewards) / 10 ** USDC_DECIMALS).toFixed(2);

  // Load on-chain records once registered
  const loadOnChainRecords = async () => {
    if (!address) return;
    try {
      const client = getPublicClient();
      const keys = await client.readContract({
        address: SCAM_REGISTRY_ADDRESS,
        abi: SCAM_REGISTRY_ABI,
        functionName: 'getRecordsByReporter',
        args: [address],
      }) as `0x${string}`[];

      const records = await Promise.all(
        keys.slice(0, 50).map(async key => {
          const r = await client.readContract({
            address: SCAM_REGISTRY_ADDRESS,
            abi: SCAM_REGISTRY_ABI,
            functionName: 'getRecordByKey',
            args: [key],
          }) as { xHandle: string; profileLink: string; walletAddress: string; description: string; evidenceUrl: string; timestamp: bigint; status: number; corroborationCount: bigint };
          return { key, ...r };
        })
      );
      onChainRecordsRef.current = records.filter(r => r.xHandle);
      setOnChainVersion(v => v + 1);
    } catch { /* silent */ }
  };

  // Toast effects (no setState — only side effects)
  useEffect(() => {
    if (isRegConfirmed) {
      toast.success('Reporter registered successfully!');
      void refetchReporter();
      void loadOnChainRecords();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRegConfirmed]);

  useEffect(() => {
    if (regError) {
      const msg = regError.message?.split('\n')[0] ?? 'Registration failed';
      toast.error(msg.includes('AlreadyRegistered') ? 'You are already registered.' : msg);
    }
  }, [regError]);

  useEffect(() => {
    if (isReportConfirmed) {
      toast.success('Report submitted and confirmed on-chain!');
      void refetchReporter();
      void loadOnChainRecords();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReportConfirmed]);

  useEffect(() => {
    if (reportError) {
      const msg = reportError.message?.split('\n')[0] ?? 'Submission failed';
      if (msg.includes('NotRegistered'))      toast.error('You must register as a reporter first.');
      else if (msg.includes('ReporterIsBanned')) toast.error('Your reporter account is banned.');
      else toast.error(msg.slice(0, 120));
    }
  }, [reportError]);

  useEffect(() => {
    if (isClaimConfirmed) {
      toast.success('Rewards claimed!');
      void refetchRewards();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClaimConfirmed]);

  useEffect(() => {
    if (claimError) toast.error(claimError.message?.split('\n')[0] ?? 'Claim failed');
  }, [claimError]);

  // Load records when registered
  const prevRegistered = useRef(false);
  useEffect(() => {
    if (isRegistered && !prevRegistered.current) {
      prevRegistered.current = true;
      setShowSubmitForm(true);
      void loadOnChainRecords();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRegistered]);

  const wrongChain = chainId !== ACTIVE_CHAIN_ID;

  async function handleRegister() {
    if (!address) { toast.error('Connect your wallet first.'); return; }
    if (!regHandle.trim()) { toast.error('Handle is required.'); return; }
    if (!regProfileUrl.trim()) { toast.error('Your X profile URL is required.'); return; }
    if (wrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return; }
    resetReg();
    writeRegister({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'registerReporter', args: [regHandle.trim(), regProfileUrl.trim()], chainId: ACTIVE_CHAIN_ID });
  }

  async function handleReport() {
    if (!address) { toast.error('Connect your wallet first.'); return; }
    if (!scamHandle.trim()) { toast.error('Scammer X handle is required.'); return; }
    if (!scamProfileLink.trim()) { toast.error('Scammer profile link is required.'); return; }
    if (wrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return; }
    const fullDescription = [scamDescription.trim(), additionalInfo.trim()].filter(Boolean).join('\n\n');
    submittedRecordsRef.current = [
      { xHandle: scamHandle.trim(), profileLink: scamProfileLink.trim(), walletAddress: scamWallet.trim(), description: fullDescription, submittedAt: new Date() },
      ...submittedRecordsRef.current,
    ];
    setSubmittedCount(c => c + 1);
    resetReport();
    writeReport({
      address: SCAM_REGISTRY_ADDRESS,
      abi: SCAM_REGISTRY_ABI,
      functionName: 'reportScam',
      args: [scamHandle.trim(), scamWallet.trim(), scamProfileLink.trim(), evidenceUrl.trim(), fullDescription],
      chainId: ACTIVE_CHAIN_ID,
    });
  }

  function handleClaim() {
    if (!address) return;
    if (wrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return; }
    resetClaim();
    writeClaim({ address: SCAM_REGISTRY_ADDRESS, abi: SCAM_REGISTRY_ABI, functionName: 'claimRewards', args: [], chainId: ACTIVE_CHAIN_ID });
  }

  function handleSubmitAnother() {
    setScamHandle(''); setScamProfileLink(''); setScamWallet('');
    setEvidenceUrl(''); setScamDescription(''); setAdditionalInfo('');
    resetReport();
  }

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <UserPlus size={40} className="text-gray-300 mb-3" />
        <h3 className="text-lg font-semibold text-gray-700">Connect your wallet to start earning</h3>
        <p className="text-sm text-gray-400 mt-1">Register as a reporter to submit scam reports and earn 20% of every paid lookup.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Rewards bar */}
      {isRegistered && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-green-700 uppercase tracking-wide">Pending Rewards</p>
            <p className="text-2xl font-bold text-green-800">${pendingRewardsUsdc} <span className="text-sm font-normal">USDC</span></p>
          </div>
          <button
            onClick={handleClaim}
            disabled={pendingRewards === 0n || isClaimPending || isClaimConfirming}
            className="px-4 py-2 bg-green-600 text-white font-semibold rounded-xl text-sm disabled:opacity-50 hover:bg-green-700 transition flex items-center gap-2"
          >
            {isClaimPending || isClaimConfirming ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Claiming…</>
            ) : 'Claim USDC Rewards'}
          </button>
        </div>
      )}

      {/* Registration */}
      {!isRegistered && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus size={18} className="text-blue-500" />
            <h3 className="font-semibold text-gray-900">Register as a Reporter</h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">Register once to start submitting reports and earning 20% of every paid lookup on your reports.</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Your X Handle <span className="text-red-500">*</span></label>
              <input
                value={regHandle}
                onChange={e => { setRegHandle(e.target.value); resetReg(); }}
                placeholder="e.g. yourhandle (without @)"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Your X Profile URL <span className="text-red-500">*</span></label>
              <input
                value={regProfileUrl}
                onChange={e => { setRegProfileUrl(e.target.value); resetReg(); }}
                placeholder="https://x.com/yourhandle"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
          <button
            onClick={handleRegister}
            disabled={isRegPending || isRegConfirming}
            className="mt-4 w-full py-2.5 bg-blue-600 text-white font-semibold rounded-xl text-sm hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isRegPending || isRegConfirming ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {isRegConfirming ? 'Confirming…' : 'Registering…'}</>
            ) : isRegSuccess ? '✓ Registered!' : wrongChain ? `Switch to ${NETWORK_LABEL}` : 'Register Wallet'}
          </button>
        </div>
      )}

      {/* Submit scam report */}
      {isRegistered && !isBanned && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-red-500" />
              <h3 className="font-semibold text-gray-900">Submit a Scam Report</h3>
            </div>
            <button onClick={() => setShowSubmitForm(s => !s)} className="text-gray-400 hover:text-gray-600">
              {showSubmitForm ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-4">Scammer X handle and Profile Link are required. All other fields are optional but improve verification quality.</p>

          {showSubmitForm && !isReportSuccess && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Scammer X Handle <span className="text-red-500">*</span></label>
                <input value={scamHandle} onChange={e => { setScamHandle(e.target.value); resetReport(); }}
                  placeholder="e.g. scamaccount"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Scammer Profile Link <span className="text-red-500">*</span></label>
                <input value={scamProfileLink} onChange={e => { setScamProfileLink(e.target.value); resetReport(); }}
                  placeholder="https://x.com/scamaccount"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Scammer Wallet Address <span className="text-gray-400 font-normal">(optional)</span></label>
                <input value={scamWallet} onChange={e => setScamWallet(e.target.value)}
                  placeholder="0x… (optional)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Evidence URL <span className="text-gray-400 font-normal">(optional)</span></label>
                <input value={evidenceUrl} onChange={e => setEvidenceUrl(e.target.value)}
                  placeholder="https://… screenshot or post (optional)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Scam Description <span className="text-gray-400 font-normal">(optional)</span></label>
                <textarea value={scamDescription} onChange={e => setScamDescription(e.target.value)}
                  placeholder="Describe the scam activity… (optional)"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-200 resize-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Additional Information <span className="text-gray-400 font-normal">(optional)</span></label>
                <textarea value={additionalInfo} onChange={e => setAdditionalInfo(e.target.value)}
                  placeholder="Any other relevant details… (optional)"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-200 resize-none" />
              </div>
              <button
                onClick={handleReport}
                disabled={isReportPending || isReportConfirming}
                className="w-full py-2.5 bg-red-600 text-white font-semibold rounded-xl text-sm hover:bg-red-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isReportPending || isReportConfirming ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {isReportConfirming ? 'Confirming…' : 'Submitting…'}</>
                ) : wrongChain ? `Switch to ${NETWORK_LABEL}` : 'Submit Scam Report'}
              </button>
            </div>
          )}

          {isReportSuccess && (
            <div className="mt-3 p-4 bg-green-50 border border-green-200 rounded-xl">
              <p className="text-green-700 font-semibold text-sm">✓ Report submitted successfully!</p>
              <p className="text-xs text-green-600 mt-1">Your report is pending admin review. You will earn 20% of every paid lookup once it is classified.</p>
              {reportTxHash && (
                <a href={`${EXPLORER_BASE}${reportTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2">
                  View transaction <ExternalLink size={12} />
                </a>
              )}
              <button onClick={handleSubmitAnother}
                className="mt-3 flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl text-sm hover:bg-gray-50 transition">
                <Plus size={14} /> Submit Another Report
              </button>
            </div>
          )}
        </div>
      )}

      {isBanned && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
          <p className="text-red-700 font-semibold text-sm">Your reporter account has been banned.</p>
          <p className="text-xs text-red-500 mt-1">Contact the platform administrator if you believe this is an error.</p>
        </div>
      )}

      {/* Session submitted records */}
      {submittedCount > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-3 text-sm">Submitted This Session</h3>
          <div className="space-y-3">
            {submittedRecords.map((r, i) => (
              <SubmittedRecordCard
                key={i}
                record={r}
                txHash={i === 0 && isReportSuccess ? reportTxHash : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* On-chain records */}
      {onChainVersion >= 0 && onChainRecords.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 text-sm">Your Submitted Reports ({onChainRecords.length})</h3>
            <button onClick={() => { void loadOnChainRecords(); }} className="text-xs text-blue-500 hover:underline">Refresh</button>
          </div>
          <div className="space-y-3">
            {onChainRecords.map(r => <OnChainRecordCard key={r.key} record={r} />)}
          </div>
        </div>
      )}

      {/* Activity feed */}
      <ActivityFeed address={address} />
    </div>
  );
}
