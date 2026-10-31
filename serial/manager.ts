import { EventEmitter } from "node:events";
import { SerialPort } from "serialport";

export type Parity = "none" | "even" | "odd" | "mark" | "space";

/** Who triggered an operation — the desktop UI or an MCP client. */
export type Source = "ui" | "mcp";

export interface PortSettings {
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 1.5 | 2;
  parity: Parity;
  rtscts: boolean;
  xon: boolean;
  xoff: boolean;
}

export type SettingsPatch = Partial<Omit<PortSettings, "path">>;

export interface PortListEntry {
  path: string;
  manufacturer: string | null;
  serialNumber: string | null;
  pnpId: string | null;
  locationId: string | null;
  vendorId: string | null;
  productId: string | null;
  open: boolean;
}

export interface SessionSnapshot {
  path: string;
  isOpen: boolean;
  settings: PortSettings;
  openedAt: string;
  receiveBuffer: {
    bytes: number;
    capacityBytes: number;
    droppedBytes: number;
  };
  totals: { rxBytes: number; txBytes: number };
  lastError: string | null;
}

export interface ModemSignals {
  cts: boolean;
  dsr: boolean;
  dcd: boolean;
}

export interface ManagerEvents {
  /** Raw bytes received. Delivered to every listener; does not consume the MCP buffer. */
  data: (evt: { path: string; chunk: Buffer }) => void;
  /** Bytes written by anyone, so the other side can mirror them in its view. */
  tx: (evt: { path: string; payload: Buffer; source: Source }) => void;
  /** A port was opened, reconfigured, or closed. */
  state: (evt: { path: string; open: boolean; settings: PortSettings; source: Source }) => void;
  error: (evt: { path: string; message: string }) => void;
}

export const DEFAULT_BUFFER_BYTES = 1024 * 1024;

export const DEFAULT_SETTINGS: Omit<PortSettings, "path" | "baudRate"> = {
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  rtscts: false,
  xon: false,
  xoff: false,
};

export class SerialError extends Error {}

/**
 * One open serial port plus the ring buffer that backs MCP reads. Received bytes
 * are fanned out as events *and* appended here, so the desktop console and an MCP
 * client both see the full stream — reading via MCP never steals data from the UI.
 * Chunks are trimmed from the front once the buffer exceeds its capacity, so a slow
 * reader loses the oldest bytes rather than the newest ones.
 */
class Session {
  port: SerialPort;
  settings: PortSettings;
  readonly capacityBytes: number;
  readonly openedAt = new Date();

  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private droppedBytes = 0;
  private rxBytes = 0;
  private txBytes = 0;
  private lastError: string | null = null;

  constructor(
    port: SerialPort,
    settings: PortSettings,
    capacityBytes: number,
    private readonly onChunk: (chunk: Buffer) => void,
    private readonly onError: (message: string) => void,
  ) {
    this.port = port;
    this.settings = settings;
    this.capacityBytes = capacityBytes;
    this.attach(port);
  }

  attach(port: SerialPort): void {
    this.port = port;
    port.on("data", (chunk: Buffer) => {
      this.push(chunk);
      this.onChunk(chunk);
    });
    port.on("error", (err: Error) => {
      this.lastError = err.message;
      this.onError(err.message);
    });
  }

  private push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.bufferedBytes += chunk.length;
    this.rxBytes += chunk.length;

