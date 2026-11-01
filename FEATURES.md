# SerialScout — Feature Reference

## Connection

### Port Selection
Choose the serial port from the dropdown in the pane's header. Only ports detected by the OS are listed. A port that another pane is already using is greyed out.

### Baud Rate
Select from the standard baud rates (9600 – 921600) in the dropdown next to the port selector. The connection must be re-established after changing the baud rate.

### Data Bits, Parity, Stop Bits, Flow Control
Dropdowns for data bits (5–8), parity (none / even / odd / mark / space) and stop bits (1 / 1.5 / 2), plus **RTS/CTS** and **XON/XOFF** checkboxes, sit beside the baud rate. They apply when you connect.

### Rescan
Click **Rescan** to refresh the port list without restarting the app. Useful when plugging in a device after launch.

### Connect / Disconnect
Click **Connect** to open the port. The status bar shows the active port, baud rate, frame format (e.g. 8N1) and flow control. Click **Disconnect** to close it.

---

## Multiple Ports

SerialScout can work several ports at once. Each port lives in its own **pane** with its own connection settings, console, composer, history, filter and counters.

### Tabs
Every pane has a tab in the top bar with a dot showing whether it is connected. Click a tab to switch, **+** to add a pane, and **✕** on a tab to close it (a connected port is disconnected first). Background tabs keep receiving data. Closing the last tab leaves a fresh empty one.

### Layouts
The **TABS / COLS / ROWS** buttons in the top bar choose how panes are shown:

| Layout | Shows |
|--------|-------|
| TABS (default) | One pane at a time, switched with the tabs |
| COLS | All panes side by side |
| ROWS | All panes stacked |

In COLS and ROWS each pane header has a **✕** to close it. The pane you last clicked is the active one — `Ctrl+F` applies to it.

A port can only be followed by one pane. Ports opened by an agent over MCP, or already open when the app starts, each get their own pane automatically.

---

## Console

The console displays all serial traffic colour-coded by direction:

| Colour | Tag | Meaning |
|--------|-----|---------|
| Amber  | RX  | Data received from the device |
| Cyan   | TX  | Data sent to the device |
| Grey   | SYS | App events (connect, import markers) |
| Red    | ERR | Serial errors |

Up to 5 000 lines are kept in memory; older lines are discarded automatically.

### Autoscroll
The **autoscroll** checkbox (statusbar, right) keeps the view pinned to the newest line. Uncheck it to scroll freely; the checkbox re-enables when you scroll to the bottom.

---

## Console Toolbar (statusbar)

Each pane has its own toolbar and its own settings for the options below.

### HEX — Hex View
Toggle between ASCII text (default) and hexadecimal rendering for **RX** lines. TX, SYS, and ERR lines are always shown as text.

Example — `Hello` displayed in hex mode: `48 65 6c 6c 6f`

### TS — Timestamp Format
Cycles through three timestamp modes:

| Mode | Example | Notes |
|------|---------|-------|
| Clock (default) | `10:42:07` | Wall-clock time |
| Relative | `+3.417s` | Seconds since the session connected |
| Hidden | *(no column)* | Maximum horizontal space for data |

Click **TS** to cycle forward through the modes.

### FILTER — Console Filter
Opens the filter bar above the console. Type any substring to hide non-matching lines. The match counter (`n / total`) updates live.

- **Shortcut:** `Ctrl+F` / `Cmd+F` to open or close
- **Clear:** press `Escape` inside the filter input, or click **✕**
- Filter is case-insensitive

### COPY — Copy Selection
Select console text with the mouse and click **COPY** to put it on the clipboard (the button shows **COPIED** briefly). Only text selected inside that pane's console is copied, and the button does nothing when nothing is selected. A selection that spans rows includes the timestamp and RX/TX tag columns; start the selection in the text column to avoid them.

### CLEAR — Clear Console
Discards all lines from the in-memory buffer immediately. The connection is unaffected.

---

## Composer

### Sending a command
Type in the composer input and press **Enter** or click **Send**. The Send button is disabled while disconnected.

### Line Endings
Choose the terminator appended to each outgoing command:

| Option | Bytes sent |
|--------|-----------|
| LF `\n` (default) | `0x0A` |
| CR `\r` | `0x0D` |
| CRLF `\r\n` | `0x0D 0x0A` |
| None | no terminator |

### Command History
Press **↑** to recall the previous command, **↓** to move forward. The history holds up to 100 unique entries (most-recent first; duplicates are de-duplicated and promoted to the top).

---

## Session Log — Export & Import

### Export
Click **Export** in the top-right of the pane header to save the pane's console buffer to a `.txt` file via a native save dialog. The log is encoded as UTF-8 with one entry per line:

