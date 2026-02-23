import { NextResponse } from 'next/server'

const NETWORKS = [
  { id: 'mainnet', label: 'Mainnet', rpcUrl: 'https://rpc.mythic.sh', publicUrl: 'rpc.mythic.sh' },
  { id: 'testnet', label: 'Testnet', rpcUrl: 'https://rpc.mythic.sh', publicUrl: 'testnet.mythic.sh' },
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

    // Peak TPS = slot production rate × max transactions per slot (65,536)
    // This represents the theoretical throughput capacity of the chain
    let peakTps: number | null = null
    let liveTps: number | null = null

    let slotRate: number | null = null

    if (samples && samples.length > 0) {
      const rates = samples.map((s: { numSlots: number; samplePeriodSecs: number; numTransactions: number }) => {
        const sr = s.numSlots / s.samplePeriodSecs
        return {
          peak: Math.round(sr * 65536),
          active: Math.round(sr * 1000),
          rate: sr,
        }
      })
      peakTps = Math.max(...rates.map((r: { peak: number }) => r.peak))
      liveTps = Math.round(rates.reduce((sum: number, r: { active: number }) => sum + r.active, 0) / rates.length)
      slotRate = rates.reduce((sum: number, r: { rate: number }) => sum + r.rate, 0) / rates.length
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
      peakTps,
      liveTps,
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
      peakTps: null,
      liveTps: null,
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
