import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

type LineEndingId = 'lf' | 'cr' | 'crlf' | 'none'

interface PortInfo {
  path: string
  manufacturer: string | null
  serialNumber: string | null
  vendorId: string | null
  productId: string | null
}

// Safe, minimal API surface exposed to the React renderer.
contextBridge.exposeInMainWorld('serial', {
  list: (): Promise<PortInfo[]> => ipcRenderer.invoke('serial:list'),
  open: (opts: {
    path: string
    baudRate: number
    dataBits?: 5 | 6 | 7 | 8
    stopBits?: 1 | 1.5 | 2
    parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
    rtscts?: boolean
    xon?: boolean
    xoff?: boolean
  }) => ipcRenderer.invoke('serial:open', opts),
  write: (data: string, lineEnding: LineEndingId) => ipcRenderer.invoke('serial:write', { data, lineEnding }),
  close: () => ipcRenderer.invoke('serial:close'),
  onData: (cb: (payload: { line: string }) => void) => {
    const h = (_e: IpcRendererEvent, payload: { line: string }) => cb(payload)
    ipcRenderer.on('serial:data', h)
    return () => ipcRenderer.removeListener('serial:data', h)
  },
  onError: (cb: (payload: { message: string }) => void) => {
    const h = (_e: IpcRendererEvent, payload: { message: string }) => cb(payload)
    ipcRenderer.on('serial:error', h)
    return () => ipcRenderer.removeListener('serial:error', h)
  },
  onClosed: (cb: () => void) => {
    const h = (_e: IpcRendererEvent) => cb()
    ipcRenderer.on('serial:closed', h)
    return () => ipcRenderer.removeListener('serial:closed', h)
  },
  exportLog: (content: string) => ipcRenderer.invoke('log:export', content),
  importLog: () => ipcRenderer.invoke('log:import'),
})
