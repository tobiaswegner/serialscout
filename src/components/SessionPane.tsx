import { useEffect, useRef, useState, useCallback } from "react";
import type { PortInfo, LineEndingId, PortSettings } from "../env";

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600] as const;

const DATA_BITS = [5, 6, 7, 8] as const;
const STOP_BITS = [1, 1.5, 2] as const;
const PARITIES = [
  { value: "none", label: "None" },
  { value: "even", label: "Even" },
  { value: "odd", label: "Odd" },
  { value: "mark", label: "Mark" },
  { value: "space", label: "Space" },
] as const;

const PARITY_ABBREV: Record<string, string> = {
  none: "N",
  even: "E",
  odd: "O",
  mark: "M",
  space: "S",
};

const LINE_ENDINGS: Array<{ id: LineEndingId; label: string }> = [
  { id: "lf", label: "LF \\n" },
  { id: "cr", label: "CR \\r" },
  { id: "crlf", label: "CRLF \\r\\n" },
  { id: "none", label: "None" },
];

type TsFormat = "clock" | "relative" | "hidden";

interface LogLine {
  id: string;
  dir: "rx" | "tx" | "sys" | "err";
  text: string;
  ts: number;
}

// Falls back to a no-op shim so the renderer can run in a plain browser during UI work.
const serial = window.serial ?? {
  list: async (): Promise<PortInfo[]> => [],
  open: async () => ({ ok: false }),
  write: async () => ({ ok: false, bytes: 0 }),
  close: async () => ({ ok: true }),
  status: async () => [],
  onData: () => () => {},
  onTx: () => () => {},
  onState: () => () => {},
  onError: () => () => {},
  onClosed: () => () => {},
  exportLog: async () => ({ ok: false }),
  importLog: async () => ({ ok: false, content: null }),
};

export function describeSettings(s: PortSettings): string {
  const flow = [s.rtscts && "RTS/CTS", (s.xon || s.xoff) && "XON/XOFF"].filter(Boolean).join("+");
  return `${s.baudRate} ${s.dataBits}${PARITY_ABBREV[s.parity]}${s.stopBits}${flow ? ` · ${flow}` : ""}`;
}

interface Props {
  ports: PortInfo[];
  /** Ports another pane is already using — a port can only be followed by one pane. */
  takenPaths: string[];
  /** Settings of a port that was already open when this pane was created. */
  adopt?: PortSettings;
  /** Whether this is the pane keyboard shortcuts apply to. */
  active: boolean;
  /** Whether the pane is on screen (a background tab keeps receiving data). */
  visible: boolean;
  onActivate: () => void;
  /** Reports the port this pane follows, or null once it lets go of it. */
  onPath: (path: string | null) => void;
  onRescan: () => void;
  /** Set when the pane can be removed from the header (split layouts). */
  onClose?: () => void;
}

