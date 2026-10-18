/**
 * ScamRegistry contract config.
 * Current deployment: Arc Testnet 0xc0a1f9c3eaf36e3cd36af13f7fef4275561ee957
 * owner = treasury wallet (0x7aDbb14b8dDF292AbFe9e7a28abc0433256f4048)
 * developer = immutable (0x4423ef244627b2f3d1D9587919b7c8864aBAB8dA)
 * setTreasury also calls _transferOwnership so owner() and treasury() stay in sync.
 */

export const SCAM_REGISTRY_ADDRESS = (
  import.meta.env.VITE_SCAM_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000'
) as `0x${string}`

export const SCAM_REGISTRY_ABI = [
  // Registration
  {
    name: 'registerReporter',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'handle', type: 'string' }],
    outputs: [],
  },
  // Report a scam
  {
    name: 'reportScam',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'xHandle', type: 'string' },
      { name: 'walletAddress', type: 'string' },
      { name: 'evidenceUrl', type: 'string' },
      { name: 'description', type: 'string' },
    ],
    outputs: [],
  },
  // Paid lookup
  {
    name: 'lookupAndPay',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'query', type: 'string' }],
    outputs: [
      { name: 'found', type: 'bool' },
      {
        name: 'record',
        type: 'tuple',
        components: [
          { name: 'xHandle', type: 'string' },
          { name: 'walletAddress', type: 'string' },
          { name: 'evidenceUrl', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'reporter', type: 'address' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
  // Free existence check (no evidence)
  {
    name: 'checkExists',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'query', type: 'string' }],
    outputs: [
      { name: 'found', type: 'bool' },
      { name: 'reporter', type: 'address' },
      { name: 'timestamp', type: 'uint256' },
    ],
  },
  // Claim reporter rewards
  {
    name: 'claimRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  // Admin: set fee
  {
    name: 'setLookupFee',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newFee', type: 'uint256' }],
    outputs: [],
  },
  // Admin: ban/unban reporter
  {
    name: 'setBanStatus',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'wallet', type: 'address' },
      { name: 'banned', type: 'bool' },
    ],
    outputs: [],
  },
  // Admin: update treasury wallet (50% recipient)
  {
    name: 'setTreasury',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newTreasury', type: 'address' }],
    outputs: [],
  },
  // Admin: deactivate a fake/erroneous report
  {
    name: 'deactivateRecord',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [],
  },
  // Admin: reactivate a previously deactivated report
  {
    name: 'reactivateRecord',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [],
  },
  // Views
  {
    name: 'lookupFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalQueries',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalRevenue',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getReporter',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'wallet', type: 'address' },
          { name: 'handle', type: 'string' },
          { name: 'registered', type: 'bool' },
          { name: 'banned', type: 'bool' },
          { name: 'totalSubmissions', type: 'uint256' },
          { name: 'totalRewardsEarned', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'pendingRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getReporterList',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'getAllRecordKeys',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'developer',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'treasury',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  // Index mappings (for post-payment record lookup)
  {
    name: 'handleIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'string' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'walletIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'string' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'getRecordByKey',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'xHandle', type: 'string' },
          { name: 'walletAddress', type: 'string' },
          { name: 'evidenceUrl', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'reporter', type: 'address' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
  // Paginated record keys (offset, limit) → (page, total)
  {
    name: 'getRecordKeysPaginated',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [
      { name: 'page', type: 'bytes32[]' },
      { name: 'total', type: 'uint256' },
    ],
  },
  // Records by a specific reporter (newest first)
  {
    name: 'getRecordsByReporter',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'reporter', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  // Events
  {
    name: 'ScamReported',
    type: 'event',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'xHandle', type: 'string', indexed: false },
      { name: 'walletAddress', type: 'string', indexed: false },
      { name: 'reporter', type: 'address', indexed: true },
    ],
  },
  {
    name: 'ScamDeactivated',
    type: 'event',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'xHandle', type: 'string', indexed: false },
      { name: 'byAdmin', type: 'address', indexed: true },
    ],
  },
  {
    name: 'ScamReactivated',
    type: 'event',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'xHandle', type: 'string', indexed: false },
      { name: 'byAdmin', type: 'address', indexed: true },
    ],
  },
  {
    name: 'LookupPerformed',
    type: 'event',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'searcher', type: 'address', indexed: true },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'RewardClaimed',
    type: 'event',
    inputs: [
      { name: 'reporter', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const
