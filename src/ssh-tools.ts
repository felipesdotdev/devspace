import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SshConnectionConfig } from "./connections.js";
import type { ToolResponse } from "./pi-tools.js";

const execFileAsync = promisify(execFile);

type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface SshWorkspaceOpenInput {
  path: string;
  mode?: "checkout" | "worktree";
  baseRef?: string;
}

export interface SshWorkspaceOpenResult {
  root: string;
  mode: "checkout" | "worktree";
  sourceRoot?: string;
  worktree?: {
    path: string;
    baseRef: string;
    baseSha: string;
    dirtySource: boolean;
    detached: boolean;
    managed: boolean;
  };
  agentsFiles: Array<{ path: string; content: string }>;
  availableAgentsFiles: Array<{ path: string }>;
  skills: [];
  skillDiagnostics: unknown[];
}

export interface SshReviewChangesResult {
  result: string;
  summary: {
    files: number;
    additions: number;
    removals: number;
  };
  files: Array<{
    path: string;
    previousPath?: string;
    type: "change" | "rename-pure" | "rename-changed" | "new" | "deleted";
    additions: number;
    removals: number;
  }>;
  patch: string;
}

interface RemoteResult<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export async function openSshWorkspace(
  connection: SshConnectionConfig,
  input: SshWorkspaceOpenInput,
): Promise<SshWorkspaceOpenResult> {
  return remoteNode(connection, "openWorkspace", {
    ...input,
    allowedRoots: connection.allowedRoots,
    worktreeRoot: connection.worktreeRoot,
    agentDir: connection.agentDir,
    skillsEnabled: connection.skillsEnabled,
    skillPaths: connection.skillPaths,
  });
}

export async function readSshFileTool(
  connection: SshConnectionConfig,
  context: { root: string; cwd: string },
  input: { path: string; offset?: number; limit?: number },
): Promise<ToolResponse> {
  return sshTool(connection, "readFile", { ...context, ...input });
}

export async function writeSshFileTool(
  connection: SshConnectionConfig,
  context: { root: string; cwd: string },
  input: { path: string; content: string },
): Promise<ToolResponse> {
  return sshTool(connection, "writeFile", { ...context, ...input });
}

export async function editSshFileTool(
  connection: SshConnectionConfig,
  context: { root: string; cwd: string },
  input: { path: string; edits: Array<{ oldText: string; newText: string }> },
): Promise<ToolResponse<{ diff?: string; patch?: string }>> {
  return sshTool(connection, "editFile", { ...context, ...input });
}

export async function grepSshFilesTool(
  connection: SshConnectionConfig,
  context: { root: string; cwd: string },
  input: { pattern: string; path?: string; include?: string },
): Promise<ToolResponse> {
  return sshTool(connection, "grepFiles", { ...context, ...input });
}

export async function findSshFilesTool(
  connection: SshConnectionConfig,
  context: { root: string; cwd: string },
  input: { pattern: string; path?: string },
): Promise<ToolResponse> {
  return sshTool(connection, "findFiles", { ...context, ...input });
}

export async function listSshDirectoryTool(
  connection: SshConnectionConfig,
  context: { root: string; cwd: string },
  input: { path: string },
): Promise<ToolResponse> {
  return sshTool(connection, "listDirectory", { ...context, ...input });
}

export async function runSshShellTool(
  connection: SshConnectionConfig,
  context: { root: string; cwd: string },
  input: { command: string; timeout?: number },
): Promise<ToolResponse> {
  return sshTool(connection, "runShell", { ...context, ...input }, input.timeout);
}

export async function reviewSshChanges(
  connection: SshConnectionConfig,
  context: { root: string },
): Promise<SshReviewChangesResult> {
  return remoteNode(connection, "reviewChanges", context, 300);
}

