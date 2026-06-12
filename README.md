# SerialScout

A cross-platform desktop client for talking to **UART / serial devices** and command-line interfaces. Built with **Electron + React + Vite**, with serial I/O handled in the main process via [`serialport`](https://serialport.io/).

> Status: early scaffold. The UI design lives in [`design/mockup.html`](design/mockup.html).

## Features (planned)

- Auto-discover and connect to serial ports (configurable baud, data bits, parity, stop bits)
- Live console with color-coded RX / TX, timestamps, and ASCII/HEX views
- Command input with selectable line endings (LF / CR / CRLF) and history
- Saved connections and reusable command snippets / macros
- Throughput stats and session logging

## Architecture

```
electron/main.js     Main process — owns the serialport instance, exposes IPC
electron/preload.cjs Secure bridge — exposes window.serial to the renderer
src/                 React renderer (Vite dev server in development)
design/mockup.html   Self-contained UI design reference
```

The renderer never touches Node directly. It calls `window.serial.*`, which the
preload bridges to IPC handlers in the main process. This keeps `contextIsolation`
on and `nodeIntegration` off.

## Develop

Requires Node 18+.

```bash
npm install
npm run dev      # starts Vite + Electron together
```

## Build

```bash
npm run package  # produces a distributable in release/
```

## License

MIT
