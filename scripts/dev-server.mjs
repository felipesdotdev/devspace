import { spawn } from "node:child_process";
import { readdirSync, statSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const watchRoots = [join(repoRoot, "src")];
const restartDelayMs = 750;
const crashDelayMs = 1500;

let child;
let restartTimer;
let stoppingForRestart = false;
let shuttingDown = false;

function log(message) {
  console.error(`[devspace:dev] ${message}`);
}

function start() {
  stoppingForRestart = false;
  child = spawn("npx", ["tsx", "src/cli.ts", "serve"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    child = undefined;
    if (shuttingDown || stoppingForRestart) return;
    log(`server exited (${signal ?? code ?? "unknown"}); restarting in ${crashDelayMs}ms`);
    scheduleRestart(crashDelayMs);
  });
}

function scheduleRestart(delayMs = restartDelayMs) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(restart, delayMs);
}

function restart() {
  if (shuttingDown) return;
  clearTimeout(restartTimer);

  if (!child) {
    start();
    return;
  }

  stoppingForRestart = true;
  child.once("exit", () => {
    if (!shuttingDown) start();
  });
  child.kill("SIGTERM");
}

function watchDirectory(root) {
  const seen = new Set();

  function addDirectory(dir) {
    if (seen.has(dir)) return;
    seen.add(dir);

    watch(dir, (event, filename) => {
      if (filename && event === "rename") maybeAddDirectory(join(dir, filename.toString()));
      scheduleRestart();
    });

    for (const entry of readdirSync(dir)) {
      maybeAddDirectory(join(dir, entry));
    }
  }

  function maybeAddDirectory(path) {
    try {
      const stats = statSync(path);
      if (stats.isDirectory()) addDirectory(path);
    } catch {
      // The file may have been deleted between the watch event and stat call.
    }
  }

  addDirectory(root);
}

function shutdown() {
  shuttingDown = true;
  clearTimeout(restartTimer);
  if (child) child.kill("SIGTERM");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, shutdown);
}

for (const root of watchRoots) {
  watchDirectory(root);
}

log("watching src; server restarts on changes and after crashes");
start();
