# Gotchas

## Public URL must match

The URL configured in `DEVSPACE_PUBLIC_BASE_URL` should be the public origin only. Do not include `/mcp`; DevSpace appends that path.

## Host allowlist

If requests are rejected unexpectedly, check the public tunnel host and `DEVSPACE_ALLOWED_HOSTS`. DevSpace derives common hosts automatically, but custom reverse proxies may need explicit entries.

## Native SQLite dependency

If `better-sqlite3` fails after changing Node versions, rebuild dependencies:

```sh
npm rebuild better-sqlite3
```

`devspace doctor` reports the native dependency status.

## Minimal tools

The default tool mode is minimal. In that mode, broad search/list helpers are hidden and clients should use the shell tool for inspection commands. Set `DEVSPACE_TOOL_MODE=full` to expose the full surface.

## Change cards

The upstream tool name is `show_changes`. This fork also keeps the legacy `review_changes` alias for clients that have not updated.

## SSH workspaces

SSH workspaces do not use local Git checkpoints for change cards. They report aggregate changes through the SSH backend.
