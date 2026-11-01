import { useEffect, useRef, useState, useCallback } from "react";
import type { PortInfo, PortSettings, McpState } from "./env";
import SessionPane from "./components/SessionPane";

type Layout = "tabs" | "columns" | "rows";

const LAYOUTS: Array<{ id: Layout; label: string; title: string }> = [
  { id: "tabs", label: "TABS", title: "One port at a time, switch with tabs" },
  { id: "columns", label: "COLS", title: "Show all ports side by side" },
  { id: "rows", label: "ROWS", title: "Show all ports stacked" },
];

interface PaneEntry {
  id: string;
  /** Settings of a port that was already open when the pane was created. */
  adopt?: PortSettings;
}

const serial = window.serial;

const mcp = window.mcp ?? {
  status: async (): Promise<McpState> => ({ running: false, url: null, error: null }),
  onState: () => () => {},
};

function newPane(adopt?: PortSettings): PaneEntry {
  return { id: crypto.randomUUID(), adopt };
}

function tabLabel(path: string | null | undefined): string {
  return path ? (path.split("/").pop() ?? path) : "New";
}

export default function App() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [panes, setPanes] = useState<PaneEntry[]>([]);
  const [activeId, setActiveId] = useState("");
  const [layout, setLayout] = useState<Layout>("tabs");
  // Port followed by each pane. The ref is what event handlers read — it is
  // updated synchronously, before the state that drives the tab labels.
  const [paths, setPaths] = useState<Record<string, string | null>>({});
  const pathsRef = useRef<Record<string, string | null>>({});
  const [mcpState, setMcpState] = useState<McpState>({ running: false, url: null, error: null });

  const refreshPorts = useCallback(async () => {
    setPorts((await serial?.list()) ?? []);
  }, []);

  const setPanePath = useCallback((id: string, path: string | null) => {
    pathsRef.current = { ...pathsRef.current, [id]: path };
    setPaths(pathsRef.current);
  }, []);

  const addPane = useCallback((adopt?: PortSettings) => {
    const pane = newPane(adopt);
    if (adopt) {
      pathsRef.current = { ...pathsRef.current, [pane.id]: adopt.path };
      setPaths(pathsRef.current);
    }
    setPanes((prev) => [...prev, pane]);
    setActiveId(pane.id);
    return pane;
  }, []);

  const removePane = useCallback(async (id: string) => {
    const path = pathsRef.current[id];
    if (path) {
      try {
        await serial?.close(path);
      } catch {
        // Already closed — nothing left to release.
      }
    }
    const { [id]: _gone, ...rest } = pathsRef.current;
    pathsRef.current = rest;
    setPaths(rest);
    setPanes((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length === 0) {
        const fresh = newPane();
        setActiveId(fresh.id);
        return [fresh];
      }
      setActiveId((cur) => (cur === id ? next[next.length - 1].id : cur));
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshPorts();

    // Ports may already be open — the MCP host shares this process, so an agent
    // can have connected before (or instead of) the user. Each gets its own pane.
    (serial?.status() ?? Promise.resolve([])).then((sessions) => {
      if (cancelled) return;
      const open = sessions.filter((s) => s.isOpen);
      const initial = open.length ? open.map((s) => newPane(s.settings)) : [newPane()];
      pathsRef.current = Object.fromEntries(initial.map((p) => [p.id, p.adopt?.path ?? null]));
      setPaths(pathsRef.current);
      setPanes(initial);
      setActiveId(initial[0].id);
    });

    // A port an agent opens that no pane follows yet gets a pane of its own.
    const offState = serial?.onState(({ path, open, settings, source }) => {
      if (!open || source !== "mcp") return;
      if (Object.values(pathsRef.current).includes(path)) return;
      addPane(settings);
    });

    mcp.status().then(setMcpState);
    const offMcp = mcp.onState(setMcpState);

    return () => {
      cancelled = true;
      offState?.();
      offMcp();
    };
  }, [refreshPorts, addPane]);

  const visibleId = panes.some((p) => p.id === activeId) ? activeId : panes[0]?.id;

  return (
    <div className="app">
      <header className="appbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">SerialScout</span>
        </div>
        <nav className="tabs">
          {panes.map((p) => (
            <div
              key={p.id}
              className={`tab${p.id === visibleId ? " active" : ""}`}
              onClick={() => setActiveId(p.id)}
            >
              <span className={`dot ${paths[p.id] ? "on" : "off"}`} />
              <span className="tab-label">{tabLabel(paths[p.id])}</span>
              <button
                className="tab-close"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  removePane(p.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="tab-add" onClick={() => addPane()} title="Open another port">
            +
          </button>
        </nav>
        <div className="layout-toggle">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              className={`btn-toggle${layout === l.id ? " active" : ""}`}
              onClick={() => setLayout(l.id)}
              title={l.title}
            >
              {l.label}
            </button>
          ))}
        </div>
        <span
          className={`mcp-badge${mcpState.running ? " on" : ""}`}
          title={
            mcpState.running
              ? `MCP endpoint for AI agents: ${mcpState.url} (shares these connections)`
              : (mcpState.error ?? "MCP endpoint not running")
          }
        >
          MCP {mcpState.running ? (mcpState.url?.match(/:(\d+)/)?.[1] ?? "on") : "off"}
        </span>
      </header>

      <div className={`workspace layout-${layout}`}>
        {panes.map((p) => (
          <SessionPane
            key={p.id}
            ports={ports}
            takenPaths={Object.entries(paths)
              .filter(([id, path]) => id !== p.id && path)
              .map(([, path]) => path as string)}
            adopt={p.adopt}
            active={p.id === visibleId}
            visible={layout !== "tabs" || p.id === visibleId}
            onActivate={() => setActiveId(p.id)}
            onPath={(path) => setPanePath(p.id, path)}
            onRescan={refreshPorts}
            onClose={layout !== "tabs" && panes.length > 1 ? () => removePane(p.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
