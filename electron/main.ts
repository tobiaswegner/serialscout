import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'

const isDev = process.env.NODE_ENV === 'development'

let mainWindow: BrowserWindow | null = null
let port: SerialPort | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#0d1014',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ---- Serial IPC handlers ---------------------------------------------------

ipcMain.handle('serial:list', async () => {
  const ports = await SerialPort.list()
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer ?? null,
    serialNumber: p.serialNumber ?? null,
    vendorId: p.vendorId ?? null,
    productId: p.productId ?? null,
  }))
})

interface OpenParams {
  path: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'even' | 'mark' | 'odd' | 'space'
}

ipcMain.handle('serial:open', async (_evt, params: OpenParams) => {
  const { path: portPath, baudRate, dataBits, stopBits, parity } = params

  if (port?.isOpen) {
    await new Promise<void>((res) => port!.close(() => res()))
    port = null
  }

  return new Promise<{ ok: boolean; path: string }>((resolve, reject) => {
    port = new SerialPort(
      {
        path: portPath,
        baudRate: Number(baudRate) || 115200,
        dataBits: dataBits ?? 8,
        stopBits: stopBits ?? 1,
        parity: parity ?? 'none',
        autoOpen: false,
      },
      (err) => {
        if (err) reject(err)
      }
    )

    port.open((err) => {
      if (err) return reject(err)

      const parser = port!.pipe(new ReadlineParser({ delimiter: '\n' }))
      parser.on('data', (line: string) => {
        mainWindow?.webContents.send('serial:data', { line, ts: Date.now() })
      })
      port!.on('error', (e: Error) => {
        mainWindow?.webContents.send('serial:error', { message: e.message })
      })
      port!.on('close', () => {
        mainWindow?.webContents.send('serial:closed', {})
      })

      resolve({ ok: true, path: portPath })
    })
  })
})

interface WriteParams {
  data: string
  lineEnding: 'none' | 'lf' | 'cr' | 'crlf'
}

ipcMain.handle('serial:write', async (_evt, { data, lineEnding }: WriteParams) => {
  if (!port?.isOpen) throw new Error('Port is not open')
  const endings: Record<string, string> = { none: '', lf: '\n', cr: '\r', crlf: '\r\n' }
  const payload = data + (endings[lineEnding] ?? '\n')
  return new Promise<{ ok: boolean; bytes: number }>((resolve, reject) => {
    port!.write(payload, (err) => (err ? reject(err) : resolve({ ok: true, bytes: payload.length })))
  })
})

ipcMain.handle('serial:close', async () => {
  if (!port?.isOpen) return { ok: true }
  return new Promise<{ ok: boolean }>((resolve) => port!.close(() => resolve({ ok: true })))
})

// ---- App lifecycle ---------------------------------------------------------

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (port?.isOpen) port.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
