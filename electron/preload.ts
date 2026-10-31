import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import type { PortSettings, SessionSnapshot } from "../serial/manager.js";

type LineEndingId = "lf" | "cr" | "crlf" | "none";

interface PortInfo {
  path: string;
  manufacturer: string | null;
  serialNumber: string | null;
  vendorId: string | null;
  productId: string | null;
  open?: boolean;
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Safe, minimal API surface exposed to the React renderer.
contextBridge.exposeInMainWorld("serial", {
  list: (): Promise<PortInfo[]> => ipcRenderer.invoke("serial:list"),
  open: (opts: {
    path: string;
    baudRate: number;
    dataBits?: 5 | 6 | 7 | 8;
    stopBits?: 1 | 1.5 | 2;
    parity?: "none" | "even" | "odd" | "mark" | "space";
    rtscts?: boolean;
    xon?: boolean;
    xoff?: boolean;
  }) => ipcRenderer.invoke("serial:open", opts),
  write: (data: string, lineEnding: LineEndingId) =>
    ipcRenderer.invoke("serial:write", { data, lineEnding }),
  close: () => ipcRenderer.invoke("serial:close"),
  /** Ports already open in the main process — an MCP client may have opened one. */
  status: (): Promise<SessionSnapshot[]> => ipcRenderer.invoke("serial:status"),
  onData: (cb: (payload: { path: string; line: string }) => void) => subscribe("serial:data", cb),
  onTx: (
    cb: (payload: { path: string; text: string; bytes: number; source: "ui" | "mcp" }) => void,
  ) => subscribe("serial:tx", cb),
  onState: (
    cb: (payload: {
      path: string;
      open: boolean;
      settings: PortSettings;
      source: "ui" | "mcp";
    }) => void,
  ) => subscribe("serial:state", cb),
  onError: (cb: (payload: { message: string }) => void) => subscribe("serial:error", cb),
  onClosed: (cb: () => void) => subscribe("serial:closed", () => cb()),
  exportLog: (content: string) => ipcRenderer.invoke("log:export", content),
  importLog: () => ipcRenderer.invoke("log:import"),
});

// State of the MCP endpoint the main process hosts for AI agents.
contextBridge.exposeInMainWorld("mcp", {
  status: (): Promise<{
    running: boolean;
    url: string | null;
    port: number | null;
    error: string | null;
  }> => ipcRenderer.invoke("mcp:status"),
  onState: (
    cb: (payload: { running: boolean; url: string | null; error: string | null }) => void,
  ) => subscribe("mcp:state", cb),
});
