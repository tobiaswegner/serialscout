export type LineEndingId = 'lf' | 'cr' | 'crlf' | 'none'

export interface PortInfo {
  path: string
  manufacturer: string | null
  serialNumber: string | null
  vendorId: string | null
  productId: string | null
}

declare global {
  interface Window {
    serial?: {
      list(): Promise<PortInfo[]>
      open(opts: { path: string; baudRate: number }): Promise<{ ok: boolean }>
      write(data: string, lineEnding: LineEndingId): Promise<{ ok: boolean; bytes: number }>
      close(): Promise<{ ok: boolean }>
      onData(cb: (payload: { line: string }) => void): () => void
      onError(cb: (payload: { message: string }) => void): () => void
      onClosed(cb: () => void): () => void
    }
  }
}
