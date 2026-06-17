import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expandHomePath } from "./roots.js";

export interface SshConnectionConfig {
  id: string;
  type: "ssh";
  host: string;
  port?: number;
  username?: string;
  identityFile?: string;
  sshConfigFile?: string;
  allowedRoots: string[];
  worktreeRoot: string;
  agentDir: string;
  skillsEnabled: boolean;
  skillPaths: string[];
  connectTimeoutSeconds: number;
}

interface RawConnectionsFile {
  connections?: Record<string, RawSshConnection> | RawNamedSshConnection[];
}

interface RawNamedSshConnection extends RawSshConnection {
  id?: string;
}

interface RawSshConnection {
  type?: string;
  host?: unknown;
  port?: unknown;
  username?: unknown;
  user?: unknown;
  identityFile?: unknown;
  sshConfigFile?: unknown;
  allowedRoots?: unknown;
  worktreeRoot?: unknown;
  agentDir?: unknown;
  skillsEnabled?: unknown;
  skillPaths?: unknown;
  connectTimeoutSeconds?: unknown;
}

const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;

export function createAdHocSshConnection(target: string, workspacePath: string): SshConnectionConfig {
  const parsed = parseSshTarget(target);
  const allowedRoot = normalizeRemoteAbsolutePath(workspacePath, "ad hoc SSH workspace path");

  return {
    id: `ssh:${target}`,
    type: "ssh",
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    allowedRoots: [allowedRoot],
    worktreeRoot: "~/.devspace/worktrees",
    agentDir: "~/.pi/agent",
    skillsEnabled: false,
    skillPaths: [],
    connectTimeoutSeconds: DEFAULT_CONNECT_TIMEOUT_SECONDS,
  };
}

export function isSshTarget(value: string): boolean {
  return value.includes("@") || value.startsWith("ssh://");
}

function parseSshTarget(value: string): { username?: string; host: string; port?: number } {
  const target = value.startsWith("ssh://") ? value.slice("ssh://".length) : value;
  const atIndex = target.lastIndexOf("@");
  const username = atIndex >= 0 ? target.slice(0, atIndex) : undefined;
  const hostPort = atIndex >= 0 ? target.slice(atIndex + 1) : target;
  const [host, rawPort] = hostPort.split(":");

  if (!host) throw new Error(`Invalid SSH target: ${value}`);
  return {
    username: username || undefined,
    host,
    port: rawPort ? optionalPort(rawPort, "SSH target port") : undefined,
  };
}

export function loadSshConnections(path: string | undefined): Record<string, SshConnectionConfig> {
  if (!path) return {};

  const resolvedPath = resolve(expandHomePath(path));
  if (!existsSync(resolvedPath)) {
    throw new Error(`DEVSPACE_CONNECTIONS_FILE does not exist: ${resolvedPath}`);
  }

  const parsed = parseJson(readFileSync(resolvedPath, "utf8"), resolvedPath);
  const rawConnections = normalizeRawConnections(parsed, resolvedPath);
  const connections: Record<string, SshConnectionConfig> = {};

  for (const [id, raw] of rawConnections) {
    if (id === "local") {
      throw new Error(`SSH connection id ${JSON.stringify(id)} is reserved.`);
    }
    if (connections[id]) {
      throw new Error(`Duplicate SSH connection id: ${id}`);
    }
    connections[id] = normalizeSshConnection(id, raw);
  }

  return connections;
}

function parseJson(content: string, path: string): RawConnectionsFile {
  try {
    return JSON.parse(content) as RawConnectionsFile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid DEVSPACE_CONNECTIONS_FILE JSON at ${path}: ${message}`);
  }
}

function normalizeRawConnections(
  parsed: RawConnectionsFile,
  path: string,
): Array<[string, RawSshConnection]> {
  const rawConnections = parsed.connections;
  if (!rawConnections) return [];

  if (Array.isArray(rawConnections)) {
    return rawConnections.map((entry, index) => {
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (!id) {
        throw new Error(`Connection at index ${index} in ${path} is missing an id.`);
      }
      return [id, entry];
    });
  }

  if (typeof rawConnections !== "object") {
    throw new Error(`connections in ${path} must be an object or an array.`);
  }

  return Object.entries(rawConnections);
}

function normalizeSshConnection(id: string, raw: RawSshConnection): SshConnectionConfig {
  if (raw.type !== undefined && raw.type !== "ssh") {
    throw new Error(`Connection ${id} has unsupported type: ${String(raw.type)}`);
  }

  const host = requiredString(raw.host, `connections.${id}.host`);
  const port = optionalPort(raw.port, `connections.${id}.port`);
  const username = optionalString(raw.username ?? raw.user, `connections.${id}.username`);
  const allowedRoots = requiredStringList(raw.allowedRoots, `connections.${id}.allowedRoots`)
    .map((root) => normalizeRemoteAbsolutePath(root, `connections.${id}.allowedRoots`));

  return {
    id,
    type: "ssh",
    host,
    port,
    username,
    identityFile: optionalLocalPath(raw.identityFile, `connections.${id}.identityFile`),
    sshConfigFile: optionalLocalPath(raw.sshConfigFile, `connections.${id}.sshConfigFile`),
    allowedRoots,
    worktreeRoot: optionalRemoteAbsolutePath(
      raw.worktreeRoot,
      `connections.${id}.worktreeRoot`,
      "~/.devspace/worktrees",
    ),
    agentDir: optionalRemoteAbsolutePath(raw.agentDir, `connections.${id}.agentDir`, "~/.pi/agent"),
    skillsEnabled: optionalBoolean(raw.skillsEnabled, true, `connections.${id}.skillsEnabled`),
    skillPaths: optionalStringList(raw.skillPaths, `connections.${id}.skillPaths`)
      .map((path) => optionalRemoteAbsolutePath(path, `connections.${id}.skillPaths`, path)),
    connectTimeoutSeconds: optionalPositiveInteger(
      raw.connectTimeoutSeconds,
      DEFAULT_CONNECT_TIMEOUT_SECONDS,
      `connections.${id}.connectTimeoutSeconds`,
    ),
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  return value.trim();
}

function requiredStringList(value: unknown, name: string): string[] {
  const list = optionalStringList(value, name);
  if (list.length === 0) {
    throw new Error(`${name} must contain at least one path.`);
  }
  return list;
}

function optionalStringList(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array of strings.`);
  }
  return value.map((entry, index) => requiredString(entry, `${name}[${index}]`));
}

function optionalPort(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

function optionalPositiveInteger(value: unknown, fallback: number, name: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function optionalBoolean(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
    if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  }
  throw new Error(`${name} must be a boolean.`);
}

function optionalLocalPath(value: unknown, name: string): string | undefined {
  const path = optionalString(value, name);
  return path ? resolve(expandHomePath(path)) : undefined;
}

function optionalRemoteAbsolutePath(value: unknown, name: string, fallback: string): string {
  const path = optionalString(value, name) ?? fallback;
  return normalizeRemoteAbsolutePath(path, name);
}

function normalizeRemoteAbsolutePath(path: string, name: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (normalized !== "~" && !normalized.startsWith("~/") && !normalized.startsWith("/")) {
    throw new Error(`${name} must be an absolute remote path or a leading-tilde path.`);
  }
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
