/**
 * ArcShield ScamRegistry — contract ABI and addresses
 *
 * Active testnet contract (v8): 0x985a2cd0a3c27264d15437917eb1b937e7cba965
 * Set VITE_SCAM_REGISTRY_ADDRESS in .env to override the fallback address.
 *
 * What is an ABI?
 *   ABI = Application Binary Interface. It's a JSON description of every
 *   function and event the smart contract exposes. The frontend uses it to
 *   know what arguments to send and what values to expect back.
 *
 * How to read this file:
 *   - Functions with stateMutability 'view' are free read-only calls.
 *   - Functions with stateMutability 'nonpayable' cost gas (write to chain).
 *   - Events are emitted by the contract and can be queried as logs.
 */

export const SCAM_REGISTRY_ADDRESS = (
  import.meta.env.VITE_SCAM_REGISTRY_ADDRESS ||
  '0x0000000000000000000000000000000000000000'
) as `0x${string}`;

export const SCAM_REGISTRY_ABI = [
  // registerReporter(handle, profileUrl)
  {
    name: 'registerReporter',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle',     type: 'string' },
      { name: 'profileUrl', type: 'string' },
    ],
    outputs: [],
  },
  // reportScam(xHandle, walletAddress, profileLink, evidenceUrl, description)
  {
    name: 'reportScam',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'xHandle',       type: 'string' },
      { name: 'walletAddress', type: 'string' },
      { name: 'profileLink',   type: 'string' },
      { name: 'evidenceUrl',   type: 'string' },
      { name: 'description',   type: 'string' },
    ],
    outputs: [],
  },
  // checkExists(query) — returns (found, reporter, timestamp, status, corroborationCount)
  {
    name: 'checkExists',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'query', type: 'string' }],
    outputs: [
      { name: 'found',               type: 'bool'    },
      { name: 'reporter',            type: 'address' },
      { name: 'timestamp',           type: 'uint256' },
      { name: 'status',              type: 'uint8'   },
      { name: 'corroborationCount',  type: 'uint256' },
    ],
  },
  // lookupAndPay(query)
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
          { name: 'xHandle',            type: 'string'  },
          { name: 'walletAddress',      type: 'string'  },
          { name: 'profileLink',        type: 'string'  },
          { name: 'evidenceUrl',        type: 'string'  },
          { name: 'description',        type: 'string'  },
          { name: 'reporter',           type: 'address' },
          { name: 'timestamp',          type: 'uint256' },
          { name: 'active',             type: 'bool'    },
          { name: 'status',             type: 'uint8'   },
          { name: 'corroborationCount', type: 'uint256' },
        ],
      },
    ],
  },
  // claimRewards()
  {
    name: 'claimRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  // getReporter(wallet)
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
          { name: 'wallet',              type: 'address' },
          { name: 'handle',              type: 'string'  },
          { name: 'profileUrl',          type: 'string'  },
          { name: 'registered',          type: 'bool'    },
          { name: 'banned',              type: 'bool'    },
          { name: 'totalSubmissions',    type: 'uint256' },
          { name: 'totalRewardsEarned',  type: 'uint256' },
        ],
      },
    ],
  },
  // getRecordByKey(key)
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
          { name: 'xHandle',            type: 'string'  },
          { name: 'walletAddress',      type: 'string'  },
          { name: 'profileLink',        type: 'string'  },
          { name: 'evidenceUrl',        type: 'string'  },
          { name: 'description',        type: 'string'  },
          { name: 'reporter',           type: 'address' },
          { name: 'timestamp',          type: 'uint256' },
          { name: 'active',             type: 'bool'    },
          { name: 'status',             type: 'uint8'   },
          { name: 'corroborationCount', type: 'uint256' },
        ],
      },
    ],
  },
  // getRecordsByReporter(reporter)
  {
    name: 'getRecordsByReporter',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'reporter', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  // getRecordKeysPaginated(offset, limit)
  {
    name: 'getRecordKeysPaginated',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit',  type: 'uint256' },
    ],
    outputs: [
      { name: 'page',  type: 'bytes32[]' },
      { name: 'total', type: 'uint256'   },
    ],
  },
  // getReporterListPaginated(offset, limit)
  {
    name: 'getReporterListPaginated',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit',  type: 'uint256' },
    ],
    outputs: [
      { name: 'page',  type: 'address[]' },
      { name: 'total', type: 'uint256'   },
    ],
  },
  // getCorroborations(key)
  {
    name: 'getCorroborations',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'reporter',           type: 'address' },
          { name: 'reporterHandle',     type: 'string'  },
          { name: 'reporterProfileUrl', type: 'string'  },
          { name: 'timestamp',          type: 'uint256' },
        ],
      },
    ],
  },
  // getCorroborationsPaginated(key, offset, limit)
  {
    name: 'getCorroborationsPaginated',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'key',    type: 'bytes32' },
      { name: 'offset', type: 'uint256' },
      { name: 'limit',  type: 'uint256' },
    ],
    outputs: [
      {
        name: 'page',
        type: 'tuple[]',
        components: [
          { name: 'reporter',           type: 'address' },
          { name: 'reporterHandle',     type: 'string'  },
          { name: 'reporterProfileUrl', type: 'string'  },
          { name: 'timestamp',          type: 'uint256' },
        ],
      },
      { name: 'total', type: 'uint256' },
    ],
  },
  // handleIndex(handle) — public mapping getter
  {
    name: 'handleIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'string' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  // walletIndex(wallet) — public mapping getter
  {
    name: 'walletIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'string' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  // pendingRewards(wallet)
  {
    name: 'pendingRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // lookupFee()
  {
    name: 'lookupFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // treasury()
  {
    name: 'treasury',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  // developer()
  {
    name: 'developer',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  // totalQueries()
  {
    name: 'totalQueries',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // totalRevenue()
  {
    name: 'totalRevenue',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // recordKeys(index)
  {
    name: 'recordKeys',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  // setLookupFee(newFee)
  {
    name: 'setLookupFee',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newFee', type: 'uint256' }],
    outputs: [],
  },
  // setTreasury(newTreasury)
  {
    name: 'setTreasury',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newTreasury', type: 'address' }],
    outputs: [],
  },
  // setDeveloper(newDeveloper)
  {
    name: 'setDeveloper',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newDeveloper', type: 'address' }],
    outputs: [],
  },
  // setBanStatus(wallet, banned)
  {
    name: 'setBanStatus',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'wallet', type: 'address' },
      { name: 'banned', type: 'bool'    },
    ],
    outputs: [],
  },
  // setRecordStatus(key, status)
  {
    name: 'setRecordStatus',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key',    type: 'bytes32' },
      { name: 'status', type: 'uint8'   },
    ],
    outputs: [],
  },
  // deactivateRecord(key)
  {
    name: 'deactivateRecord',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [],
  },
  // reactivateRecord(key)
  {
    name: 'reactivateRecord',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [],
  },

  // ── Events ──────────────────────────────────────────────────────
  {
    name: 'ScamReported',
    type: 'event',
    inputs: [
      { name: 'key',           type: 'bytes32', indexed: true  },
      { name: 'xHandle',       type: 'string',  indexed: false },
      { name: 'walletAddress', type: 'string',  indexed: false },
      { name: 'reporter',      type: 'address', indexed: true  },
    ],
  },
  {
    name: 'ScamCorroborated',
    type: 'event',
    inputs: [
      { name: 'key',                  type: 'bytes32', indexed: true  },
      { name: 'reporter',             type: 'address', indexed: true  },
      { name: 'totalCorroborations',  type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'LookupPerformed',
    type: 'event',
    inputs: [
      { name: 'key',      type: 'bytes32', indexed: true  },
      { name: 'searcher', type: 'address', indexed: true  },
      { name: 'fee',      type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ReporterRegistered',
    type: 'event',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true  },
      { name: 'handle', type: 'string',  indexed: false },
    ],
  },
  {
    name: 'ReporterBanned',
    type: 'event',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true  },
      { name: 'banned', type: 'bool',    indexed: false },
    ],
  },
  {
    name: 'RewardClaimed',
    type: 'event',
    inputs: [
      { name: 'reporter', type: 'address', indexed: true  },
      { name: 'amount',   type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'RewardAccrued',
    type: 'event',
    inputs: [
      { name: 'reporter', type: 'address', indexed: true  },
      { name: 'amount',   type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ScamDeactivated',
    type: 'event',
    inputs: [
      { name: 'key',     type: 'bytes32', indexed: true  },
      { name: 'xHandle', type: 'string',  indexed: false },
      { name: 'byAdmin', type: 'address', indexed: true  },
    ],
  },
  {
    name: 'ScamReactivated',
    type: 'event',
    inputs: [
      { name: 'key',     type: 'bytes32', indexed: true  },
      { name: 'xHandle', type: 'string',  indexed: false },
      { name: 'byAdmin', type: 'address', indexed: true  },
    ],
  },
  {
    name: 'RecordStatusUpdated',
    type: 'event',
    inputs: [
      { name: 'key',       type: 'bytes32', indexed: true  },
      { name: 'status',    type: 'uint8',   indexed: false },
      { name: 'updatedBy', type: 'address', indexed: true  },
    ],
  },
  {
    name: 'LookupFeeUpdated',
    type: 'event',
    inputs: [
      { name: 'oldFee', type: 'uint256', indexed: false },
      { name: 'newFee', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'TreasuryUpdated',
    type: 'event',
    inputs: [
      { name: 'oldTreasury', type: 'address', indexed: true },
      { name: 'newTreasury', type: 'address', indexed: true },
    ],
  },
  {
    name: 'DeveloperUpdated',
    type: 'event',
    inputs: [
      { name: 'oldDeveloper', type: 'address', indexed: true },
      { name: 'newDeveloper', type: 'address', indexed: true },
    ],
  },
] as const;

// USDC on Arc (testnet and mainnet share the same address)
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as `0x${string}`;
export const USDC_DECIMALS = 6;

export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner',   type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
