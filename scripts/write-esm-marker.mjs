// The MCP entry points are emitted as ES modules into out/serial, but the root
// package.json has no "type" field, so Node would treat those .js files as CJS.
// This marker tells it otherwise.
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("out/serial", { recursive: true });
writeFileSync("out/serial/package.json", JSON.stringify({ type: "module" }, null, 2) + "\n");
