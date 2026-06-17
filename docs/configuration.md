# Configuration

DevSpace loads settings from environment variables first and saved files second.

## Saved files

- `~/.devspace/config.json`: host, port, allowed roots, public URL, state directory, worktree root, agent directory, and optional SSH connections file.
- `~/.devspace/auth.json`: local approval password used by the authorization page.

## Important variables

- `HOST`: local bind host. Defaults to `127.0.0.1`.
- `PORT`: local port. Defaults to `7676`.
- `DEVSPACE_PUBLIC_BASE_URL`: public HTTPS origin without `/mcp`.
- `DEVSPACE_ALLOWED_ROOTS`: comma-separated local roots that may be opened.
- `DEVSPACE_ALLOWED_HOSTS`: comma-separated Host header allowlist. Use `*` only for trusted environments.
- `DEVSPACE_OAUTH_OWNER_TOKEN`: local approval password override.
- `DEVSPACE_CONNECTIONS_FILE`: JSON file for named SSH connections.
- `DEVSPACE_TOOL_MODE`: `minimal` or `full`. Defaults to `minimal`.
- `DEVSPACE_TOOL_NAMING`: `short` or `legacy`. Defaults to `short`.
- `DEVSPACE_WIDGETS`: `off`, `changes`, or `full`. Defaults to `full`.

## SSH connections

A connections file may define named SSH targets used by `open_workspace` via the `connection` or `sshTarget` fields. This is fork-specific and intentionally preserved during the upstream sync.