    while (this.bufferedBytes > this.capacityBytes) {
      const overflow = this.bufferedBytes - this.capacityBytes;
      const head = this.chunks[0];
      if (head.length <= overflow) {
        this.chunks.shift();
        this.bufferedBytes -= head.length;
        this.droppedBytes += head.length;
      } else {
        this.chunks[0] = head.subarray(overflow);
        this.bufferedBytes -= overflow;
        this.droppedBytes += overflow;
      }
    }
  }

  /** Returns up to `maxBytes` from the front of the buffer, consuming unless `peek`. */
  read(maxBytes: number, peek: boolean): Buffer {
    const wanted = Math.min(maxBytes, this.bufferedBytes);
    if (wanted === 0) return Buffer.alloc(0);

    const parts: Buffer[] = [];
    let taken = 0;
    let chunkIndex = 0;
    while (taken < wanted) {
      const chunk = this.chunks[chunkIndex];
      const slice = chunk.subarray(0, Math.min(chunk.length, wanted - taken));
      parts.push(slice);
      taken += slice.length;
      chunkIndex++;
    }

    if (!peek) {
      this.chunks = this.chunks.slice(chunkIndex - 1);
      const partial = parts[parts.length - 1];
      const firstChunk = this.chunks[0];
      if (partial.length < firstChunk.length) {
        this.chunks[0] = firstChunk.subarray(partial.length);
      } else {
        this.chunks.shift();
      }
      this.bufferedBytes -= taken;
    }

    return Buffer.concat(parts, taken);
  }

  clear(): number {
    const discarded = this.bufferedBytes;
    this.chunks = [];
    this.bufferedBytes = 0;
    return discarded;
  }

  countTx(bytes: number): void {
    this.txBytes += bytes;
  }

  snapshot(): SessionSnapshot {
    return {
      path: this.settings.path,
      isOpen: this.port.isOpen,
      settings: { ...this.settings },
      openedAt: this.openedAt.toISOString(),
      receiveBuffer: {
        bytes: this.bufferedBytes,
        capacityBytes: this.capacityBytes,
        droppedBytes: this.droppedBytes,
      },
      totals: { rxBytes: this.rxBytes, txBytes: this.txBytes },
      lastError: this.lastError,
    };
  }
}

/**
 * Owns every serial port this process has opened, keyed by device path. A single
 * instance is shared by the Electron main process and the in-app MCP server, which
 * is what lets an agent and the desktop console work the same port at the same time.
 */
export class SerialManager extends EventEmitter {
  private sessions = new Map<string, Session>();

  constructor(private readonly capacityBytes: number = DEFAULT_BUFFER_BYTES) {
    super();
  }

