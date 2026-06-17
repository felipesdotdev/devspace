# DevSpace

DevSpace exposes a secure local coding workspace through an MCP server so ChatGPT, Claude, and other MCP-capable clients can work directly with approved project directories.

This fork includes the latest upstream onboarding and packaging flow while preserving local fork features:

- CLI commands: `devspace init`, `devspace serve`, `devspace doctor`, and `devspace config`.
- Saved configuration under `~/.devspace`.
- Short tool names and minimal tool mode by default.
- `show_changes` as the upstream change-card tool, plus the legacy `review_changes` alias.
- Persistent workspace sessions.
- Persistent authorization sessions from this fork.
- Cloudflare tunnel startup files and scripts from this fork.
- SSH workspaces through configured connections or ad hoc `sshTarget` values.

## Quick start

```sh
npm install
npm run build
node dist/cli.js init
node dist/cli.js serve
```

When installed as a package, use:

```sh
devspace init
devspace serve
```

The local MCP endpoint is usually:

```txt
http://127.0.0.1:7676/mcp
```

ChatGPT or Claude needs a public HTTPS URL that forwards to the local server. Configure that origin during `devspace init`; do not include `/mcp` in the public base URL.

## Configuration

DevSpace reads environment variables first and `~/.devspace` files second. Key variables include:

- `DEVSPACE_ALLOWED_ROOTS`
- `DEVSPACE_PUBLIC_BASE_URL`
- `DEVSPACE_ALLOWED_HOSTS`
- `DEVSPACE_OAUTH_OWNER_TOKEN`
- `DEVSPACE_CONNECTIONS_FILE`
- `DEVSPACE_TOOL_MODE`
- `DEVSPACE_TOOL_NAMING`
- `DEVSPACE_WIDGETS`

See `docs/configuration.md` for details.

## Workflow

1. Open a workspace once with `open_workspace`.
2. Reuse the returned `workspaceId`.
3. Read project instructions such as `AGENTS.md` or `CLAUDE.md`.
4. Edit files with targeted tools where possible.
5. Run tests or builds.
6. Call `show_changes` so the user can inspect the diff.

## SSH workspaces

This fork preserves SSH support. Use `DEVSPACE_CONNECTIONS_FILE` for named connections, or pass `sshTarget` to `open_workspace` for an ad hoc target.

## Docs

- `docs/setup.md`
- `docs/configuration.md`
- `docs/security.md`
- `docs/gotchas.md`
- `docs/chatgpt-coding-workflow.md`

## License

MIT
