export type LineEndingId = "lf" | "cr" | "crlf" | "none";

export type Parity = "none" | "even" | "odd" | "mark" | "space";

export type Source = "ui" | "mcp";

export interface PortInfo {
  path: string;
  manufacturer: string | null;
  serialNumber: string | null;
  vendorId: string | null;
  productId: string | null;
  open?: boolean;
}

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

export interface SessionSnapshot {
  path: string;
  isOpen: boolean;
  settings: PortSettings;
  totals: { rxBytes: number; txBytes: number };
}

export interface McpState {
  running: boolean;
  url: string | null;
  port?: number | null;
  error: string | null;
}

declare global {
  interface Window {
    serial?: {
      list(): Promise<PortInfo[]>;
      open(opts: {
        path: string;
        baudRate: number;
        dataBits?: 5 | 6 | 7 | 8;
        stopBits?: 1 | 1.5 | 2;
        parity?: Parity;
        rtscts?: boolean;
        xon?: boolean;
        xoff?: boolean;
      }): Promise<{ ok: boolean }>;
      write(data: string, lineEnding: LineEndingId): Promise<{ ok: boolean; bytes: number }>;
      close(): Promise<{ ok: boolean }>;
      status(): Promise<SessionSnapshot[]>;
      onData(cb: (payload: { path: string; line: string }) => void): () => void;
      onTx(
        cb: (payload: { path: string; text: string; bytes: number; source: Source }) => void,
      ): () => void;
      onState(
        cb: (payload: {
          path: string;
          open: boolean;
          settings: PortSettings;
          source: Source;
        }) => void,
      ): () => void;
      onError(cb: (payload: { message: string }) => void): () => void;
      onClosed(cb: () => void): () => void;
      exportLog(content: string): Promise<{ ok: boolean }>;
      importLog(): Promise<{ ok: boolean; content: string | null }>;
    };
    mcp?: {
      status(): Promise<McpState>;
      onState(cb: (payload: McpState) => void): () => void;
    };
  }
}