  override on<K extends keyof ManagerEvents>(event: K, listener: ManagerEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  private fire<K extends keyof ManagerEvents>(
    event: K,
    ...args: Parameters<ManagerEvents[K]>
  ): void {
    this.emit(event, ...args);
  }

  async listPorts(): Promise<PortListEntry[]> {
    let ports: Awaited<ReturnType<typeof SerialPort.list>>;
    try {
      ports = await SerialPort.list();
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      // No serial subsystem at all (common in containers) — report an empty list.
      if (code === "ENOENT" || code === "EACCES") return [];
      throw err;
    }
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer ?? null,
      serialNumber: p.serialNumber ?? null,
      pnpId: p.pnpId ?? null,
      locationId: p.locationId ?? null,
      vendorId: p.vendorId ?? null,
      productId: p.productId ?? null,
      open: this.sessions.get(p.path)?.port.isOpen ?? false,
    }));
  }

  /**
   * Opens a port, or joins the existing session when the port is already open in
   * this process with the same configuration — that is the shared path the UI and
   * an MCP client take when they use one device together.
   */
  async open(settings: PortSettings, source: Source = "ui"): Promise<SessionSnapshot> {
    const existing = this.sessions.get(settings.path);
    if (existing?.port.isOpen) {
      const differing = describeDifferences(existing.settings, settings);
      if (differing.length) {
        throw new SerialError(
          `Port ${settings.path} is already open with a different configuration ` +
            `(${differing.join(", ")}). Use serial_set_settings to change it, or close it first.`,
        );
      }
      return existing.snapshot();
    }

    const port = await openPort(settings);
    const session = new Session(
      port,
      settings,
      this.capacityBytes,
      (chunk) => this.fire("data", { path: settings.path, chunk }),
      (message) => this.fire("error", { path: settings.path, message }),
    );
    this.watchClose(settings.path, session);
    this.sessions.set(settings.path, session);
    this.fire("state", { path: settings.path, open: true, settings, source });
    return session.snapshot();
  }

  async close(path: string, source: Source = "ui"): Promise<void> {
    const session = this.require(path);
    this.sessions.delete(path);
    if (session.port.isOpen) {
      await new Promise<void>((resolve, reject) =>
        session.port.close((err) => (err ? reject(err) : resolve())),
      );
    }
    this.fire("state", { path, open: false, settings: session.settings, source });
  }

  async closeAll(source: Source = "ui"): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((path) => this.close(path, source)));
  }

  status(path: string): SessionSnapshot {
    return this.require(path).snapshot();
  }

  statusAll(): SessionSnapshot[] {
    return [...this.sessions.values()].map((s) => s.snapshot());
  }

  /**
   * Baud rate can be changed on the fly; every other framing option requires
   * reopening the device. The receive buffer and byte counters survive either
   * path so a reconfigure never silently drops queued data.
   */
  async setSettings(
    path: string,
    patch: SettingsPatch,
    source: Source = "ui",
  ): Promise<SessionSnapshot> {
    const session = this.require(path);
    const next: PortSettings = { ...session.settings, ...patch };
    const baudOnly = (Object.keys(patch) as (keyof SettingsPatch)[]).every(
      (key) => key === "baudRate" || patch[key] === session.settings[key],
    );

    if (baudOnly) {
      if (next.baudRate !== session.settings.baudRate) {
        await new Promise<void>((resolve, reject) =>
          session.port.update({ baudRate: next.baudRate }, (err) =>
            err ? reject(err) : resolve(),
          ),
        );
      }
      session.settings = next;
      this.fire("state", { path, open: true, settings: next, source });
      return session.snapshot();
    }

    const old = session.port;
    old.removeAllListeners();
    if (old.isOpen) {
      await new Promise<void>((resolve, reject) =>
        old.close((err) => (err ? reject(err) : resolve())),
      );
    }

    const port = await openPort(next);
    session.attach(port);
    session.settings = next;
    this.watchClose(path, session);
    this.fire("state", { path, open: true, settings: next, source });
    return session.snapshot();
  }

  async signals(path: string): Promise<ModemSignals | null> {
    const session = this.require(path);
    try {
      return await new Promise<ModemSignals>((resolve, reject) =>
        session.port.get((err, status) =>
          err || !status ? reject(err ?? new Error("no status")) : resolve(status as ModemSignals),
        ),
      );
    } catch {
      // Not every platform/driver exposes modem lines.
      return null;
    }
  }

  read(path: string, maxBytes: number, peek: boolean): { data: Buffer; snapshot: SessionSnapshot } {
    const session = this.require(path);
    const data = session.read(maxBytes, peek);
    return { data, snapshot: session.snapshot() };
  }

  clearBuffer(path: string): { discardedBytes: number; snapshot: SessionSnapshot } {
    const session = this.require(path);
    const discardedBytes = session.clear();
    return { discardedBytes, snapshot: session.snapshot() };
  }

  async write(
    path: string,
    payload: Buffer,
    drain: boolean,
    source: Source = "ui",
  ): Promise<SessionSnapshot> {
    const session = this.require(path);
    if (!session.port.isOpen) throw new SerialError(`Port ${path} is not open`);

    await new Promise<void>((resolve, reject) =>
      session.port.write(payload, (err) => (err ? reject(err) : resolve())),
    );
    if (drain) {
      await new Promise<void>((resolve, reject) =>
        session.port.drain((err) => (err ? reject(err) : resolve())),
      );
    }
    session.countTx(payload.length);
    this.fire("tx", { path, payload, source });
    return session.snapshot();
  }

  /** The single open port, if there is exactly one — the desktop UI's usual case. */
  activePath(): string | null {
    const open = [...this.sessions.entries()].filter(([, s]) => s.port.isOpen);
    return open.length === 1 ? open[0][0] : (open[0]?.[0] ?? null);
  }

  private watchClose(path: string, session: Session): void {
    session.port.on("close", () => {
      if (this.sessions.get(path) !== session) return;
      this.sessions.delete(path);
      this.fire("state", { path, open: false, settings: session.settings, source: "ui" });
    });
  }

  private require(path: string): Session {
    const session = this.sessions.get(path);
    if (!session) {
      const open = [...this.sessions.keys()];
      throw new SerialError(
        `Port ${path} is not open. ${
          open.length ? `Open ports: ${open.join(", ")}.` : "No ports are open."
        } Use serial_open_port first.`,
      );
    }
    return session;
  }
}

function describeDifferences(current: PortSettings, wanted: PortSettings): string[] {
  const keys: (keyof PortSettings)[] = [
    "baudRate",
    "dataBits",
    "stopBits",
    "parity",
    "rtscts",
    "xon",
    "xoff",
  ];
  return keys
    .filter((key) => current[key] !== wanted[key])
    .map((key) => `${key}: open as ${String(current[key])}, requested ${String(wanted[key])}`);
}

function openPort(settings: PortSettings): Promise<SerialPort> {
  return new Promise<SerialPort>((resolve, reject) => {
    const port = new SerialPort({ ...settings, autoOpen: false }, (err) => {
      if (err) reject(err);
    });
    port.open((err) => (err ? reject(err) : resolve(port)));
  });
}
