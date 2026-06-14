export type LineEndingId = 'lf' | 'cr' | 'crlf' | 'none'

export interface PortInfo {
  path: string
  manufacturer: string | null
  serialNumber: string | null
  vendorId: string | null
  productId: string | null
}

export interface Settings {
  port?: string
  baud?: number
  lineEnding?: string
  tsFormat?: string
  hexView?: boolean
  autoscroll?: boolean
  fontSize?: number
}

declare global {
  interface Window {
    serial?: {
      list(): Promise<PortInfo[]>
      open(opts: { path: string; baudRate: number }): Promise<{ ok: boolean }>
      write(data: string, lineEnding: LineEndingId): Promise<{ ok: boolean; bytes: number }>
      writeRaw(bytes: number[]): Promise<{ ok: boolean; bytes: number }>
      close(): Promise<{ ok: boolean }>
      setSignals(signals: { dtr?: boolean; rts?: boolean }): Promise<{ ok: boolean }>
      onData(cb: (payload: { line: string }) => void): () => void
      onError(cb: (payload: { message: string }) => void): () => void
      onClosed(cb: () => void): () => void
      exportLog(content: string): Promise<{ ok: boolean }>
      importLog(): Promise<{ ok: boolean; content: string | null }>
      loadSettings(): Promise<Settings>
      saveSettings(settings: Settings): Promise<{ ok: boolean }>
    }
  }
}
