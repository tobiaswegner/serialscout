# SerialScout — Feature Reference

## Connection

### Port Selection
Choose the serial port from the dropdown in the top bar. Only ports detected by the OS are listed. The last used port is remembered and pre-selected on next launch.

### Baud Rate
Select from the standard baud rates (9600 – 921600). The last used rate is persisted across restarts. The connection must be re-established after changing the baud rate.

### Rescan
Click **Rescan** to refresh the port list without restarting the app.

### Connect / Disconnect
Click **Connect** to open the port. The status bar shows the active port, baud rate, and frame format (8N1). Click **Disconnect** to close it.

> **Advanced port settings** (data bits, stop bits, parity) are supported by the backend and can be passed to `serial.open()` — UI controls are available in the local build.

---

## Hardware Signals — DTR / RTS

When connected, **DTR** (Data Terminal Ready) and **RTS** (Request to Send) toggle buttons appear in the status bar. Both signals default to `LOW` on connect and reset to `LOW` on disconnect.

- **DTR** is commonly used to reset Arduino boards
- **RTS** is used for hardware flow control on many RS-232 devices
- Active (HIGH) state is indicated by the amber highlight on the button

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
The **autoscroll** checkbox (statusbar, far right) keeps the view pinned to the newest line.

---

## Console Toolbar (statusbar)

### A− / A+ — Font Size
Decreases or increases the console font size (range: 10 – 20 px). The chosen size is persisted across restarts.

### HEX — Hex View
Toggle between ASCII text (default) and hexadecimal rendering for **RX** lines. TX, SYS, and ERR lines always stay as text.

Example — `Hello` in hex mode: `48 65 6c 6c 6f`

### TS — Timestamp Format
Cycles through three modes:

| Mode | Example | Notes |
|------|---------|-------|
| Clock (default) | `10:42:07` | Wall-clock time |
| Relative | `+3.417s` | Seconds since the session connected |
| Hidden | *(no column)* | Maximum horizontal space for data |

Timestamp mode is persisted across restarts.

### FILTER — Console Filter
Opens the filter bar above the console.

- **Shortcut:** `Ctrl+F` / `Cmd+F` to open or close
- **Text mode** (default): case-insensitive substring match
- **Regex mode** (`.*` button): full regular expression, case-insensitive — the input border turns red for invalid patterns
- Live match counter shows `n / total`
- Press `Escape` or `✕` to close and clear the filter

### CLEAR — Clear Console
Discards all lines from the in-memory buffer instantly. The connection is unaffected.

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

The line ending selector is hidden in hex send mode.

### Command History
Press **↑** to recall the previous command, **↓** to move forward. History holds up to 100 unique entries (most-recent first, duplicates promoted).

### HEX — Hex Send Mode
Click the **HEX** toggle on the composer to switch to raw byte mode. Enter space-separated hex pairs and press **Send**:

```
48 65 6c 6c 6f 0A
```

Each pair must be 1–2 hex digits (`0`–`FF`). Invalid input highlights the field in red. No line ending is appended — the bytes are written verbatim. The TX log entry is suffixed with `[hex]` for clarity.

---

## Session Log — Export & Import

### Export
Click **Export** (top-right) to save the console buffer to a `.txt` file via a native save dialog. Format:

```
[2026-06-14T10:00:00.000Z] [RX] sensor reading: 23.4
[2026-06-14T10:00:00.012Z] [TX] READ_TEMP
[2026-06-14T10:00:00.013Z] [SYS] Connected to /dev/ttyUSB0 @ 115200 baud
```

The **Export** button is disabled when the console is empty.

### Import
Click **Import** to load a previously exported `.txt` file. The file is parsed back into colour-coded entries and appended to the current buffer with a `─── Imported N lines ───` separator. Lines that don't match the export format are added as SYS entries verbatim.

---

## Settings Persistence

The following settings are automatically saved to disk and restored on next launch:

| Setting | Notes |
|---------|-------|
| Last port | Validated against available ports on startup; falls back to first available |
| Baud rate | |
| Line ending | |
| Timestamp format | |
| Hex view (RX) | |
| Autoscroll | |
| Font size | |
