import { NextResponse } from 'next/server'

// Force dynamic — never static-render this route
export const dynamic = 'force-dynamic'
export const revalidate = 0

const NETWORKS = [
  { id: 'mainnet', label: 'Mainnet', rpcUrl: 'https://rpc.mythic.sh', publicUrl: 'rpc.mythic.sh' },
]

async function rpcCall(url: string, method: string, params: unknown[] = [], signal: AbortSignal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal,
  })
  const json = await res.json()
  return json.result
}

async function fetchNetwork(net: typeof NETWORKS[0]) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const [slot, epoch, version, perfSamples, health, txCount] = await Promise.allSettled([
      rpcCall(net.rpcUrl, 'getSlot', [], controller.signal),
      rpcCall(net.rpcUrl, 'getEpochInfo', [], controller.signal),
      rpcCall(net.rpcUrl, 'getVersion', [], controller.signal),
      rpcCall(net.rpcUrl, 'getRecentPerformanceSamples', [4], controller.signal),
      rpcCall(net.rpcUrl, 'getHealth', [], controller.signal),
      rpcCall(net.rpcUrl, 'getTransactionCount', [], controller.signal),
    ])

    const slotVal = slot.status === 'fulfilled' ? slot.value : null
    const epochVal = epoch.status === 'fulfilled' ? epoch.value : null
    const versionVal = version.status === 'fulfilled' ? version.value : null
    const samples = perfSamples.status === 'fulfilled' ? perfSamples.value : []
    const healthVal = health.status === 'fulfilled' ? health.value : null
    const txCountVal = txCount.status === 'fulfilled' ? txCount.value : null

    const isOnline = slotVal !== null && slotVal !== undefined

    // Calculate real metrics from performance samples
    let blockTimeMs: number | null = null
    let slotRate: number | null = null
    let realTps: number | null = null
    let nonVoteTxCount = 0

    if (samples && samples.length > 0) {
      const totalSlots = samples.reduce((s: number, x: { numSlots: number }) => s + x.numSlots, 0)
      const totalSecs = samples.reduce((s: number, x: { samplePeriodSecs: number }) => s + x.samplePeriodSecs, 0)
      const totalNonVoteTxns = samples.reduce((s: number, x: { numNonVoteTransactions: number }) => s + (x.numNonVoteTransactions ?? 0), 0)
      slotRate = totalSlots / totalSecs
      blockTimeMs = Math.round((totalSecs / totalSlots) * 1000)
      realTps = Math.round(totalNonVoteTxns / totalSecs)
      nonVoteTxCount = totalNonVoteTxns
    }

    return {
      network: net.id,
      label: net.label,
      rpcUrl: net.publicUrl,
      online: isOnline,
      healthy: healthVal === 'ok',
      slot: slotVal || 0,
      epoch: epochVal?.epoch ?? 0,
      slotIndex: epochVal?.slotIndex ?? 0,
      slotsInEpoch: epochVal?.slotsInEpoch ?? 0,
      transactionCount: txCountVal ?? epochVal?.transactionCount ?? 0,
      blockTimeMs,
      realTps,
      slotRate,
      version: versionVal ? `${versionVal['solana-core']}` : null,
      timestamp: Date.now(),
    }
  } catch {
    return {
      network: net.id,
      label: net.label,
      rpcUrl: net.publicUrl,
      online: false,
      healthy: false,
      slot: 0,
      epoch: 0,
      slotIndex: 0,
      slotsInEpoch: 0,
      transactionCount: 0,
      blockTimeMs: null,
      realTps: null,
      slotRate: null,
      version: null,
      timestamp: Date.now(),
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET() {
  const networks = await Promise.all(NETWORKS.map(fetchNetwork))

  return NextResponse.json(
    { networks, fetchedAt: new Date().toISOString() },
    {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    }
  )
}