async function sshTool<TDetails = unknown>(
  connection: SshConnectionConfig,
  method: string,
  params: Record<string, unknown>,
  timeoutSeconds?: number,
): Promise<ToolResponse<TDetails>> {
  try {
    const result = await remoteNode<{ content: McpContent[]; details?: TDetails }>(
      connection,
      method,
      params,
      timeoutSeconds,
    );
    return result;
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

async function remoteNode<T>(
  connection: SshConnectionConfig,
  method: string,
  params: Record<string, unknown>,
  timeoutSeconds?: number,
): Promise<T> {
  const payload = Buffer.from(JSON.stringify({ method, params }), "utf8").toString("base64url");
  const remoteCommand = remoteShellCommand(["node", "-e", REMOTE_SCRIPT, payload]);
  const { stdout } = await execFileAsync("ssh", sshArgs(connection, remoteCommand), {
    timeout: Math.max(1, timeoutSeconds ?? 30) * 1000,
    maxBuffer: 50 * 1024 * 1024,
  });
  const parsed = parseRemoteResult<T>(stdout);
  if (!parsed.ok) throw new Error(parsed.error ?? `SSH ${method} failed`);
  return parsed.result as T;
}

function parseRemoteResult<T>(stdout: string): RemoteResult<T> {
  const text = stdout.trim();
  const lastLine = text.split("\n").filter(Boolean).at(-1);
  if (!lastLine) throw new Error("SSH command produced no JSON response.");

  try {
    return JSON.parse(lastLine) as RemoteResult<T>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid SSH JSON response: ${message}. Output: ${text.slice(0, 1000)}`);
  }
}

function sshArgs(connection: SshConnectionConfig, remoteCommand: string): string[] {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${connection.connectTimeoutSeconds}`,
  ];

  if (connection.sshConfigFile) args.push("-F", connection.sshConfigFile);
  if (connection.identityFile) args.push("-i", connection.identityFile);
  if (connection.port) args.push("-p", String(connection.port));

  args.push(sshTarget(connection), remoteCommand);
  return args;
}

function sshTarget(connection: SshConnectionConfig): string {
  return connection.username ? `${connection.username}@${connection.host}` : connection.host;
}

function remoteShellCommand(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const REMOTE_SCRIPT = "\nconst fs = require(\"fs\");\nconst fsp = require(\"fs/promises\");\nconst os = require(\"os\");\nconst path = require(\"path\").posix;\nconst cp = require(\"child_process\");\nconst crypto = require(\"crypto\");\n\nconst SKIPPED_DIRS = new Set([\".git\", \".hg\", \".svn\", \"node_modules\", \".next\", \"dist\", \"build\", \"coverage\"]);\nconst CONTEXT_FILE_NAMES = new Set([\"AGENTS.md\", \"AGENTS.MD\", \"CLAUDE.md\", \"CLAUDE.MD\"]);\n\nfunction expandHome(value) {\n  if (value === \"~\") return os.homedir();\n  if (value.startsWith(\"~/\")) return path.join(os.homedir(), value.slice(2));\n  return value;\n}\n\nfunction normalize(value) {\n  return path.resolve(expandHome(String(value)));\n}\n\nfunction isInside(candidate, root) {\n  const rel = path.relative(root, candidate);\n  return rel === \"\" || (!rel.startsWith(\"..\") && rel !== \"..\" && !path.isAbsolute(rel));\n}\n\nfunction assertInside(candidate, roots, label) {\n  const normalized = normalize(candidate);\n  const normalizedRoots = roots.map(normalize);\n  if (normalizedRoots.some((root) => isInside(normalized, root))) return normalized;\n  throw new Error(`${label || \"Path\"} is outside allowed roots: ${candidate}`);\n}\n\nfunction resolveWorkspacePath(root, cwd, inputPath) {\n  const base = cwd ? assertInside(cwd, [root], \"Working directory\") : root;\n  const candidate = path.isAbsolute(expandHome(inputPath)) ? normalize(inputPath) : path.resolve(base, inputPath);\n  return assertInside(candidate, [root], \"Path\");\n}\n\nasync function assertDirectory(directory, original) {\n  const stat = await fsp.stat(directory);\n  if (!stat.isDirectory()) throw new Error(`Workspace root must be a directory: ${original}`);\n}\n\nfunction git(cwd, args, options = {}) {\n  const result = cp.spawnSync(\"git\", args, {\n    cwd,\n    encoding: \"utf8\",\n    maxBuffer: options.maxBuffer || 50 * 1024 * 1024,\n    env: options.env ? { ...process.env, ...options.env } : process.env,\n  });\n  if (result.error) throw result.error;\n  if (result.status !== 0) {\n    const details = (result.stderr || result.stdout || `git exited with ${result.status}`).trim();\n    throw new Error(details);\n  }\n  return result.stdout;\n}\n\nasync function openWorkspace(params) {\n  const mode = params.mode || \"checkout\";\n  if (mode === \"worktree\") return openWorktreeWorkspace(params);\n\n  const root = assertInside(params.path, params.allowedRoots, \"Workspace root\");\n  await fsp.mkdir(root, { recursive: true });\n  await assertDirectory(root, params.path);\n  const context = await loadWorkspaceContext(root, params);\n  return { root, mode: \"checkout\", ...context };\n}\n\nasync function openWorktreeWorkspace(params) {\n  const sourcePath = assertInside(params.path, params.allowedRoots, \"Workspace source root\");\n  await assertDirectory(sourcePath, params.path);\n  const sourceRoot = assertInside(git(sourcePath, [\"rev-parse\", \"--show-toplevel\"]).trim(), params.allowedRoots, \"Git root\");\n  const baseRef = params.baseRef || \"HEAD\";\n  const baseSha = git(sourceRoot, [\"rev-parse\", \"--verify\", `${baseRef}^{commit}`]).trim();\n  const dirtySource = git(sourceRoot, [\"status\", \"--porcelain=v1\"]).trim().length > 0;\n  const worktreeRoot = assertInside(params.worktreeRoot || \"~/.devspace/worktrees\", [params.worktreeRoot || \"~/.devspace/worktrees\"], \"Worktree root\");\n  await fsp.mkdir(worktreeRoot, { recursive: true });\n  const repoName = path.basename(sourceRoot).replace(/[^a-zA-Z0-9._-]+/g, \"-\").replace(/^-+|-+$/g, \"\").slice(0, 80) || \"repo\";\n  const worktreePath = path.join(worktreeRoot, `${repoName}-${crypto.randomBytes(4).toString(\"hex\")}`);\n  git(sourceRoot, [\"worktree\", \"add\", \"--detach\", worktreePath, baseSha]);\n  const context = await loadWorkspaceContext(worktreePath, params);\n\n  return {\n    root: worktreePath,\n    mode: \"worktree\",\n    sourceRoot,\n    worktree: {\n      path: worktreePath,\n      baseRef,\n      baseSha,\n      dirtySource,\n      detached: true,\n      managed: true,\n    },\n    ...context,\n  };\n}\n\nasync function loadWorkspaceContext(root, params) {\n  const agentsFiles = [];\n  const agentDir = normalize(params.agentDir || \"~/.pi/agent\");\n\n  for (const name of CONTEXT_FILE_NAMES) {\n    const globalPath = path.join(agentDir, name);\n    if (fs.existsSync(globalPath) && fs.statSync(globalPath).isFile()) {\n      agentsFiles.push({ path: globalPath, content: await fsp.readFile(globalPath, \"utf8\") });\n      break;\n    }\n  }\n\n  for (const name of CONTEXT_FILE_NAMES) {\n    const rootPath = path.join(root, name);\n    if (fs.existsSync(rootPath) && fs.statSync(rootPath).isFile()) {\n      agentsFiles.push({ path: rootPath, content: await fsp.readFile(rootPath, \"utf8\") });\n    }\n  }\n\n  const loaded = new Set(agentsFiles.map((file) => file.path));\n  const availableAgentsFiles = [];\n  await walk(root, async (entry) => {\n    if (!entry.isFile) return;\n    if (!CONTEXT_FILE_NAMES.has(path.basename(entry.path))) return;\n    if (loaded.has(entry.path)) return;\n    availableAgentsFiles.push({ path: entry.path });\n  });\n\n  const skillDiagnostics = params.skillsEnabled\n    ? [{ type: \"warning\", message: \"SSH workspaces currently expose remote files, search, edits, shell, worktrees, and review; remote Agent Skills are not loaded in this build.\" }]\n    : [];\n\n  return {\n    agentsFiles,\n    availableAgentsFiles: availableAgentsFiles.sort((a, b) => a.path.localeCompare(b.path)),\n    skills: [],\n    skillDiagnostics,\n  };\n}\n\nasync function walk(root, visitor) {\n  async function visit(directory) {\n    let entries;\n    try {\n      entries = await fsp.readdir(directory, { withFileTypes: true });\n    } catch {\n      return;\n    }\n    for (const entry of entries) {\n      const fullPath = path.join(directory, entry.name);\n      if (entry.isDirectory()) {\n        if (SKIPPED_DIRS.has(entry.name)) continue;\n        await visitor({ path: fullPath, isDirectory: true, isFile: false });\n        await visit(fullPath);\n      } else if (entry.isFile()) {\n        await visitor({ path: fullPath, isDirectory: false, isFile: true });\n      }\n    }\n  }\n  await visit(root);\n}\n\nasync function readFile(params) {\n  const file = resolveWorkspacePath(params.root, params.cwd, params.path);\n  const content = await fsp.readFile(file, \"utf8\");\n  const lines = content.split(/\\r?\\n/);\n  const offset = Math.max(1, Number(params.offset || 1));\n  const limit = params.limit === undefined ? undefined : Math.max(1, Number(params.limit));\n  const selected = limit === undefined ? lines.slice(offset - 1) : lines.slice(offset - 1, offset - 1 + limit);\n  return { content: [{ type: \"text\", text: selected.join(\"\\n\") }] };\n}\n\nasync function writeFile(params) {\n  const file = resolveWorkspacePath(params.root, params.cwd, params.path);\n  await fsp.writeFile(file, String(params.content), \"utf8\");\n  return { content: [{ type: \"text\", text: `Wrote ${path.relative(params.root, file) || \".\"}` }] };\n}\n\nasync function editFile(params) {\n  const file = resolveWorkspacePath(params.root, params.cwd, params.path);\n  let content = await fsp.readFile(file, \"utf8\");\n  const before = content;\n  for (const edit of params.edits || []) {\n    const oldText = String(edit.oldText);\n    const first = content.indexOf(oldText);\n    if (first === -1) throw new Error(`oldText not found in ${params.path}`);\n    if (content.indexOf(oldText, first + oldText.length) !== -1) {\n      throw new Error(`oldText must match uniquely in ${params.path}`);\n    }\n    content = content.slice(0, first) + String(edit.newText) + content.slice(first + oldText.length);\n  }\n  await fsp.writeFile(file, content, \"utf8\");\n  const diff = simpleDiff(path.relative(params.root, file), before, content);\n  return {\n    content: [{ type: \"text\", text: `Edited ${path.relative(params.root, file) || \".\"}.` }],\n    details: { diff, patch: diff },\n  };\n}\n\nasync function grepFiles(params) {\n  const scope = params.path ? resolveWorkspacePath(params.root, params.cwd, params.path) : params.root;\n  const includeRegex = params.include ? globToRegExp(params.include) : undefined;\n  const pattern = String(params.pattern);\n  const regex = new RegExp(pattern);\n  const matches = [];\n\n  await walk(scope, async (entry) => {\n    if (!entry.isFile) return;\n    const relative = path.relative(params.root, entry.path);\n    if (includeRegex && !includeRegex.test(relative)) return;\n    let text;\n    try { text = await fsp.readFile(entry.path, \"utf8\"); } catch { return; }\n    const lines = text.split(/\\r?\\n/);\n    for (let index = 0; index < lines.length; index += 1) {\n      regex.lastIndex = 0;\n      if (regex.test(lines[index])) matches.push(`${relative}:${index + 1}: ${lines[index]}`);\n    }\n  });\n\n  return { content: [{ type: \"text\", text: matches.join(\"\\n\") || \"No matches found.\" }] };\n}\n\nasync function findFiles(params) {\n  const scope = params.path ? resolveWorkspacePath(params.root, params.cwd, params.path) : params.root;\n  const regex = globToRegExp(params.pattern || \"**/*\");\n  const files = [];\n  await walk(scope, async (entry) => {\n    if (!entry.isFile) return;\n    const relative = path.relative(params.root, entry.path);\n    if (regex.test(relative)) files.push(relative);\n  });\n  files.sort((a, b) => a.localeCompare(b));\n  return { content: [{ type: \"text\", text: files.join(\"\\n\") }] };\n}\n\nasync function listDirectory(params) {\n  const directory = resolveWorkspacePath(params.root, params.cwd, params.path);\n  const entries = await fsp.readdir(directory, { withFileTypes: true });\n  const lines = entries\n    .map((entry) => `${entry.name}${entry.isDirectory() ? \"/\" : \"\"}`)\n    .sort((a, b) => a.localeCompare(b));\n  return { content: [{ type: \"text\", text: lines.join(\"\\n\") }] };\n}\n\nasync function runShell(params) {\n  const cwd = params.cwd ? resolveWorkspacePath(params.root, params.root, params.cwd) : params.root;\n  const timeout = Math.max(1, Math.min(Number(params.timeout || 30), 300));\n  const result = cp.spawnSync(String(process.env.SHELL || \"/bin/sh\"), [\"-lc\", String(params.command)], {\n    cwd,\n    encoding: \"utf8\",\n    timeout: timeout * 1000,\n    maxBuffer: 50 * 1024 * 1024,\n  });\n  const output = `${result.stdout || \"\"}${result.stderr || \"\"}`;\n  if (result.error) throw result.error;\n  if (result.status !== 0) throw new Error(output.trim() || `Command exited with ${result.status}`);\n  return { content: [{ type: \"text\", text: output }] };\n}\n\nasync function reviewChanges(params) {\n  const root = assertInside(params.root, [params.root], \"Workspace root\");\n  const gitRoot = git(root, [\"rev-parse\", \"--show-toplevel\"]).trim();\n  const patch = git(gitRoot, [\"diff\", \"--binary\", \"--no-color\", \"HEAD\"], { maxBuffer: 50 * 1024 * 1024 });\n  const numstat = git(gitRoot, [\"diff\", \"--numstat\", \"-z\", \"HEAD\"], { maxBuffer: 50 * 1024 * 1024 });\n  const files = parseNumstat(numstat);\n  const summary = files.reduce((acc, file) => ({ files: acc.files + 1, additions: acc.additions + file.additions, removals: acc.removals + file.removals }), { files: 0, additions: 0, removals: 0 });\n  return {\n    result: summary.files === 0 ? \"No changes since remote HEAD.\" : `Changed ${summary.files} ${summary.files === 1 ? \"file\" : \"files\"} since remote HEAD (+${summary.additions} -${summary.removals}).`,\n    summary,\n    files,\n    patch,\n  };\n}\n\nfunction parseNumstat(output) {\n  const fields = output.split(\"\\0\").filter(Boolean);\n  const files = [];\n  for (let index = 0; index < fields.length;) {\n    const header = fields[index++] || \"\";\n    const parts = header.split(\"\\t\");\n    const additions = parseStat(parts[0]);\n    const removals = parseStat(parts[1]);\n    if (parts.length >= 3) {\n      const filePath = parts[2] || \"\";\n      if (filePath) files.push({ path: filePath, type: fileType(undefined, additions, removals), additions, removals });\n      continue;\n    }\n    const previousPath = fields[index++];\n    const filePath = fields[index++];\n    if (filePath) files.push({ path: filePath, previousPath, type: fileType(previousPath, additions, removals), additions, removals });\n  }\n  return files;\n}\n\nfunction parseStat(value) {\n  if (!value || value === \"-\") return 0;\n  const parsed = Number(value);\n  return Number.isFinite(parsed) ? parsed : 0;\n}\n\nfunction fileType(previousPath, additions, removals) {\n  if (previousPath) return additions === 0 && removals === 0 ? \"rename-pure\" : \"rename-changed\";\n  if (additions > 0 && removals === 0) return \"new\";\n  if (additions === 0 && removals > 0) return \"deleted\";\n  return \"change\";\n}\n\nfunction simpleDiff(file, before, after) {\n  if (before === after) return \"\";\n  return [`--- a/${file}`, `+++ b/${file}`, \"@@\", ...before.split(/\\r?\\n/).map((line) => `-${line}`), ...after.split(/\\r?\\n/).map((line) => `+${line}`)].join(\"\\n\");\n}\n\nfunction globToRegExp(glob) {\n  let regex = \"^\";\n  for (let index = 0; index < glob.length; index += 1) {\n    const char = glob[index];\n    const next = glob[index + 1];\n    if (char === \"*\" && next === \"*\") {\n      regex += \".*\";\n      index += 1;\n    } else if (char === \"*\") {\n      regex += \"[^/]*\";\n    } else if (char === \"?\") {\n      regex += \"[^/]\";\n    } else {\n      regex += char.replace(/[|\\\\{}()[\\]^$+?.]/g, \"\\\\$&\");\n    }\n  }\n  regex += \"$\";\n  return new RegExp(regex);\n}\n\nconst payload = JSON.parse(Buffer.from(process.argv[1], \"base64url\").toString(\"utf8\"));\nconst methods = { openWorkspace, readFile, writeFile, editFile, grepFiles, findFiles, listDirectory, runShell, reviewChanges };\n(async () => {\n  const handler = methods[payload.method];\n  if (!handler) throw new Error(`Unknown remote method: ${payload.method}`);\n  const result = await handler(payload.params || {});\n  console.log(JSON.stringify({ ok: true, result }));\n})().catch((error) => {\n  console.log(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) }));\n  process.exitCode = 1;\n});";
