# SerialScout — Feature Reference

## Connection

### Port Selection
Choose the serial port from the dropdown in the top bar. Only ports detected by the OS are listed.

### Baud Rate
Select from the standard baud rates (9600 – 921600) in the dropdown next to the port selector. The connection must be re-established after changing the baud rate.

### Rescan
Click **Rescan** to refresh the port list without restarting the app. Useful when plugging in a device after launch.

### Connect / Disconnect
Click **Connect** to open the port. The status bar shows the active port, baud rate, and frame format (8N1). Click **Disconnect** to close it.

> **Advanced port settings** (data bits, stop bits, parity) are supported by the backend and can be passed to `serial.open()` — UI controls are available in the local build.

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
Click **Export** in the top-right of the toolbar to save the current console buffer to a `.txt` file via a native save dialog. The log is encoded as UTF-8 with one entry per line:

```
[2026-06-14T10:00:00.000Z] [RX] sensor reading: 23.4
[2026-06-14T10:00:00.012Z] [TX] READ_TEMP
[2026-06-14T10:00:00.013Z] [SYS] Connected to /dev/ttyUSB0 @ 115200 baud
```

The **Export** button is disabled when the console is empty.

### Import
Click **Import** to load a previously exported `.txt` file. The file is parsed back into colour-coded log entries and appended to the current console buffer with a `─── Imported N lines ───` marker. Lines that don't match the export format are added as SYS entries verbatim, so plain-text log files from other tools can also be imported.

Both operations use the native OS file dialog and never transmit data over the network.