```
[2026-06-14T10:00:00.000Z] [RX] sensor reading: 23.4
[2026-06-14T10:00:00.012Z] [TX] READ_TEMP
[2026-06-14T10:00:00.013Z] [SYS] Connected to /dev/ttyUSB0 @ 115200 baud
```

The **Export** button is disabled when the console is empty.

### Import
Click **Import** to load a previously exported `.txt` file. The file is parsed back into colour-coded log entries and appended to the pane's console buffer with a `─── Imported N lines ───` marker. Lines that don't match the export format are added as SYS entries verbatim, so plain-text log files from other tools can also be imported.

Both operations use the native OS file dialog and never transmit data over the network.

---

## MCP Server

SerialScout hosts a [Model Context Protocol](https://modelcontextprotocol.io) server so
an AI agent can work the same serial port you are watching in the console. It runs
inside the app's main process and shares the app's serial connections — one per open port.

### Endpoint

While the app is running the server is reachable at `http://127.0.0.1:8375/mcp`
(Streamable HTTP, loopback only, no authentication). The top-bar badge reads
**MCP 8375** in cyan when the endpoint is up and **MCP off** when it is not — hover it
for the URL, or for the reason it failed to start (usually a second instance already
holding the port).

For MCP clients that spawn a child process instead of connecting to a URL, use the
stdio entry point:

```bash
npm run build:mcp             # builds out/serial/
node out/serial/mcp-stdio.js
```

It probes for a running app first:

| Mode | When | Port ownership |
|------|------|----------------|
| proxy | The app is running | Shared with the console |
| local | No app answered | Exclusive to that process until it exits |

Force one with `SERIALSCOUT_MCP_MODE=proxy` or `=local`; `SERIALSCOUT_MCP_PORT` moves
the endpoint (both sides must agree).

### What "shared" means

| Action | Effect in the console | Effect for the agent |
|--------|----------------------|----------------------|
| Device sends data | Appears as an RX line | Appended to the agent's receive buffer |
| Agent calls `serial_read` | Nothing is removed from the console | Consumes the agent's buffer only |
| Agent calls `serial_write` | Logged as a TX line prefixed `[agent]` | Returns bytes written |
| You type a command | Logged as a TX line | The device's reply reaches the agent's buffer too |
| Agent opens a port you already have open | Nothing changes | Joins the existing session |
| Agent opens a port with *different* settings | Nothing changes | Fails, pointing at `serial_set_settings` |
| Agent changes settings | That port's pane follows (dropdowns, statusbar, SYS line) | Applied to the shared port |
| Agent opens a port no pane is following | A new pane (tab) appears for it and shows traffic | Normal open |
| Either side closes the port | The pane shows it closed, with a SYS line (the pane stays) | Buffer discarded |

The two sides read independently: the console keeps its own scrollback and the agent
has its own byte buffer, so neither consumes the other's data.

### Receive buffering

Every byte received on an open port is appended to the agent's buffer (1 MiB by
default; override with `SERIALSCOUT_MCP_BUFFER_BYTES` in standalone mode). When the
buffer is full the **oldest** bytes are discarded so the newest data always survives,
and the running `droppedBytes` count is returned with every read and status call.

### Tools

| Tool | Key parameters | Notes |
|------|----------------|-------|
| `serial_list_ports` | — | Path, manufacturer, serial number, VID/PID, plus whether the port is already open |
| `serial_open_port` | `path`, `baudRate`, `dataBits`, `stopBits`, `parity`, `rtscts`, `xon`, `xoff` | Defaults to 8N1, no flow control; joins an identical existing session |
| `serial_status` | `path` (optional) | One port with modem lines (CTS/DSR/DCD, `null` if the driver has none), or all open ports |
| `serial_set_settings` | `path` + any setting | Baud-rate-only changes are applied in place; framing/flow-control changes reopen the port. Buffer and counters are preserved either way |
| `serial_read` | `path`, `maxBytes`, `encoding`, `peek`, `waitMs`, `minBytes` | Consumes what it returns unless `peek`; `waitMs` waits for `minBytes` to arrive |
| `serial_clear_buffer` | `path` | Drop buffered input, e.g. boot chatter before a command |
| `serial_write` | `path`, `data`, `encoding`, `lineEnding`, `drain` | `lineEnding` defaults to `none`; `drain` waits until the bytes leave the UART |
| `serial_close_port` | `path` | Closes the device for the console as well |

Payloads are `utf8`, `hex`, or `base64` in both directions. Use `hex` or `base64` for
binary protocols: a `utf8` read can split a multi-byte character at the buffer boundary.

### Request / response pattern

```
serial_clear_buffer  { path: "/dev/ttyUSB0" }
serial_write         { path: "/dev/ttyUSB0", data: "READ_TEMP", lineEnding: "crlf" }
serial_read          { path: "/dev/ttyUSB0", waitMs: 2000 }
```
