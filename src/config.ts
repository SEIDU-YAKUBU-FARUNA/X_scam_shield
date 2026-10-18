/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * Network switching: set VITE_NETWORK=mainnet in .env for Arc Mainnet,
 * or VITE_NETWORK=testnet (default) for Arc Testnet.
 * No source changes needed — flip the env var and restart.
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet, arc } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arc.id, arc.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arc, arcTestnet, mainnet],
  connectors: [injected()],
  transports: {
    [arc.id]: http(),
    [arcTestnet.id]: http(),
    [mainnet.id]: http(), // ENS resolution
  },
})

// Arc Mainnet chain ID
export const ARC_MAINNET_CHAIN_ID = arc.id

// Arc Testnet chain ID
export const ARC_TESTNET_CHAIN_ID = arcTestnet.id

/**
 * ACTIVE_CHAIN_ID — single source of truth for which network the app targets.
 * Driven by VITE_NETWORK env var:
 *   VITE_NETWORK=mainnet  → Arc Mainnet  (real USDC, real gas)
 *   VITE_NETWORK=testnet  → Arc Testnet  (default, test USDC)
 */
export const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet'
export const ACTIVE_CHAIN_ID = IS_MAINNET ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID
export const NETWORK_LABEL = IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'
