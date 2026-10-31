/**
 * stdio entry point for MCP clients that launch servers as a child process.
 *
 * Two modes, picked automatically:
 *  - proxy — the SerialScout desktop app is running and hosting the MCP endpoint,
 *    so this process just relays JSON-RPC to it. The app's console and the agent
 *    then share one serial connection.
 *  - local — no app is running, so this process opens serial ports itself and
 *    owns them exclusively until it exits.
 *
 * Override with SERIALSCOUT_MCP_MODE=proxy|local|auto (default auto).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_BUFFER_BYTES, SerialManager } from "./manager.js";
import { createSerialMcpServer } from "./mcp-tools.js";
import { configuredPort, endpointUrl, probeHost } from "./mcp-host.js";

type Mode = "auto" | "proxy" | "local";

const mode = (process.env["SERIALSCOUT_MCP_MODE"] ?? "auto") as Mode;
const bufferBytes = Number(process.env["SERIALSCOUT_MCP_BUFFER_BYTES"]) || DEFAULT_BUFFER_BYTES;

/** Relays every JSON-RPC message between stdin/stdout and the app's HTTP endpoint. */
async function runProxy(url: string): Promise<void> {
  const upstream = new StreamableHTTPClientTransport(new URL(url));
  const downstream = new StdioServerTransport();

  downstream.onmessage = (message: JSONRPCMessage) => {
    void upstream.send(message).catch((err: unknown) => {
      console.error("Upstream send failed:", err);
    });
  };
  upstream.onmessage = (message: JSONRPCMessage) => {
    void downstream.send(message).catch((err: unknown) => {
      console.error("Downstream send failed:", err);
    });
  };

  upstream.onerror = (err) => console.error("Upstream error:", err.message);
  downstream.onerror = (err) => console.error("Downstream error:", err.message);
  downstream.onclose = () => void upstream.close();
  upstream.onclose = () => {
    void downstream.close();
    process.exit(0);
  };

  await upstream.start();
  await downstream.start();
  console.error(`serialscout-serial MCP: proxying to the running app at ${url}`);
}

/** Serves the tools from this process, owning the serial ports directly. */
async function runLocal(): Promise<void> {
  const manager = new SerialManager(bufferBytes);
  const server = createSerialMcpServer(manager);

  const shutdown = async () => {
    await manager.closeAll("mcp");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await server.connect(new StdioServerTransport());
  console.error(
    `serialscout-serial MCP: standalone mode (buffer ${bufferBytes} bytes/port). ` +
      `Ports opened here are exclusive — start SerialScout before this server to share them.`,
  );
}

async function main(): Promise<void> {
  if (mode === "local") return runLocal();

  const url = await probeHost();
  if (url) return runProxy(url);

  if (mode === "proxy") {
    throw new Error(
      `No SerialScout MCP host answered at ${endpointUrl(configuredPort())}. ` +
        `Start the desktop app, or unset SERIALSCOUT_MCP_MODE to fall back to standalone mode.`,
    );
  }
  return runLocal();
}

main().catch((err: unknown) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
