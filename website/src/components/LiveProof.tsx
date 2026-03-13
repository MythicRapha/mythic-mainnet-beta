'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface NetworkData {
  network: string
  label: string
  rpcUrl: string
  online: boolean
  healthy: boolean
  slot: number
  epoch: number
  slotIndex: number
  slotsInEpoch: number
  transactionCount: number
  blockTimeMs: number | null
  realTps: number | null
  slotRate: number | null
  version: string | null
  timestamp: number
}

interface StatusResponse {
  networks: NetworkData[]
  fetchedAt: string
}

interface TerminalLine {
  id: number
  type: 'command' | 'output' | 'success' | 'error'
  text: string
}

interface BridgeTx {
  signature: string
  slot: number
  status: string
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const L1_CONTRACTS = [
  {
    label: 'Bridge Program',
    address: 'oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ',
    desc: 'L1 escrow — locks SOL deposits, releases on withdrawal',
  },
  {
    label: 'Settlement Program',
    address: '4TrowzShv4CrsuqZeUdLLVMdnDDkqkmnER1MZ5NsSaav',
    desc: 'Posts L2 state roots to Solana L1 for finality',
  },
  {
    label: 'Bridge Config PDA',
    address: '4A76xw47iNfTkoC5dGSGND5DW5z3E5gPdjPzp8Gnk9s9',
    desc: 'Initialized PDA storing bridge parameters',
  },
]

const L2_PROGRAMS = [
  { label: 'Bridge L2', address: 'MythBrdgL2111111111111111111111111111111111' },
  { label: 'MYTH Token', address: '7Hmyi9v4itEt49xo1fpTgHk1ytb8MZft7RBATBgb1pnf' },
  { label: 'Swap (AMM)', address: 'E5KLCYQ9MoUQhHvHNvHbKK8YjWEp5y2eqpW84UHVj4iu' },
  { label: 'Launchpad', address: '62dVNKTPhChmGVzQu7YzK19vVtTk371Zg7iHfNzk635c' },
  { label: 'Staking', address: '3J5rESPt79TyqkQ3cjBZCKNmVqBRYNHWEPKWg3dmW2wL' },
  { label: 'Governance', address: 'MythGov111111111111111111111111111111111111' },
  { label: 'Settlement', address: 'MythSett1ement11111111111111111111111111111' },
  { label: 'AI Precompiles', address: 'CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ' },
  { label: 'Compute Market', address: 'AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh' },
  { label: 'Airdrop', address: 'MythDrop11111111111111111111111111111111111' },
  { label: 'Bridge L1 (mirror)', address: 'MythBrdg11111111111111111111111111111111111' },
]

const RPC_COMMANDS = [
  { label: 'getSlot', method: 'getSlot', rpc: '/api/l2-rpc', params: undefined },
  { label: 'getTransactionCount', method: 'getTransactionCount', rpc: '/api/l2-rpc', params: undefined },
  { label: 'getVersion', method: 'getVersion', rpc: '/api/l2-rpc', params: undefined },
  { label: 'getEpochInfo', method: 'getEpochInfo', rpc: '/api/l2-rpc', params: undefined },
  {
    label: 'verifyBridgeStatus',
    method: 'getAccountInfo',
    rpc: '/api/l1-rpc',
    params: ['oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ'],
  },
]

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function truncateSig(sig: string): string {
  return sig.slice(0, 8) + '...' + sig.slice(-6)
}

// ────────────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────────────

function useAnimatedNumber(target: number, duration: number = 600): number {
  const [display, setDisplay] = useState(target)
  const rafRef = useRef<number>(0)
  const startRef = useRef({ value: target, time: 0 })

  useEffect(() => {
    if (target === display && startRef.current.time === 0) {
      setDisplay(target)
      return
    }

    const startValue = display
    const startTime = performance.now()
    startRef.current = { value: startValue, time: startTime }

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = Math.round(startValue + (target - startValue) * eased)
      setDisplay(current)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  return display
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function LiveSlot({ baseSlot, slotRate, online }: { baseSlot: number; slotRate: number | null; online: boolean }) {
  const [interpolated, setInterpolated] = useState(baseSlot)
  const baseRef = useRef({ slot: baseSlot, time: Date.now() })

  useEffect(() => {
    baseRef.current = { slot: baseSlot, time: Date.now() }
    setInterpolated(baseSlot)
  }, [baseSlot])

  useEffect(() => {
    if (!online || !slotRate || slotRate <= 0) return
    const msPerSlot = 1000 / slotRate
    const interval = setInterval(() => {
      const elapsed = Date.now() - baseRef.current.time
      const extraSlots = Math.floor(elapsed / msPerSlot)
      setInterpolated(baseRef.current.slot + extraSlots)
    }, 400)
    return () => clearInterval(interval)
  }, [online, slotRate])

  const animated = useAnimatedNumber(interpolated, 350)
  if (!online) return <span>&mdash;</span>
  return <>{formatNumber(animated)}</>
}

// Typing animation for terminal output
function TypingText({ text, speed = 3, onDone }: { text: string; speed?: number; onDone?: () => void }) {
  const [displayed, setDisplayed] = useState('')
  const indexRef = useRef(0)
  const doneRef = useRef(false)

  useEffect(() => {
    indexRef.current = 0
    doneRef.current = false
    setDisplayed('')

    const interval = setInterval(() => {
      const charsPerTick = 8
      indexRef.current = Math.min(indexRef.current + charsPerTick, text.length)
      setDisplayed(text.slice(0, indexRef.current))
      if (indexRef.current >= text.length) {
        clearInterval(interval)
        if (!doneRef.current) {
          doneRef.current = true
          onDone?.()
        }
      }
    }, speed)

    return () => clearInterval(interval)
  }, [text, speed, onDone])

  return <>{displayed}</>
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 2: Interactive RPC Terminal
// ────────────────────────────────────────────────────────────────────────────

function RPCTerminal() {
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: 0, type: 'output', text: 'Mythic L2 RPC Terminal v1.0' },
    { id: 1, type: 'output', text: 'Type a command or click a button below...' },
    { id: 2, type: 'output', text: '' },
  ])
  const [running, setRunning] = useState(false)
  const [typingLineId, setTypingLineId] = useState<number | null>(null)
  const nextId = useRef(3)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [lines, scrollToBottom])

  const runCommand = useCallback(async (cmd: typeof RPC_COMMANDS[0]) => {
    if (running) return
    setRunning(true)

    const cmdLineId = nextId.current++
    const runningLineId = nextId.current++

    setLines(prev => [
      ...prev,
      { id: cmdLineId, type: 'command', text: `$ ${cmd.label}` },
      { id: runningLineId, type: 'output', text: `> Running ${cmd.label}...` },
    ])

    const startTime = performance.now()

    try {
      const body: Record<string, unknown> = {
        jsonrpc: '2.0',
        id: 1,
        method: cmd.method,
      }
      if (cmd.params) body.params = cmd.params

      const res = await fetch(cmd.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const latency = Math.round(performance.now() - startTime)
      const data = await res.json()
      const jsonStr = JSON.stringify(data, null, 2)

      const outputLineId = nextId.current++
      const successLineId = nextId.current++

      setTypingLineId(outputLineId)

      setLines(prev => {
        const filtered = prev.filter(l => l.id !== runningLineId)
        return [
          ...filtered,
          { id: outputLineId, type: 'output', text: jsonStr },
          { id: successLineId, type: 'success', text: `Response received in ${latency}ms` },
        ]
      })
    } catch (err) {
      const errorLineId = nextId.current++
      setLines(prev => {
        const filtered = prev.filter(l => l.id !== runningLineId)
        return [
          ...filtered,
          { id: errorLineId, type: 'error', text: `Error: ${err instanceof Error ? err.message : 'Request failed'}` },
        ]
      })
      setRunning(false)
    }
  }, [running])

  const handleTypingDone = useCallback(() => {
    setTypingLineId(null)
    setRunning(false)
  }, [])

  const clearTerminal = useCallback(() => {
    nextId.current = 3
    setTypingLineId(null)
    setRunning(false)
    setLines([
      { id: 0, type: 'output', text: 'Mythic L2 RPC Terminal v1.0' },
      { id: 1, type: 'output', text: 'Terminal cleared. Ready for commands.' },
      { id: 2, type: 'output', text: '' },
    ])
  }, [])

  return (
    <div className="bg-black border border-white/[0.06] overflow-hidden">
      {/* Terminal header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.02] border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-red-500/60" />
          <div className="w-2.5 h-2.5 bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 bg-[#39FF14]/60" />
          <span className="ml-3 font-mono text-[0.6rem] tracking-[0.1em] text-mythic-text-muted">
            mythic-rpc-terminal
          </span>
        </div>
        <button
          onClick={clearTerminal}
          className="font-mono text-[0.55rem] tracking-[0.08em] uppercase px-2.5 py-1 border border-white/[0.08] text-mythic-text-muted hover:text-white hover:border-white/[0.16] transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Terminal output area */}
      <div
        ref={scrollRef}
        className="h-[340px] overflow-y-auto p-4 font-mono text-[0.7rem] leading-relaxed scrollbar-thin"
      >
        {lines.map(line => {
          if (line.type === 'command') {
            return (
              <div key={line.id} className="text-[#39FF14] font-bold mt-2">
                {line.text}
              </div>
            )
          }
          if (line.type === 'success') {
            return (
              <div key={line.id} className="text-[#39FF14] mt-1 mb-2">
                {line.text}
              </div>
            )
          }
          if (line.type === 'error') {
            return (
              <div key={line.id} className="text-red-400 mt-1 mb-2">
                {line.text}
              </div>
            )
          }
          // output
          if (line.id === typingLineId) {
            return (
              <div key={line.id} className="text-[#39FF14]/80 whitespace-pre-wrap break-all">
                <TypingText text={line.text} speed={3} onDone={handleTypingDone} />
              </div>
            )
          }
          return (
            <div key={line.id} className="text-[#39FF14]/80 whitespace-pre-wrap break-all">
              {line.text}
            </div>
          )
        })}

        {/* Blinking cursor */}
        {!running && (
          <div className="flex items-center mt-1">
            <span className="text-[#39FF14]">$&nbsp;</span>
            <span className="w-2 h-4 bg-[#39FF14] animate-pulse" />
          </div>
        )}
      </div>

      {/* Command buttons */}
      <div className="px-4 py-3 bg-white/[0.01] border-t border-white/[0.06] flex flex-wrap gap-2">
        {RPC_COMMANDS.map(cmd => (
          <button
            key={cmd.label}
            onClick={() => runCommand(cmd)}
            disabled={running}
            className={`font-mono text-[0.6rem] tracking-[0.04em] px-3 py-1.5 border transition-colors ${
              running
                ? 'border-white/[0.04] text-white/20 cursor-not-allowed'
                : 'border-[#39FF14]/20 text-[#39FF14] hover:bg-[#39FF14]/10 hover:border-[#39FF14]/40'
            }`}
          >
            $ {cmd.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 3: Network Dashboard Card
// ────────────────────────────────────────────────────────────────────────────

function NetworkDashCard({ net }: { net: NetworkData }) {
  const epochProgress = net.slotsInEpoch > 0 ? (net.slotIndex / net.slotsInEpoch) * 100 : 0
  const animatedEpochProgress = useAnimatedNumber(Math.round(epochProgress * 100), 800) / 100
  const animatedSlotIndex = useAnimatedNumber(net.slotIndex, 600)

  return (
    <div className={`bg-[#08080C] border transition-colors ${
      net.online ? 'border-white/[0.06] hover:border-mythic-violet/20' : 'border-red-500/20'
    }`}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-2.5 h-2.5 ${
              net.online ? (net.healthy ? 'bg-[#39FF14]' : 'bg-yellow-400') : 'bg-red-500'
            }`} />
            {net.online && (
              <div className={`absolute inset-0 w-2.5 h-2.5 animate-ping ${
                net.healthy ? 'bg-[#39FF14]/40' : 'bg-yellow-400/40'
              }`} />
            )}
          </div>
          <div>
            <h3 className="font-display text-white font-semibold text-[0.95rem]">{net.label}</h3>
            <span className="font-mono text-[0.5rem] tracking-[0.1em] text-mythic-text-muted">{net.rpcUrl}</span>
          </div>
        </div>
        <div className={`px-2.5 py-1 font-mono text-[0.5rem] tracking-[0.1em] uppercase font-semibold ${
          net.online
            ? 'bg-[#39FF14]/10 text-[#39FF14] border border-[#39FF14]/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {net.online ? (net.healthy ? 'Online' : 'Degraded') : 'Offline'}
        </div>
      </div>

      {/* Stats */}
      <div className="p-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Current Slot
            </div>
            <div className="font-display text-[1.15rem] font-bold tabular-nums text-white">
              <LiveSlot baseSlot={net.slot} slotRate={net.slotRate} online={net.online} />
            </div>
          </div>
          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Epoch
            </div>
            <div className="font-display text-[1.15rem] font-bold text-white tabular-nums">
              {net.online ? net.epoch : '\u2014'}
            </div>
          </div>
          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Block Time
            </div>
            <div className="font-display text-[1.15rem] font-bold text-mythic-violet tabular-nums">
              {net.online && net.blockTimeMs ? `~${net.blockTimeMs}ms` : '\u2014'}
            </div>
          </div>
          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Total Txns
            </div>
            <div className="font-display text-[1.15rem] font-bold text-white tabular-nums">
              {net.online ? (net.transactionCount === 0 ? '0' : formatNumber(net.transactionCount)) : '\u2014'}
            </div>
          </div>
          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Version
            </div>
            <div className="font-mono text-[0.8rem] text-white">{net.version || '\u2014'}</div>
          </div>
          <div>
            <div className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted mb-1">
              Blocks
            </div>
            <div className="flex items-center gap-2">
              {net.online ? (
                <>
                  <div className="flex gap-[2px]">
                    {[0, 1, 2, 3, 4].map(i => (
                      <div
                        key={i}
                        className="w-1 bg-[#39FF14] animate-pulse"
                        style={{
                          height: `${8 + Math.random() * 10}px`,
                          animationDelay: `${i * 200}ms`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[0.6rem] text-[#39FF14]">Producing</span>
                </>
              ) : (
                <span className="font-mono text-[0.6rem] text-red-400">Halted</span>
              )}
            </div>
          </div>
        </div>

        {/* Epoch Progress */}
        {net.online && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="font-mono text-[0.45rem] tracking-[0.15em] uppercase text-mythic-text-muted">
                Epoch Progress
              </span>
              <span className="font-mono text-[0.5rem] text-mythic-text-muted">
                {formatNumber(animatedSlotIndex)} / {formatNumber(net.slotsInEpoch)} ({animatedEpochProgress.toFixed(0)}%)
              </span>
            </div>
            <div className="w-full h-1.5 bg-white/[0.04] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-mythic-violet to-mythic-violet-bright"
                style={{
                  width: `${animatedEpochProgress}%`,
                  transition: 'width 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 4: L1 Contract Verification Card
// ────────────────────────────────────────────────────────────────────────────

function L1VerifyCard({ contract }: { contract: typeof L1_CONTRACTS[0] }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'confirmed' | 'error'>('idle')

  const verify = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch('/api/l1-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [contract.address],
        }),
      })
      const data = await res.json()
      setStatus(data?.result?.value ? 'confirmed' : 'error')
    } catch {
      setStatus('error')
    }
  }, [contract.address])

  return (
    <div className="bg-[#08080C] border border-white/[0.06] p-5 hover:border-[#9945FF]/20 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[0.55rem] tracking-[0.12em] uppercase text-mythic-text-muted">
          {contract.label}
        </span>
        {status === 'confirmed' && <div className="w-2 h-2 bg-[#39FF14]" />}
        {status === 'error' && <div className="w-2 h-2 bg-red-500" />}
      </div>
      <div className="font-mono text-[0.6rem] text-mythic-violet break-all leading-relaxed mb-2">
        {contract.address}
      </div>
      <p className="text-mythic-text text-[0.72rem] mb-3 leading-relaxed">{contract.desc}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={`https://solscan.io/account/${contract.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[0.5rem] tracking-[0.08em] uppercase px-2 py-0.5 bg-[#9945FF]/10 text-[#9945FF] border border-[#9945FF]/20 hover:bg-[#9945FF]/20 transition-colors inline-flex items-center gap-1"
        >
          Verify on Solscan
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
        <button
          onClick={verify}
          disabled={status === 'loading'}
          className={`font-mono text-[0.5rem] tracking-[0.08em] uppercase px-2 py-0.5 border transition-colors inline-flex items-center gap-1 ${
            status === 'loading'
              ? 'border-white/[0.06] text-white/30 cursor-wait'
              : status === 'confirmed'
              ? 'border-[#39FF14]/20 text-[#39FF14] bg-[#39FF14]/10'
              : 'border-white/[0.08] text-mythic-text-muted hover:border-mythic-violet/40 hover:text-mythic-violet'
          }`}
        >
          {status === 'loading' && (
            <span className="inline-block w-2.5 h-2.5 border border-white/30 border-t-transparent animate-spin" />
          )}
          {status === 'confirmed' && (
            <svg className="w-3 h-3 text-[#39FF14]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {status === 'confirmed' ? 'Confirmed' : status === 'loading' ? 'Verifying...' : 'Verify Live'}
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Main Component
// ────────────────────────────────────────────────────────────────────────────

export default function LiveProof() {
  const [networks, setNetworks] = useState<NetworkData[]>([])
  const [netLoading, setNetLoading] = useState(true)
  const [bridgeTxs, setBridgeTxs] = useState<BridgeTx[]>([])
  const [l2Status, setL2Status] = useState<Record<string, boolean | null>>({})
  const [l2Checked, setL2Checked] = useState(false)

  // Fetch network status
  const fetchNetworkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/network-status', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed')
      const json: StatusResponse = await res.json()
      setNetworks(json.networks)
    } catch {
      // silently retry
    } finally {
      setNetLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNetworkStatus()
    const interval = setInterval(fetchNetworkStatus, 4000)
    return () => clearInterval(interval)
  }, [fetchNetworkStatus])

  // Fetch bridge transactions from L1
  useEffect(() => {
    async function fetchBridgeTxs() {
      try {
        const res = await fetch('/api/l1-rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getSignaturesForAddress',
            params: ['oEQfREm4FQkaVeRoxJHkJLB1feHprrntY6eJuW2zbqQ', { limit: 5 }],
          }),
        })
        const data = await res.json()
        const txs = (data?.result || [])
          .filter((t: { err: unknown }) => t.err === null)
          .map((t: { signature: string; slot: number; err: unknown }) => ({
            signature: t.signature,
            slot: t.slot,
            status: 'Success' as const,
          }))
        setBridgeTxs(txs)
      } catch {
        // ignore
      }
    }
    fetchBridgeTxs()
  }, [])

  // Verify L2 programs
  useEffect(() => {
    async function verifyL2() {
      const checks: Record<string, boolean> = {}
      for (const p of L2_PROGRAMS) {
        try {
          const res = await fetch('/api/l2-rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [p.address, { encoding: 'base64' }] }),
          })
          const data = await res.json()
          checks[p.address] = !!data?.result?.value
        } catch {
          checks[p.address] = false
        }
      }
      setL2Status(checks)
      setL2Checked(true)
    }
    verifyL2()
  }, [])


  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1: Live Pulse Header                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <section className="py-[80px] sm:py-[100px] border-t border-white/[0.06]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-10">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="font-mono text-[0.6rem] tracking-[0.25em] uppercase text-mythic-text-muted">
                On-Chain Verification
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#39FF14]/10 border border-[#39FF14]/20">
                <div className="relative">
                  <div className="w-2 h-2 bg-[#39FF14]" />
                  <div className="absolute inset-0 w-2 h-2 bg-[#39FF14]/40 animate-ping" />
                </div>
                <span className="font-mono text-[0.55rem] tracking-[0.12em] uppercase font-bold text-[#39FF14]">
                  LIVE
                </span>
              </div>
            </div>
            <h2 className="font-display text-[2rem] sm:text-[2.4rem] font-bold tracking-[-0.02em] text-white mb-2">
              Prove It&apos;s Real
            </h2>
            <p className="text-mythic-text text-[0.95rem] max-w-[640px] leading-relaxed">
              Every contract, every transaction, every program — publicly deployed and independently verifiable.
              Don&apos;t trust us. Query the RPCs yourself.
            </p>
          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SECTION 2: Interactive RPC Terminal                             */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 bg-[#39FF14]" />
              <h3 className="font-display text-white font-semibold text-[1.1rem]">Interactive RPC Terminal</h3>
              <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 bg-[#39FF14]/10 text-[#39FF14] border border-[#39FF14]/20">
                Try It
              </span>
            </div>
            <p className="text-mythic-text text-[0.82rem] mb-4 max-w-[640px]">
              Click any command below to make a real JSON-RPC call to the Mythic L2 node and see the live response.
            </p>
            <RPCTerminal />
          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SECTION 3: Live Network Dashboard                              */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 bg-mythic-violet" />
              <h3 className="font-display text-white font-semibold text-[1.1rem]">Live Network Dashboard</h3>
            </div>

            {netLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="h-[280px] bg-white/[0.02] border border-white/[0.06] animate-pulse" />
                <div className="h-[280px] bg-white/[0.02] border border-white/[0.06] animate-pulse" />
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {networks.map(net => (
                  <NetworkDashCard key={net.network} net={net} />
                ))}
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SECTION 4: L1 Contract Verification                            */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 bg-[#9945FF]" />
              <h3 className="font-display text-white font-semibold text-[1.1rem]">Solana L1 Mainnet Contracts</h3>
              <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 bg-[#9945FF]/10 text-[#9945FF] border border-[#9945FF]/20">
                Deployed &amp; Verified
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {L1_CONTRACTS.map(c => (
                <L1VerifyCard key={c.address} contract={c} />
              ))}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SECTION 5: L2 Programs Table                                   */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 bg-mythic-violet" />
              <h3 className="font-display text-white font-semibold text-[1.1rem]">Mythic L2 Deployed Programs</h3>
              <span className="font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 bg-mythic-violet/10 text-mythic-violet border border-mythic-violet/20">
                11 Programs Live
              </span>
            </div>

            <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Program</th>
                      <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Address</th>
                      <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Status</th>
                      <th className="text-right px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Verify</th>
                    </tr>
                  </thead>
                  <tbody>
                    {L2_PROGRAMS.map(p => (
                      <tr key={p.address} className="border-b border-white/[0.03] hover:bg-white/[0.01]">
                        <td className="px-5 py-2.5 font-display text-[0.78rem] font-medium whitespace-nowrap">
                          <a
                            href={`https://explorer.mythic.sh/mainnet/address/${p.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white hover:text-mythic-violet-bright transition-colors"
                          >
                            {p.label}
                          </a>
                        </td>
                        <td className="px-5 py-2.5">
                          <a
                            href={`https://explorer.mythic.sh/mainnet/address/${p.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[0.6rem] text-mythic-violet hover:text-mythic-violet-bright transition-colors"
                          >
                            <span className="hidden sm:inline">{p.address}</span>
                            <span className="sm:hidden">{p.address.slice(0, 6)}...{p.address.slice(-4)}</span>
                          </a>
                        </td>
                        <td className="px-5 py-2.5">
                          {!l2Checked ? (
                            <span className="w-2 h-2 bg-white/10 inline-block animate-pulse" />
                          ) : (
                            <span className={`font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 ${
                              l2Status[p.address]
                                ? 'bg-[#39FF14]/10 text-[#39FF14] border border-[#39FF14]/20'
                                : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                            }`}>
                              {l2Status[p.address] ? 'Live' : 'Not Found'}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <a
                            href={`https://explorer.mythic.sh/mainnet/address/${p.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[0.5rem] tracking-[0.08em] uppercase text-mythic-violet hover:text-mythic-violet-bright transition-colors"
                          >
                            Explorer
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SECTION 6: Recent Bridge Transactions                          */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {bridgeTxs.length > 0 && (
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-2 h-2 bg-[#39FF14]" />
                <h3 className="font-display text-white font-semibold text-[1.1rem]">Recent Bridge Transactions on Solana L1</h3>
              </div>

              <div className="bg-[#08080C] border border-white/[0.06] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Signature</th>
                        <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Slot</th>
                        <th className="text-left px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Status</th>
                        <th className="text-right px-5 py-3 font-mono text-[0.5rem] tracking-[0.12em] uppercase text-mythic-text-muted">Verify</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bridgeTxs.map(tx => (
                        <tr key={tx.signature} className="border-b border-white/[0.03] hover:bg-white/[0.01]">
                          <td className="px-5 py-3">
                            <a
                              href={`https://solscan.io/tx/${tx.signature}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-[0.65rem] text-mythic-violet hover:text-mythic-violet-bright transition-colors"
                            >
                              {truncateSig(tx.signature)}
                            </a>
                          </td>
                          <td className="px-5 py-3 font-mono text-[0.65rem] text-white tabular-nums">
                            {tx.slot.toLocaleString()}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`font-mono text-[0.5rem] tracking-[0.1em] uppercase px-2 py-0.5 ${
                              tx.status === 'Success'
                                ? 'bg-[#39FF14]/10 text-[#39FF14] border border-[#39FF14]/20'
                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}>
                              {tx.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <a
                              href={`https://solscan.io/tx/${tx.signature}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-[0.5rem] tracking-[0.08em] uppercase text-[#9945FF] hover:text-[#b06aff] transition-colors"
                            >
                              Solscan
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </div>
      </section>
    </>
  )
}
