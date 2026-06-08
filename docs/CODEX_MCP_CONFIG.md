# Codex MCP Configuration

Build the sidecar:

```bash
cd /path/to/arma-mcp/sidecar
npm run build
```

Only register this MCP server for Codex sessions that need live Arma/Eden tools.
It does not need to be globally present for ordinary repository work.

Example `config.toml` entry:

```toml
[mcp_servers.arma-mcp]
command = "node"
args = ["/path/to/arma-mcp/sidecar/dist/index.js"]
env = { ARMA_MCP_TOKEN = "replace-with-local-dev-token" }
startup_timeout_sec = 10
tool_timeout_sec = 60
```

When Arma is already polling a separately started bridge, configure Codex to
reuse that bridge instead of binding the HTTP listener again:

```toml
[mcp_servers.arma-mcp]
command = "node"
args = ["/path/to/arma-mcp/sidecar/dist/index.js"]
env = {
  ARMA_MCP_TOKEN = "replace-with-local-dev-token",
  ARMA_MCP_SKIP_HTTP_LISTEN = "1"
}
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Codex CLI helper form:

```bash
codex mcp add arma-mcp --env ARMA_MCP_TOKEN=replace-with-local-dev-token -- node /path/to/arma-mcp/sidecar/dist/index.js
```

Reuse-mode helper form:

```bash
codex mcp add arma-mcp \
  --env ARMA_MCP_TOKEN=replace-with-local-dev-token \
  --env ARMA_MCP_SKIP_HTTP_LISTEN=1 \
  -- node /path/to/arma-mcp/sidecar/dist/index.js
```

The sidecar logs only to stderr in normal MCP mode. Do not use a token that is committed, shared, or reused outside the local machine.

For bridge-only development:

```bash
cd /path/to/arma-mcp/sidecar
ARMA_MCP_TOKEN=dev-token npm run dev:http
```

For local development of the stdio reuse path:

```bash
cd /path/to/arma-mcp/sidecar
ARMA_MCP_TOKEN=dev-token npm run dev:stdio-existing
```

## Safe Restart Workflow

Codex normally starts the MCP stdio process from `sidecar/dist/index.js`. If
Arma is polling a separately started HTTP bridge, keep Codex configured with
`ARMA_MCP_SKIP_HTTP_LISTEN=1` and restart only the HTTP-only bridge:

```bash
cd /path/to/arma-mcp/sidecar
ARMA_MCP_TOKEN=dev-token npm run dev:http
```

Avoid killing generic `dist/index.js` processes unless you intentionally want
the Codex MCP host to reconnect the stdio server. A healthy stdio reuse process
will report `mode: "stdio-existing-bridge"` and `ownsHttpListener: false` from
`arma.ping`, `arma.bridge.get_status`, or `arma.bridge.diagnostics`.

If direct stdio `tools/list` shows the full table but the Codex-managed
namespace omits individual tools, restart/reload the Codex MCP host. While that
managed registry is stale, `arma_discovery` and `arma_call` provide an
allowlisted fallback for the PLAN-002 discovery-gap tools without exposing raw
SQF or shell execution.

For managed discovery contexts that surface simpler underscore names more
reliably than dotted names, `arma_visual_inspect_class` aliases
`arma.visual.inspectClass`, and `arma_composition_plan` aliases
`arma.composition.plan`.
The sidecar also exposes discovery-friendly aliases for common PLAN-002 reads:
`arma_catalog_status`, `arma_catalog_search`, `arma_catalog_get_class`,
`arma_catalog_find_by_role`, and `arma_eden_list_placed`.

If Eden stops polling after a bridge restart, restart or reload Arma Eden after
the HTTP bridge is already listening. The direct HTTP bridge remains a useful
diagnostic fallback while the managed Codex MCP host is stale, but keep bearer
tokens local and out of committed files.
