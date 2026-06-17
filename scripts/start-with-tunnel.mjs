#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const tunnelName = process.env.DEVSPACE_TUNNEL_NAME ?? "devspace";
const cloudflaredConfig = process.env.DEVSPACE_CLOUDFLARED_CONFIG ?? join(process.env.HOME ?? "", ".cloudflared", "config.yml");

const env = {
  ...process.env,
  DEVSPACE_TOOL_NAMING: process.env.DEVSPACE_TOOL_NAMING ?? "legacy",
  DEVSPACE_TOOL_MODE: process.env.DEVSPACE_TOOL_MODE ?? "full",
};

const children = new Set();

function start(name, command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit", shell: false, ...options });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`[devspace] ${name} exited` + (signal ? ` with signal ${signal}` : ` with code ${code}`));
    shutdown(code ?? 1);
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 2500).unref();
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

console.log("[devspace] starting MCP server");
start("server", process.execPath, ["dist/cli.js", "serve"]);

const tunnelArgs = existsSync(cloudflaredConfig)
  ? ["tunnel", "--config", cloudflaredConfig, "run", tunnelName]
  : ["tunnel", "run", tunnelName];

console.log("[devspace] starting Cloudflare Tunnel:", tunnelName);
start("cloudflared", "cloudflared", tunnelArgs);