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

Codex CLI helper form:

```bash
codex mcp add arma-mcp --env ARMA_MCP_TOKEN=replace-with-local-dev-token -- node /path/to/arma-mcp/sidecar/dist/index.js
```

The sidecar logs only to stderr in normal MCP mode. Do not use a token that is committed, shared, or reused outside the local machine.

For bridge-only development:

```bash
cd /path/to/arma-mcp/sidecar
ARMA_MCP_TOKEN=dev-token npm run dev:http
```
