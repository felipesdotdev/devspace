#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { expandHomePath } from "./roots.js";
import {
  generateOwnerToken,
  loadDevspaceFiles,
  saveDevspaceAuth,
  saveDevspaceConfig,
  type DevspaceUserConfig,
} from "./user-config.js";

type Command = "serve" | "init" | "doctor" | "config" | "help";
const require = createRequire(import.meta.url);
const SUPPORTED_NODE_RANGE = ">=20.12 <27";

async function main(argv: string[]): Promise<void> {
  assertSupportedNode();

  const [rawCommand, ...args] = argv;
  const command = normalizeCommand(rawCommand);

  switch (command) {
    case "serve":
      await ensureConfigured();
      await serve();
      return;
    case "init":
      await runInit({ force: args.includes("--force") });
      return;
    case "doctor":
      runDoctor();
      return;
    case "config":
      runConfigCommand(args);
      return;
    case "help":
      printHelp();
      return;
  }
}

function normalizeCommand(command: string | undefined): Command {
  if (!command || command === "serve" || command === "start") return "serve";
  if (command === "init" || command === "doctor" || command === "config") return command;
  if (command === "help" || command === "--help" || command === "-h") return "help";
  throw new Error(`Unknown command: ${command}`);
}

async function ensureConfigured(): Promise<void> {
  const files = loadDevspaceFiles();
  if (files.configExists && files.authExists) return;
  if (process.env.DEVSPACE_OAUTH_OWNER_TOKEN) return;

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      [
        "DevSpace is not configured and this terminal is non-interactive.",
        "",
        "Run:",
        "  devspace init",
        "",
        "Or provide DEVSPACE_OAUTH_OWNER_TOKEN and DEVSPACE_ALLOWED_ROOTS.",
      ].join("\n"),
    );
  }

  await runInit({ force: false });
}

async function runInit({ force }: { force: boolean }): Promise<void> {
  const files = loadDevspaceFiles();
  if (!force && files.configExists && files.authExists) {
    console.log(`DevSpace is already configured at ${files.dir}`);
    console.log("Run `devspace init --force` to update it.");
    return;
  }

  console.log("\nDevSpace setup\n");
  const rl = createInterface({ input, output });

  try {
    const defaultRoots = files.config.allowedRoots?.join(", ") || process.cwd();
    const rootsAnswer = await ask(rl, `Where are your projects located? [${defaultRoots}] `, defaultRoots, validateNonEmpty);
    const allowedRoots = rootsAnswer
      .split(",")
      .map((root) => resolve(expandHomePath(root.trim())))
      .filter(Boolean);

    const defaultPort = String(files.config.port ?? 7676);
    const portAnswer = await ask(rl, `Which local port should DevSpace use? [${defaultPort}] `, defaultPort, validatePort);
    const port = Number(portAnswer);

    console.log([
      "",
      "DevSpace needs a public base URL so ChatGPT or Claude can reach this MCP server.",
      "Create a tunnel or reverse proxy with Cloudflare Tunnel, ngrok, Pinggy, Tailscale Funnel, or your own HTTPS proxy.",
      "Paste the public origin here, without /mcp.",
      "Example: https://your-tunnel-host.example.com",
      "",
    ].join("\n"));

    const defaultPublicBaseUrl = files.config.publicBaseUrl ?? "";
    const publicBaseUrl = normalizePublicBaseUrl(await ask(
      rl,
      defaultPublicBaseUrl
        ? `What is the public base URL? [${defaultPublicBaseUrl}] `
        : "What is the public base URL? ",
      defaultPublicBaseUrl,
      validateRequiredPublicBaseUrl,
    ));

    const existingConnectionsFile = files.config.connectionsFile ?? "";
    const connectionsFile = await ask(
      rl,
      existingConnectionsFile
        ? `Optional SSH connections JSON file [${existingConnectionsFile}] `
        : "Optional SSH connections JSON file (press Enter to skip) ",
      existingConnectionsFile,
    );

    const config: DevspaceUserConfig = {
      host: files.config.host ?? "127.0.0.1",
      port,
      allowedRoots,
      publicBaseUrl,
      ...(connectionsFile.trim() ? { connectionsFile: resolve(expandHomePath(connectionsFile.trim())) } : {}),
    };
    const auth = {
      ownerToken: files.auth.ownerToken ?? generateOwnerToken(),
    };

    const configPath = saveDevspaceConfig(config);
    const authPath = saveDevspaceAuth(auth);

    console.log("\nDevSpace configured");
    console.log(`Config: ${configPath}`);
    console.log(`Auth: ${authPath}`);
    console.log(`Local MCP URL: http://${config.host}:${config.port}/mcp`);
    console.log(`Public MCP URL: ${publicBaseUrl}/mcp`);
    console.log("\nOwner password");
    console.log(auth.ownerToken);
    console.log("Use this when ChatGPT or Claude asks you to approve DevSpace access.");
    console.log("\nRun `devspace serve` to start the MCP server.");
  } finally {
    rl.close();
  }
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  message: string,
  defaultValue = "",
  validate?: (value: string) => string | undefined,
): Promise<string> {
  for (;;) {
    const answer = (await rl.question(message)).trim() || defaultValue;
    const error = validate?.(answer);
    if (!error) return answer;
    console.log(error);
  }
}

