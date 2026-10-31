import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  SerialError,
  type PortSettings,
  type SerialManager,
  type SettingsPatch,
} from "./manager.js";

export const MCP_SERVER_NAME = "serialscout-serial";
export const MCP_SERVER_VERSION = "0.1.0";

const INSTRUCTIONS =
  "Access to local serial/UART ports: enumerate devices, open them with a given " +
  "framing configuration, inspect and change those settings, drain the receive " +
  "buffer, and transmit data. When the SerialScout desktop app hosts this server, " +
  "the app console and these tools share one connection: both see every received " +
  "byte, opening a port the app already has open simply joins it, and anything " +
  "written here shows up in the app's console. Ports must be opened with " +
  "serial_open_port before reading or writing.";

// ---- Shared parameter shapes ----------------------------------------------

const pathParam = z.string().min(1).describe("Device path, e.g. /dev/ttyUSB0 or COM3");

const settingsShape = {
  baudRate: z.number().int().positive().describe("Baud rate, e.g. 9600, 115200"),
  dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).optional(),
  stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
  parity: z.enum(["none", "even", "odd", "mark", "space"]).optional(),
  rtscts: z.boolean().optional().describe("Hardware (RTS/CTS) flow control"),
  xon: z.boolean().optional().describe("Software flow control on transmit"),
  xoff: z.boolean().optional().describe("Software flow control on receive"),
};

const encodingParam = z
  .enum(["utf8", "hex", "base64"])
  .describe("How the byte payload is encoded in this call");

// ---- Helpers ---------------------------------------------------------------

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

async function guard(fn: () => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err);
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---- Server ----------------------------------------------------------------

