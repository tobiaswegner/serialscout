import { useEffect, useRef, useState, useCallback } from 'react'
import type { PortInfo, LineEndingId } from './env'

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600] as const

const LINE_ENDINGS: Array<{ id: LineEndingId; label: string }> = [
  { id: 'lf', label: 'LF \\n' },
  { id: 'cr', label: 'CR \\r' },
  { id: 'crlf', label: 'CRLF \\r\\n' },
  { id: 'none', label: 'None' },
]

interface LogLine {
  id: string
  dir: 'rx' | 'tx' | 'sys' | 'err'
  text: string
  ts: number
}

// `window.serial` is injected by electron/preload.ts. Falls back to a no-op
// shim so the renderer can run in a plain browser during UI work.
const serial = window.serial ?? {
  list: async (): Promise<PortInfo[]> => [],
  open: async () => ({ ok: false }),
  write: async () => ({ ok: false, bytes: 0 }),
  close: async () => ({ ok: true }),
  onData: () => () => {},
  onError: () => () => {},
  onClosed: () => () => {},
}

export default function App() {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [baud, setBaud] = useState(115200)
  const [connected, setConnected] = useState(false)
  const [lines, setLines] = useState<LogLine[]>([])
  const [command, setCommand] = useState('')
  const [lineEnding, setLineEnding] = useState<LineEndingId>('lf')
  const [autoscroll, setAutoscroll] = useState(true)
  const [rxBytes, setRxBytes] = useState(0)
  const [txBytes, setTxBytes] = useState(0)
  const logRef = useRef<HTMLElement>(null)

  const push = useCallback((dir: LogLine['dir'], text: string) => {
    setLines((prev) => [...prev.slice(-4999), { id: crypto.randomUUID(), dir, text, ts: Date.now() }])
  }, [])

  const refreshPorts = useCallback(async () => {
    const list = await serial.list()
    setPorts(list)
    if (list[0] && !selectedPort) setSelectedPort(list[0].path)
  }, [selectedPort])

  useEffect(() => {
    refreshPorts()
    const offData = serial.onData(({ line }) => {
      setRxBytes((b) => b + line.length)
      push('rx', line)
    })
    const offErr = serial.onError(({ message }) => push('err', message))
    const offClosed = serial.onClosed(() => setConnected(false))
    return () => {
      offData()
      offErr()
      offClosed()
    }
  }, [push, refreshPorts])

  useEffect(() => {
    if (autoscroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [lines, autoscroll])

  async function toggleConnection() {
    if (connected) {
      await serial.close()
      setConnected(false)
      return
    }
    try {
      await serial.open({ path: selectedPort, baudRate: baud })
      setConnected(true)
      push('sys', `Connected to ${selectedPort} @ ${baud} baud`)
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e))
    }
  }

  async function send() {
    if (!command.trim()) return
    try {
      const { bytes } = await serial.write(command, lineEnding)
      setTxBytes((b) => b + (bytes ?? command.length))
      push('tx', command)
      setCommand('')
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">SerialScout</span>
        </div>
        <div className="conn-controls">
          <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
            {ports.length === 0 && <option value="">No ports found</option>}
            {ports.map((p) => (
              <option key={p.path} value={p.path}>
                {p.path}
                {p.manufacturer ? ` — ${p.manufacturer}` : ''}
              </option>
            ))}
          </select>
          <select value={baud} onChange={(e) => setBaud(Number(e.target.value))}>
            {BAUD_RATES.map((b) => (
              <option key={b} value={b}>
                {b} baud
              </option>
            ))}
          </select>
          <button className="btn-ghost" onClick={refreshPorts}>Rescan</button>
          <button className={connected ? 'btn-disconnect' : 'btn-connect'} onClick={toggleConnection}>
            {connected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </header>

      <main className="console" ref={logRef}>
        {lines.length === 0 && <p className="empty">No data yet. Connect a device to begin scouting.</p>}
        {lines.map((l) => (
          <div key={l.id} className={`row row-${l.dir}`}>
            <span className="ts">{new Date(l.ts).toLocaleTimeString()}</span>
            <span className="tag">{l.dir.toUpperCase()}</span>
            <span className="text">{l.text}</span>
          </div>
        ))}
      </main>

      <footer className="composer">
        <input
          type="text"
          placeholder="Type a command and press Enter…"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <select value={lineEnding} onChange={(e) => setLineEnding(e.target.value as LineEndingId)}>
          {LINE_ENDINGS.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
        <button className="btn-send" onClick={send} disabled={!connected}>Send</button>
      </footer>

      <div className="statusbar">
        <span className={`dot ${connected ? 'on' : 'off'}`} />
        <span>{connected ? `${selectedPort} · ${baud} 8N1` : 'Disconnected'}</span>
        <span className="spacer" />
        <span>RX {rxBytes} B</span>
        <span>TX {txBytes} B</span>
        <label className="auto">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          autoscroll
        </label>
      </div>
    </div>
  )
}
