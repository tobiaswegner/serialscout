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
serial/manager.ts    Shared serial core — owns the ports, buffers RX, emits events
serial/mcp-*.ts      MCP tools, the in-app HTTP host, and the stdio entry point
electron/main.ts     Main process — one SerialManager for the UI and the MCP host
electron/preload.ts  Secure bridge — exposes window.serial / window.mcp
src/                 React renderer (Vite dev server in development)
design/mockup.html   Self-contained UI design reference
```

The main process holds a single `SerialManager`. The window talks to it over IPC
and the MCP host serves the same instance over HTTP, so the console and an agent
share one open port instead of fighting over the device.

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

## MCP server

The app hosts a [Model Context Protocol](https://modelcontextprotocol.io) server that
gives an AI agent the same serial capabilities as the UI — port enumeration, port
settings, the receive buffer, and transmit — **on the same connection the console is
using**. Both sides see every received byte, the agent's writes appear in the console
tagged `[agent]`, and opening a port the app already has open just joins it.

While SerialScout runs, the endpoint is at `http://127.0.0.1:8375/mcp` (Streamable
HTTP). The statusbar shows `MCP 8375` when it is up. For clients that speak HTTP:

```json
{
  "mcpServers": {
    "serialscout-serial": { "type": "http", "url": "http://127.0.0.1:8375/mcp" }
  }
}
```

For clients that launch servers over stdio, use the bridge — this is what the repo's
`.mcp.json` registers:

```bash
npm run build:mcp                # builds out/serial/
node out/serial/mcp-stdio.js     # proxies to the running app…
                                 # …or opens ports itself if the app isn't running
```

| Tool | Purpose |
|------|---------|
| `serial_list_ports` | Enumerate OS-visible ports with manufacturer / VID / PID |
| `serial_open_port` | Open a port, or join the one the app already has open |
| `serial_status` | Settings, buffered / dropped / total bytes, modem lines, last error |
| `serial_set_settings` | Change settings on an open port; the console follows |
| `serial_read` | Drain the agent's receive buffer (utf8 / hex / base64, peek, wait-for-bytes) |
| `serial_clear_buffer` | Discard buffered input without reading it |
| `serial_write` | Transmit, with optional line ending and drain |
| `serial_close_port` | Close the port (for the console too) |

| Variable | Default | Meaning |
|----------|---------|---------|
| `SERIALSCOUT_MCP_PORT` | `8375` | Port for the in-app HTTP endpoint (and what the bridge probes) |
| `SERIALSCOUT_MCP_MODE` | `auto` | `proxy` to require the app, `local` to force standalone |
| `SERIALSCOUT_MCP_BUFFER_BYTES` | `1048576` | Receive buffer per port in standalone mode |

The endpoint listens on loopback only and has no authentication, so treat it like any
other local dev server: while the app runs, any process on the machine can drive the
serial port through it. See [FEATURES.md](FEATURES.md#mcp-server) for details.

## License

MIT
