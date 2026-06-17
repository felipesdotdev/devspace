# Setup

DevSpace can be configured through the CLI or through environment variables.

## CLI flow

```sh
npm run build
node dist/cli.js init
node dist/cli.js serve
```

When installed as a package, the same flow is exposed as:

```sh
devspace init
devspace serve
```

`devspace init` writes user configuration to `~/.devspace/config.json` and the owner password to `~/.devspace/auth.json`.

## Public URL

ChatGPT or Claude must be able to reach the MCP server. Use Cloudflare Tunnel, ngrok, Pinggy, Tailscale Funnel, or another HTTPS reverse proxy and set the public origin during setup. The MCP endpoint is always `/mcp` below that origin.

## SSH workspaces

This fork keeps SSH workspace support. During setup you may point DevSpace at a connections JSON file. You can also set it later with `DEVSPACE_CONNECTIONS_FILE`.