async function serve(): Promise<void> {
  const sqliteStatus = checkSqliteNative();
  if (sqliteStatus !== "ok") {
    throw new Error(
      [
        "better-sqlite3 could not load for this Node runtime.",
        sqliteStatus,
        "",
        "Try reinstalling or rebuilding dependencies under the active Node version:",
        "  npm rebuild better-sqlite3",
      ].join("\n"),
    );
  }

  const { createServer } = await import("./server.js");
  const config = loadConfig();
  const { app } = createServer(config);
  const httpServer = app.listen(config.port, config.host, () => {
    console.log(`devspace listening on http://${config.host}:${config.port}/mcp`);
    console.log(`public base url: ${config.publicBaseUrl}`);
    console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log(`allowed hosts: ${config.allowedHosts.join(", ")}`);
    if (config.allowedHosts.includes("*")) {
      console.warn("warning: Host header allowlist is disabled because DEVSPACE_ALLOWED_HOSTS=*");
    }
    const sshConnections = Object.keys(config.sshConnections);
    if (sshConnections.length > 0) {
      console.log(`ssh connections: ${sshConnections.join(", ")}`);
    }
    console.log("auth: Owner password approval required");
    console.log(`logging: ${config.logging.level} ${config.logging.format}`);
  });

  const shutdown = () => {
    httpServer.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function runDoctor(): void {
  const files = loadDevspaceFiles();
  console.log(`Config dir: ${files.dir}`);
  console.log(`Config file: ${files.configExists ? files.configPath : "missing"}`);
  console.log(`Auth file: ${files.authExists ? files.authPath : "missing"}`);
  console.log(`Node: ${process.version} (${nodeVersionStatus()})`);
  console.log(`Node ABI: ${process.versions.modules}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Git: ${checkCommand("git", ["--version"])}`);
  console.log(`Bash shell: ${checkCommand("bash", ["--version"], true)}`);
  console.log(`SQLite native dependency: ${checkSqliteNative()}`);

  try {
    const config = loadConfig();
    console.log(`Host: ${config.host}`);
    console.log(`Port: ${config.port}`);
    console.log(`Public base URL: ${config.publicBaseUrl}`);
    console.log(`Allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log(`Allowed hosts: ${config.allowedHosts.join(", ")}`);
    console.log(`Tool mode: ${config.minimalTools ? "minimal" : "full"}`);
    console.log(`Tool naming: ${config.toolNaming}`);
    console.log(`Widgets: ${config.widgets}`);
    console.log(`State dir: ${config.stateDir}`);
    console.log(`Worktree root: ${config.worktreeRoot}`);
    console.log(`Skills: ${config.skillsEnabled ? "enabled" : "disabled"}`);
    console.log(`Agent dir: ${config.agentDir}`);
    console.log(`SSH connections: ${Object.keys(config.sshConnections).join(", ") || "none"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Config load: failed (${message})`);
  }
}

function runConfigCommand(args: string[]): void {
  const files = loadDevspaceFiles();
  if (args.includes("--path")) {
    console.log(files.configPath);
    return;
  }
  if (args.includes("--auth-path")) {
    console.log(files.authPath);
    return;
  }

  console.log(JSON.stringify({
    dir: files.dir,
    configPath: files.configPath,
    authPath: files.authPath,
    configExists: files.configExists,
    authExists: files.authExists,
    config: files.config,
  }, null, 2));
}

function printHelp(): void {
  console.log(`DevSpace

Usage:
  devspace init [--force]   Configure DevSpace in ~/.devspace
  devspace serve            Start the MCP server
  devspace doctor           Print environment and configuration diagnostics
  devspace config           Print saved configuration metadata
  devspace config --path    Print the config file path
  devspace help             Show this help

Environment variables still override saved config, including DEVSPACE_ALLOWED_ROOTS,
DEVSPACE_PUBLIC_BASE_URL, DEVSPACE_OAUTH_OWNER_TOKEN, and DEVSPACE_CONNECTIONS_FILE.`);
}

function validateNonEmpty(value: string): string | undefined {
  return value.trim() ? undefined : "Enter at least one value.";
}

function validatePort(value: string): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535
    ? undefined
    : "Enter a port between 1 and 65535.";
}

function validateRequiredPublicBaseUrl(value: string): string | undefined {
  if (!value.trim()) return "Enter a public HTTPS URL.";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !url.hostname.match(/^(localhost|127\.0\.0\.1|::1)$/)) {
      return "Use an HTTPS public URL, or localhost for local-only testing.";
    }
    return undefined;
  } catch {
    return "Enter a valid URL.";
  }
}

function normalizePublicBaseUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function assertSupportedNode(): void {
  if (nodeVersionStatus() === "unsupported") {
    throw new Error(`DevSpace requires Node ${SUPPORTED_NODE_RANGE}. Current version: ${process.version}`);
  }
}

function nodeVersionStatus(): "ok" | "unsupported" {
  const [majorRaw, minorRaw] = process.versions.node.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return "unsupported";
  if (major < 20 || major >= 27) return "unsupported";
  if (major === 20 && minor < 12) return "unsupported";
  return "ok";
}

function checkSqliteNative(): string {
  try {
    require("better-sqlite3");
    return "ok";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function checkCommand(command: string, args: string[], firstLine = false): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) return `unavailable (${result.error.message})`;
  if (result.status !== 0) return `failed (exit ${result.status})`;
  const text = `${result.stdout}${result.stderr}`.trim();
  return firstLine ? text.split(/\r?\n/)[0] || "ok" : text || "ok";
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
