import { useEffect, useRef, useState, useCallback } from 'react'
import type { PortInfo, LineEndingId } from './env'

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600] as const

const LINE_ENDINGS: Array<{ id: LineEndingId; label: string }> = [
  { id: 'lf', label: 'LF \\n' },
  { id: 'cr', label: 'CR \\r' },
  { id: 'crlf', label: 'CRLF \\r\\n' },
  { id: 'none', label: 'None' },
]

type TsFormat = 'clock' | 'relative' | 'hidden'

interface LogLine {
  id: string
  dir: 'rx' | 'tx' | 'sys' | 'err'
  text: string
  ts: number
}

// Falls back to a no-op shim so the renderer can run in a plain browser during UI work.
const serial = window.serial ?? {
  list: async (): Promise<PortInfo[]> => [],
  open: async () => ({ ok: false }),
  write: async () => ({ ok: false, bytes: 0 }),
  close: async () => ({ ok: true }),
  onData: () => () => {},
  onError: () => () => {},
  onClosed: () => () => {},
  exportLog: async () => ({ ok: false }),
  importLog: async () => ({ ok: false, content: null }),
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
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [tsFormat, setTsFormat] = useState<TsFormat>('clock')
  const [hexView, setHexView] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [filterVisible, setFilterVisible] = useState(false)

  const logRef = useRef<HTMLElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const sessionStart = useRef(Date.now())

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setFilterVisible((v) => {
          if (!v) setTimeout(() => filterInputRef.current?.focus(), 0)
          return !v
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function toggleConnection() {
    if (connected) {
      await serial.close()
      setConnected(false)
      return
    }
    try {
      await serial.open({ path: selectedPort, baudRate: baud })
      setConnected(true)
      sessionStart.current = Date.now()
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
      setHistory((prev) => [command, ...prev.filter((h) => h !== command)].slice(0, 100))
      setHistoryIndex(-1)
      setCommand('')
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e))
    }
  }

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { send(); return }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(historyIndex + 1, history.length - 1)
      if (next >= 0) { setHistoryIndex(next); setCommand(history[next]) }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = historyIndex - 1
      setHistoryIndex(next)
      setCommand(next < 0 ? '' : (history[next] ?? ''))
    }
  }

  function cycleTs() {
    setTsFormat((f) => (f === 'clock' ? 'relative' : f === 'relative' ? 'hidden' : 'clock'))
  }

  function formatTs(ts: number): string {
    if (tsFormat === 'relative') return `+${((ts - sessionStart.current) / 1000).toFixed(3)}s`
    if (tsFormat === 'hidden') return ''
    return new Date(ts).toLocaleTimeString()
  }

  function renderText(dir: LogLine['dir'], text: string): string {
    if (!hexView || dir !== 'rx') return text
    return Array.from(text).map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ')
  }

  async function exportLog() {
    const content = lines
      .map((l) => `[${new Date(l.ts).toISOString()}] [${l.dir.toUpperCase()}] ${l.text}`)
      .join('\n')
    await serial.exportLog(content)
  }

  async function importLog() {
    const result = await serial.importLog()
    if (!result.ok || !result.content) return
    const imported: LogLine[] = result.content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const m = line.match(/^\[([^\]]+)\] \[(RX|TX|SYS|ERR)\] (.*)$/)
        if (m) {
          return {
            id: crypto.randomUUID(),
            dir: m[2].toLowerCase() as LogLine['dir'],
            text: m[3],
            ts: new Date(m[1]).getTime() || Date.now(),
          }
        }
        return { id: crypto.randomUUID(), dir: 'sys' as const, text: line, ts: Date.now() }
      })
    push('sys', `─── Imported ${imported.length} lines ───`)
    setLines((prev) => [...prev, ...imported].slice(-4999))
  }

  const filteredLines = filterText
    ? lines.filter((l) => l.text.toLowerCase().includes(filterText.toLowerCase()))
    : lines

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
                {p.path}{p.manufacturer ? ` — ${p.manufacturer}` : ''}
              </option>
            ))}
          </select>
          <select value={baud} onChange={(e) => setBaud(Number(e.target.value))}>
            {BAUD_RATES.map((b) => (
              <option key={b} value={b}>{b} baud</option>
            ))}
          </select>
          <button className="btn-ghost" onClick={refreshPorts}>Rescan</button>
          <button className={connected ? 'btn-disconnect' : 'btn-connect'} onClick={toggleConnection}>
            {connected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
        <div className="session-controls">
          <button className="btn-ghost" onClick={importLog}>Import</button>
          <button className="btn-ghost" onClick={exportLog} disabled={lines.length === 0}>Export</button>
        </div>
      </header>

      <div className="console-wrapper">
        {filterVisible && (
          <div className="filter-bar">
            <input
              ref={filterInputRef}
              type="text"
              placeholder="Filter lines…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setFilterVisible(false); setFilterText('') }
              }}
            />
            <span className="filter-count">{filteredLines.length} / {lines.length}</span>
            <button
              className="btn-ghost"
              style={{ padding: '4px 10px' }}
              onClick={() => { setFilterVisible(false); setFilterText('') }}
            >✕</button>
          </div>
        )}
        <main className="console" ref={logRef}>
          {lines.length === 0 && (
            <p className="empty">No data yet. Connect a device to begin scouting.</p>
          )}
          {lines.length > 0 && filteredLines.length === 0 && (
            <p className="empty">No lines match the current filter.</p>
          )}
          {filteredLines.map((l) => (
            <div key={l.id} className={`row row-${l.dir}`}>
              <span className="ts">{formatTs(l.ts)}</span>
              <span className="tag">{l.dir.toUpperCase()}</span>
              <span className="text">{renderText(l.dir, l.text)}</span>
            </div>
          ))}
        </main>
      </div>

      <footer className="composer">
        <input
          type="text"
          placeholder="Type a command and press Enter… (↑↓ history)"
          value={command}
          onChange={(e) => { setCommand(e.target.value); setHistoryIndex(-1) }}
          onKeyDown={handleInputKey}
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
        <button
          className={`btn-toggle${hexView ? ' active' : ''}`}
          onClick={() => setHexView((h) => !h)}
          title="Toggle hex view (RX only)"
        >HEX</button>
        <button
          className={`btn-toggle${tsFormat !== 'clock' ? ' active' : ''}`}
          onClick={cycleTs}
          title="Cycle timestamps: clock → relative → hidden"
        >TS</button>
        <button
          className={`btn-toggle${filterVisible ? ' active' : ''}`}
          onClick={() => setFilterVisible((v) => {
            if (!v) setTimeout(() => filterInputRef.current?.focus(), 0)
            return !v
          })}
          title="Toggle filter bar (Ctrl+F)"
        >FILTER</button>
        <button
          className="btn-toggle"
          onClick={() => setLines([])}
          title="Clear console"
        >CLEAR</button>
        <label className="auto">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          autoscroll
        </label>
      </div>
    </div>
  )
}
