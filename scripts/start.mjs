import { accessSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const serverEntry = join(repoRoot, "src", "server.ts");
const cloudflaredConfig = resolve(repoRoot, ".cloudflared", "devspace.yml");

function assertExists(path, message) {
  try {
    accessSync(path);
  } catch {
    throw new Error(message);
  }
}

function spawnTracked(command, args, label) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error.message);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;
    if (signal) {
      console.error(`[${label}] exited with signal ${signal}`);
    } else {
      console.error(`[${label}] exited with code ${code ?? 0}`);
    }
    shutdown(code ?? 0);
  });

  return child;
}

let stopping = false;
const children = [];

function shutdown(code) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill("SIGKILL");
    }
    process.exit(code);
  }, 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

assertExists(tsxCli, "tsx is not installed. Run npm install first.");
assertExists(serverEntry, "src/server.ts not found.");

const server = spawnTracked(process.execPath, [tsxCli, "watch", serverEntry], "devspace");
children.push(server);

if (existsSync(cloudflaredConfig)) {
  const tunnel = spawnTracked(
    "cloudflared",
    ["tunnel", "--config", cloudflaredConfig, "run", "devspace"],
    "cloudflared",
  );
  children.push(tunnel);
} else {
  console.warn(`[cloudflared] config not found at ${cloudflaredConfig}; running server only.`);
}