/** Builds an MCP server whose tools act on the given (possibly shared) manager. */
export function createSerialMcpServer(manager: SerialManager): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "serial_list_ports",
    {
      title: "List serial ports",
      description:
        "Enumerate the serial ports the operating system currently reports, with " +
        "manufacturer/VID/PID metadata and whether the port is already open here.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      guard(async () => {
        const ports = await manager.listPorts();
        return ok({ count: ports.length, ports });
      }),
  );

  server.registerTool(
    "serial_open_port",
    {
      title: "Open serial port",
      description:
        "Open a serial port with the given configuration and start buffering received " +
        "bytes. Defaults are 8 data bits, 1 stop bit, no parity, no flow control. If the " +
        "port is already open here with the same configuration this simply joins it; if " +
        "the configuration differs, it fails and points you at serial_set_settings.",
      inputSchema: { path: pathParam, ...settingsShape },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ path, ...rest }) =>
      guard(async () => {
        const settings: PortSettings = { ...DEFAULT_SETTINGS, path, baudRate: rest.baudRate };
        Object.assign(settings, stripUndefined(rest));
        return ok(await manager.open(settings, "mcp"));
      }),
  );

  server.registerTool(
    "serial_close_port",
    {
      title: "Close serial port",
      description:
        "Close an open serial port and discard its receive buffer. This closes the " +
        "device for everyone, including the desktop console, so leave it open if a user " +
        "is watching the same port.",
      inputSchema: { path: pathParam },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ path }) =>
      guard(async () => {
        await manager.close(path, "mcp");
        return ok({ path, closed: true });
      }),
  );

  server.registerTool(
    "serial_status",
    {
      title: "Serial port status",
      description:
        "Report the current settings, buffered/dropped/total byte counts and last error " +
        "for one open port (with modem signal lines when the driver exposes them), or for " +
        "every open port when no path is given.",
      inputSchema: { path: pathParam.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ path }) =>
      guard(async () => {
        if (!path) {
          const sessions = manager.statusAll();
          return ok({ count: sessions.length, ports: sessions });
        }
        const snapshot = manager.status(path);
        const signals = await manager.signals(path);
        return ok({ ...snapshot, signals });
      }),
  );

  server.registerTool(
    "serial_set_settings",
    {
      title: "Change serial port settings",
      description:
        "Change the configuration of an already-open port. Only the fields you pass are " +
        "changed. A baud-rate-only change is applied in place; changing framing or flow " +
        "control reopens the device. Buffered data and byte counters are preserved either " +
        "way, and the desktop console follows the change.",
      inputSchema: {
        path: pathParam,
        baudRate: settingsShape.baudRate.optional(),
        dataBits: settingsShape.dataBits,
        stopBits: settingsShape.stopBits,
        parity: settingsShape.parity,
        rtscts: settingsShape.rtscts,
        xon: settingsShape.xon,
        xoff: settingsShape.xoff,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ path, ...rest }) =>
      guard(async () => {
        const patch = stripUndefined(rest) as SettingsPatch;
        if (Object.keys(patch).length === 0) {
          throw new SerialError("Pass at least one setting to change");
        }
        return ok(await manager.setSettings(path, patch, "mcp"));
      }),
  );

  server.registerTool(
    "serial_read",
    {
      title: "Read receive buffer",
      description:
        "Take bytes from the receive buffer of an open port. Consumes what it returns " +
        "unless peek is true — this buffer is yours alone, so reading never removes " +
        "anything from the desktop console. With waitMs set, waits up to that long for at " +
        "least minBytes to arrive, which is how you read a reply right after serial_write. " +
        "Note that utf8 decoding can split a multi-byte character at the boundary; use hex " +
        "or base64 for binary protocols.",
      inputSchema: {
        path: pathParam,
        maxBytes: z.number().int().positive().max(1_048_576).default(4096),
        encoding: encodingParam.default("utf8"),
        peek: z.boolean().default(false).describe("Leave the bytes in the buffer"),
        waitMs: z
          .number()
          .int()
          .min(0)
          .max(60_000)
          .default(0)
          .describe("Wait up to this long for minBytes to arrive before returning"),
        minBytes: z.number().int().positive().default(1).describe("Used together with waitMs"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ path, maxBytes, encoding, peek, waitMs, minBytes }) =>
      guard(async () => {
        const deadline = Date.now() + waitMs;
        let buffered = manager.status(path).receiveBuffer.bytes;
        while (buffered < minBytes && Date.now() < deadline) {
          await delay(Math.min(25, Math.max(1, deadline - Date.now())));
          buffered = manager.status(path).receiveBuffer.bytes;
        }

        const { data, snapshot } = manager.read(path, maxBytes, peek);
        return ok({
          path,
          encoding,
          bytes: data.length,
          data: data.toString(encoding),
          remainingBytes: snapshot.receiveBuffer.bytes,
          droppedBytes: snapshot.receiveBuffer.droppedBytes,
          timedOut: waitMs > 0 && data.length < minBytes,
        });
      }),
  );

  server.registerTool(
    "serial_clear_buffer",
    {
      title: "Clear receive buffer",
      description:
        "Discard everything currently buffered for an open port without reading it. " +
        "Useful to drop boot chatter before sending a command. The desktop console keeps " +
        "its own history and is unaffected.",
      inputSchema: { path: pathParam },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ path }) =>
      guard(async () => {
        const { discardedBytes, snapshot } = manager.clearBuffer(path);
        return ok({ path, discardedBytes, receiveBuffer: snapshot.receiveBuffer });
      }),
  );

  server.registerTool(
    "serial_write",
    {
      title: "Transmit on serial port",
      description:
        "Transmit data on an open port. The payload is decoded from the given encoding, " +
        "then the chosen line ending is appended (none by default — many device CLIs need " +
        "lf or crlf). Returns once the bytes are queued, or once they have physically left " +
        "the UART when drain is true. Everything sent is mirrored into the desktop console.",
      inputSchema: {
        path: pathParam,
        data: z.string().describe("Payload, encoded per the encoding parameter"),
        encoding: encodingParam.default("utf8"),
        lineEnding: z.enum(["none", "lf", "cr", "crlf"]).default("none"),
        drain: z.boolean().default(false).describe("Wait for the bytes to be flushed"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ path, data, encoding, lineEnding, drain }) =>
      guard(async () => {
        const endings: Record<string, string> = { none: "", lf: "\n", cr: "\r", crlf: "\r\n" };
        const payload = Buffer.concat([
          Buffer.from(data, encoding),
          Buffer.from(endings[lineEnding], "ascii"),
        ]);
        const snapshot = await manager.write(path, payload, drain, "mcp");
        return ok({
          path,
          bytesWritten: payload.length,
          drained: drain,
          totals: snapshot.totals,
          receiveBuffer: snapshot.receiveBuffer,
        });
      }),
  );

  return server;
}
