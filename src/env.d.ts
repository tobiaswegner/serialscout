export type LineEndingId = "lf" | "cr" | "crlf" | "none";

export interface PortInfo {
  path: string;
  manufacturer: string | null;
  serialNumber: string | null;
  vendorId: string | null;
  productId: string | null;
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
        parity?: "none" | "even" | "odd" | "mark" | "space";
        rtscts?: boolean;
        xon?: boolean;
        xoff?: boolean;
      }): Promise<{ ok: boolean }>;
      write(data: string, lineEnding: LineEndingId): Promise<{ ok: boolean; bytes: number }>;
      close(): Promise<{ ok: boolean }>;
      onData(cb: (payload: { line: string }) => void): () => void;
      onError(cb: (payload: { message: string }) => void): () => void;
      onClosed(cb: () => void): () => void;
      exportLog(content: string): Promise<{ ok: boolean }>;
      importLog(): Promise<{ ok: boolean; content: string | null }>;
    };
  }
}
