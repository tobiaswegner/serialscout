import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import {
  DEFAULT_SETTINGS,
  SerialManager,
  type PortSettings,
  type SessionSnapshot,
} from "../serial/manager.js";
import { startMcpHost, type McpHost } from "../serial/mcp-host.js";

const isDev = process.env.NODE_ENV === "development";

let mainWindow: BrowserWindow | null = null;
let mcpHost: McpHost | null = null;
let mcpError: string | null = null;

// One manager for the whole process: the window's console and the MCP host both
// talk to it, which is what lets an agent and the user share a serial port.
const serial = new SerialManager();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: "#0d1014",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

// ---- Manager → renderer ----------------------------------------------------

// The console is line-oriented while the MCP buffer is byte-oriented, so the raw
// stream is split here instead of consuming it with a parser.
const pending = new Map<string, string>();

serial.on("data", ({ path: portPath, chunk }) => {
  const text = (pending.get(portPath) ?? "") + chunk.toString("utf8");
  const parts = text.split(/\r?\n/);
  pending.set(portPath, parts.pop() ?? "");
  for (const line of parts) {
    send("serial:data", { path: portPath, line, ts: Date.now() });
  }
});

serial.on("tx", ({ path: portPath, payload, source }) => {
  send("serial:tx", {
    path: portPath,
    text: payload.toString("utf8").replace(/\r?\n$/, ""),
    bytes: payload.length,
    source,
    ts: Date.now(),
  });
});

serial.on("state", ({ path: portPath, open, settings, source }) => {
  if (!open) pending.delete(portPath);
  send("serial:state", { path: portPath, open, settings, source });
  if (!open) send("serial:closed", { path: portPath });
});

serial.on("error", ({ path: portPath, message }) => {
  send("serial:error", { path: portPath, message });
});

// ---- Serial IPC handlers ---------------------------------------------------

ipcMain.handle("serial:list", () => serial.listPorts());

type OpenParams = Partial<PortSettings> & { path: string; baudRate: number };

ipcMain.handle("serial:open", async (_evt, params: OpenParams) => {
  const settings: PortSettings = {
    ...DEFAULT_SETTINGS,
    ...stripUndefined(params),
    path: params.path,
    baudRate: Number(params.baudRate) || 115200,
  };
  const snapshot = await serial.open(settings, "ui");
  return { ok: true, path: snapshot.path, snapshot };
});

interface WriteParams {
  path?: string;
  data: string;
  lineEnding: "none" | "lf" | "cr" | "crlf";
}

ipcMain.handle("serial:write", async (_evt, { path: portPath, data, lineEnding }: WriteParams) => {
  const target = portPath ?? serial.activePath();
  if (!target) throw new Error("Port is not open");
  const endings: Record<string, string> = { none: "", lf: "\n", cr: "\r", crlf: "\r\n" };
  const payload = Buffer.from(data + (endings[lineEnding] ?? "\n"), "utf8");
  await serial.write(target, payload, false, "ui");
  return { ok: true, bytes: payload.length };
});

ipcMain.handle("serial:close", async (_evt, portPath?: string) => {
  const target = portPath ?? serial.activePath();
  if (!target) return { ok: true };
  await serial.close(target, "ui");
  return { ok: true };
});

ipcMain.handle("serial:status", (): SessionSnapshot[] => serial.statusAll());

// ---- MCP host --------------------------------------------------------------

ipcMain.handle("mcp:status", () => ({
  running: mcpHost !== null,
  url: mcpHost?.url ?? null,
  port: mcpHost?.port ?? null,
  error: mcpError,
}));

// ---- Log export / import ---------------------------------------------------

ipcMain.handle("log:export", async (_evt, content: string) => {
  if (!mainWindow) return { ok: false };
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `serialscout-${ts}.txt`,
    filters: [{ name: "Text Log", extensions: ["txt"] }],
  });
  if (canceled || !filePath) return { ok: false };
  await fs.writeFile(filePath, content, "utf8");
  return { ok: true };
});

ipcMain.handle("log:import", async () => {
  if (!mainWindow) return { ok: false, content: null };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: "Text Log", extensions: ["txt"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths[0]) return { ok: false, content: null };
  const content = await fs.readFile(filePaths[0], "utf8");
  return { ok: true, content };
});

// ---- App lifecycle ---------------------------------------------------------

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

async function startMcp(): Promise<void> {
  try {
    mcpHost = await startMcpHost({ manager: serial });
    mcpError = null;
    console.log(`MCP endpoint listening on ${mcpHost.url}`);
  } catch (err: unknown) {
    mcpHost = null;
    mcpError = err instanceof Error ? err.message : String(err);
    // A busy port usually means a second instance owns the endpoint; the app
    // stays fully usable without it.
    console.error("MCP endpoint unavailable:", mcpError);
  }
  send("mcp:state", { running: mcpHost !== null, url: mcpHost?.url ?? null, error: mcpError });
}

app.whenReady().then(async () => {
  createWindow();
  await startMcp();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!mcpHost && serial.statusAll().length === 0) return;
  event.preventDefault();
  void (async () => {
    await mcpHost?.close();
    mcpHost = null;
    await serial.closeAll("ui");
    app.quit();
  })();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
