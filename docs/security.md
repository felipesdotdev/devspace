# Security

DevSpace exposes local development tools through MCP. Treat it like remote access to your machine.

## Defaults

- The local server binds to `127.0.0.1` by default.
- Allowed roots default to the current working directory unless configured.
- The Host header allowlist is derived from the local host and public base URL.
- Skills are enabled by default, but only advertised skill files are readable outside the workspace.

## Recommendations

- Keep `DEVSPACE_ALLOWED_ROOTS` narrow.
- Prefer HTTPS tunnels with stable domains.
- Do not set `DEVSPACE_ALLOWED_HOSTS=*` unless the network path is trusted.
- Keep the local approval password private.
- Review `show_changes` output before committing generated edits.

## SSH

This fork supports SSH workspaces. SSH connections should use key-based authentication and narrow remote allowed roots. Avoid giving a remote connection broader filesystem access than the project requires.