export default function SessionPane({
  ports,
  takenPaths,
  adopt,
  active,
  visible,
  onActivate,
  onPath,
  onRescan,
  onClose,
}: Props) {
  const [selectedPort, setSelectedPort] = useState(adopt?.path ?? "");
  const [baud, setBaud] = useState(adopt?.baudRate ?? 115200);
  const [dataBits, setDataBits] = useState<5 | 6 | 7 | 8>(adopt?.dataBits ?? 8);
  const [stopBits, setStopBits] = useState<1 | 1.5 | 2>(adopt?.stopBits ?? 1);
  const [parity, setParity] = useState<"none" | "even" | "odd" | "mark" | "space">(
    adopt?.parity ?? "none",
  );
  const [rtscts, setRtscts] = useState(adopt?.rtscts ?? false);
  const [xonxoff, setXonxoff] = useState(adopt ? adopt.xon || adopt.xoff : false);
  const [connected, setConnected] = useState(!!adopt);
  const [copied, setCopied] = useState(false);
  const [lines, setLines] = useState<LogLine[]>(() =>
    adopt
      ? [
          {
            id: crypto.randomUUID(),
            dir: "sys",
            text: `Joined ${adopt.path} — already open · ${describeSettings(adopt)}`,
            ts: Date.now(),
          },
        ]
      : [],
  );
  const [command, setCommand] = useState("");
  const [lineEnding, setLineEnding] = useState<LineEndingId>("lf");
  const [autoscroll, setAutoscroll] = useState(true);
  const [rxBytes, setRxBytes] = useState(0);
  const [txBytes, setTxBytes] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tsFormat, setTsFormat] = useState<TsFormat>("clock");
  const [hexView, setHexView] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [filterVisible, setFilterVisible] = useState(false);

  const logRef = useRef<HTMLElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const sessionStart = useRef(Date.now());
  // The port this pane is following. The main process may reconfigure or close
  // it on an agent's behalf, so this is not always in step with the selector.
  const activePath = useRef<string | null>(adopt?.path ?? null);
  const onPathRef = useRef(onPath);
  onPathRef.current = onPath;

  const push = useCallback((dir: LogLine["dir"], text: string) => {
    setLines((prev) => [
      ...prev.slice(-4999),
      { id: crypto.randomUUID(), dir, text, ts: Date.now() },
    ]);
  }, []);

  // Pick a free port once the list is known (and again if the current one is taken).
  useEffect(() => {
    if (connected) return;
    setSelectedPort((current) => {
      if (current && !takenPaths.includes(current)) return current;
      return ports.find((p) => !takenPaths.includes(p.path))?.path ?? current;
    });
  }, [ports, takenPaths, connected]);

  useEffect(() => {
    const offData = serial.onData(({ path, line }) => {
      if (path !== activePath.current) return;
      setRxBytes((b) => b + line.length);
      push("rx", line);
    });
    const offTx = serial.onTx(({ path, text, bytes, source }) => {
      if (path !== activePath.current) return;
      setTxBytes((b) => b + bytes);
      push("tx", source === "mcp" ? `[agent] ${text}` : text);
    });
    const offState = serial.onState(({ path, open, settings, source }) => {
      if (path !== activePath.current) return;
      if (!open) {
        activePath.current = null;
        onPathRef.current(null);
        setConnected(false);
        push("sys", `${source === "mcp" ? "Agent closed" : "Closed"} ${path}`);
        return;
      }
      // Reconfigured while open (or confirmation of our own open).
      setBaud(settings.baudRate);
      setDataBits(settings.dataBits);
      setStopBits(settings.stopBits);
      setParity(settings.parity);
      setRtscts(settings.rtscts);
      setXonxoff(settings.xon || settings.xoff);
      setConnected(true);
      if (source === "mcp") {
        push("sys", `Agent reconfigured ${path} · ${describeSettings(settings)}`);
      }
    });
    const offErr = serial.onError(({ path, message }) => {
      if (path === activePath.current) push("err", message);
    });

    return () => {
      offData();
      offTx();
      offState();
      offErr();
    };
  }, [push]);

  useEffect(() => {
    if (visible && autoscroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines, autoscroll, visible]);

  useEffect(() => {
    if (!active || !visible) return;
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setFilterVisible((v) => {
          if (!v) setTimeout(() => filterInputRef.current?.focus(), 0);
          return !v;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, visible]);

  async function toggleConnection() {
    if (connected) {
      if (activePath.current) await serial.close(activePath.current);
      return;
    }
    if (!selectedPort) return;
    activePath.current = selectedPort;
    onPath(selectedPort);
    try {
      await serial.open({
        path: selectedPort,
        baudRate: baud,
        dataBits,
        stopBits,
        parity,
        rtscts,
        xon: xonxoff,
        xoff: xonxoff,
      });
      sessionStart.current = Date.now();
      setConnected(true);
      const parityChar = PARITY_ABBREV[parity];
      const flowInfo = [rtscts && "RTS/CTS", xonxoff && "XON/XOFF"].filter(Boolean).join("+");
      push(
        "sys",
        `Connected to ${selectedPort} @ ${baud} ${dataBits}${parityChar}${stopBits}${flowInfo ? ` · ${flowInfo}` : ""}`,
      );
    } catch (e) {
      activePath.current = null;
      onPath(null);
      push("err", e instanceof Error ? e.message : String(e));
    }
  }

  async function send() {
    if (!command.trim() || !activePath.current) return;
    try {
      await serial.write(command, lineEnding, activePath.current);
      setHistory((prev) => [command, ...prev.filter((h) => h !== command)].slice(0, 100));
      setHistoryIndex(-1);
      setCommand("");
    } catch (e) {
      push("err", e instanceof Error ? e.message : String(e));
    }
  }

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      send();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      if (next >= 0) {
        setHistoryIndex(next);
        setCommand(history[next]);
      }
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setCommand(next < 0 ? "" : (history[next] ?? ""));
    }
  }

  function cycleTs() {
    setTsFormat((f) => (f === "clock" ? "relative" : f === "relative" ? "hidden" : "clock"));
  }

  function formatTs(ts: number): string {
    if (tsFormat === "relative") return `+${((ts - sessionStart.current) / 1000).toFixed(3)}s`;
    if (tsFormat === "hidden") return "";
    return new Date(ts).toLocaleTimeString();
  }

  function copySelection() {
    const sel = window.getSelection();
    const text = sel && logRef.current?.contains(sel.anchorNode) ? sel.toString() : "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  function renderText(dir: LogLine["dir"], text: string): string {
    if (!hexView || dir !== "rx") return text;
    return Array.from(text)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(" ");
  }

  async function exportLog() {
    const content = lines
      .map((l) => `[${new Date(l.ts).toISOString()}] [${l.dir.toUpperCase()}] ${l.text}`)
      .join("\n");
    await serial.exportLog(content);
  }

  async function importLog() {
    const result = await serial.importLog();
    if (!result.ok || !result.content) return;
    const imported: LogLine[] = result.content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const m = line.match(/^\[([^\]]+)\] \[(RX|TX|SYS|ERR)\] (.*)$/);
        if (m) {
          return {
            id: crypto.randomUUID(),
            dir: m[2].toLowerCase() as LogLine["dir"],
            text: m[3],
            ts: new Date(m[1]).getTime() || Date.now(),
          };
        }
        return {
          id: crypto.randomUUID(),
          dir: "sys" as const,
          text: line,
          ts: Date.now(),
        };
      });
    push("sys", `─── Imported ${imported.length} lines ───`);
    setLines((prev) => [...prev, ...imported].slice(-4999));
  }

  const filteredLines = filterText
    ? lines.filter((l) => l.text.toLowerCase().includes(filterText.toLowerCase()))
    : lines;

  return (
    <section
      className={`pane${active ? " active" : ""}${visible ? "" : " hidden"}`}
      onMouseDown={onActivate}
      onFocus={onActivate}
    >
      <header className="topbar">
        <div className="conn-controls">
          <select
            value={selectedPort}
            disabled={connected}
            onChange={(e) => setSelectedPort(e.target.value)}
          >
            {ports.length === 0 && <option value="">No ports found</option>}
            {ports.map((p) => (
              <option
                key={p.path}
                value={p.path}
                disabled={takenPaths.includes(p.path) && p.path !== selectedPort}
              >
                {p.path}
                {p.manufacturer ? ` — ${p.manufacturer}` : ""}
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
          <span className="sep" />
          <select
            value={dataBits}
            onChange={(e) => setDataBits(Number(e.target.value) as 5 | 6 | 7 | 8)}
          >
            {DATA_BITS.map((d) => (
              <option key={d} value={d}>
                {d} data
              </option>
            ))}
          </select>
          <select value={parity} onChange={(e) => setParity(e.target.value as typeof parity)}>
            {PARITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={stopBits}
            onChange={(e) => setStopBits(Number(e.target.value) as 1 | 1.5 | 2)}
          >
            {STOP_BITS.map((s) => (
              <option key={s} value={s}>
                {s} stop
              </option>
            ))}
          </select>
          <span className="sep" />
          <label className="check-label">
            <input type="checkbox" checked={rtscts} onChange={(e) => setRtscts(e.target.checked)} />
            RTS/CTS
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={xonxoff}
              onChange={(e) => setXonxoff(e.target.checked)}
            />
            XON/XOFF
          </label>
          <span className="sep" />
          <button className="btn-ghost" onClick={onRescan}>
            Rescan
          </button>
          <button
            className={connected ? "btn-disconnect" : "btn-connect"}
            onClick={toggleConnection}
            disabled={!connected && !selectedPort}
          >
            {connected ? "Disconnect" : "Connect"}
          </button>
        </div>
        <div className="session-controls">
          <button className="btn-ghost" onClick={importLog}>
            Import
          </button>
          <button className="btn-ghost" onClick={exportLog} disabled={lines.length === 0}>
            Export
          </button>
          {onClose && (
            <button className="btn-ghost" onClick={onClose} title="Close this pane">
              ✕
            </button>
          )}
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
                if (e.key === "Escape") {
                  setFilterVisible(false);
                  setFilterText("");
                }
              }}
            />
            <span className="filter-count">
              {filteredLines.length} / {lines.length}
            </span>
            <button
              className="btn-ghost"
              style={{ padding: "4px 10px" }}
              onClick={() => {
                setFilterVisible(false);
                setFilterText("");
              }}
            >
              ✕
            </button>
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
          onChange={(e) => {
            setCommand(e.target.value);
            setHistoryIndex(-1);
          }}
          onKeyDown={handleInputKey}
        />
        <select value={lineEnding} onChange={(e) => setLineEnding(e.target.value as LineEndingId)}>
          {LINE_ENDINGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button className="btn-send" onClick={send} disabled={!connected}>
          Send
        </button>
      </footer>

      <div className="statusbar">
        <span className={`dot ${connected ? "on" : "off"}`} />
        <span>
          {connected
            ? `${selectedPort} · ${baud} ${dataBits}${PARITY_ABBREV[parity]}${stopBits}${rtscts ? " · RTS/CTS" : ""}${xonxoff ? " · XON/XOFF" : ""}`
            : "Disconnected"}
        </span>
        <span className="spacer" />
        <span>RX {rxBytes} B</span>
        <span>TX {txBytes} B</span>
        <button
          className={`btn-toggle${hexView ? " active" : ""}`}
          onClick={() => setHexView((h) => !h)}
          title="Toggle hex view (RX only)"
        >
          HEX
        </button>
        <button
          className={`btn-toggle${tsFormat !== "clock" ? " active" : ""}`}
          onClick={cycleTs}
          title="Cycle timestamps: clock → relative → hidden"
        >
          TS
        </button>
        <button
          className={`btn-toggle${filterVisible ? " active" : ""}`}
          onClick={() =>
            setFilterVisible((v) => {
              if (!v) setTimeout(() => filterInputRef.current?.focus(), 0);
              return !v;
            })
          }
          title="Toggle filter bar (Ctrl+F)"
        >
          FILTER
        </button>
        <button
          className="btn-toggle"
          onMouseDown={(e) => e.preventDefault()}
          onClick={copySelection}
          title="Copy the selected console text"
        >
          {copied ? "COPIED" : "COPY"}
        </button>
        <button className="btn-toggle" onClick={() => setLines([])} title="Clear console">
          CLEAR
        </button>
        <label className="auto">
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(e) => setAutoscroll(e.target.checked)}
          />
          autoscroll
        </label>
      </div>
    </section>
  );
}
