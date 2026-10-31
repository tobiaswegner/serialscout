import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSerialMcpServer, MCP_SERVER_NAME, MCP_SERVER_VERSION } from "./mcp-tools.js";
import type { SerialManager } from "./manager.js";

export const DEFAULT_MCP_PORT = 8375;
export const MCP_PATH = "/mcp";

export function configuredPort(): number {
  return Number(process.env["SERIALSCOUT_MCP_PORT"]) || DEFAULT_MCP_PORT;
}

export function endpointUrl(port = configuredPort()): string {
  return `http://127.0.0.1:${port}${MCP_PATH}`;
}

export interface McpHost {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface McpHostOptions {
  manager: SerialManager;
  port?: number;
  /** Loopback only by default — this endpoint drives hardware and has no auth. */
  host?: string;
}

/**
 * Serves the serial MCP tools over Streamable HTTP from inside the desktop app,
 * against the app's own SerialManager. Because both sides share that manager, an
 * agent on this endpoint and the app's console can use one port simultaneously.
 *
 * Runs stateless: every request gets a fresh server/transport pair, so there is no
 * session state to expire and clients may reconnect freely.
 */
export function startMcpHost({
  manager,
  port = configuredPort(),
  host = "127.0.0.1",
}: McpHostOptions): Promise<McpHost> {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];

  const httpServer = http.createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
          id: null,
        }),
      );
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = (req.url ?? "/").split("?")[0];

    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          server: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION,
          transport: "streamable-http",
          endpoint: MCP_PATH,
          openPorts: manager.statusAll().map((s) => s.path),
        }),
      );
      return;
    }

    if (path !== MCP_PATH) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `Unknown path ${path}; MCP is served at ${MCP_PATH}` }));
      return;
    }

    const body = req.method === "POST" ? await readJsonBody(req) : undefined;

    const server = createSerialMcpServer(manager);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  return new Promise<McpHost>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", reject);
      resolve({
        url: `http://${host}:${port}${MCP_PATH}`,
        port,
        close: () =>
          new Promise<void>((done) => {
            httpServer.close(() => done());
            httpServer.closeAllConnections();
          }),
      });
    });
  });
}

/** Returns the endpoint URL if a SerialScout MCP host is already listening there. */
export async function probeHost(port = configuredPort()): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { server?: string };
    return body.server === MCP_SERVER_NAME ? endpointUrl(port) : null;
  } catch {
    return null;
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : undefined;
}
