# ArmaMCP

ArmaMCP is a local-first MVP bridge from Codex to Arma 3 Eden Editor.

```text
Codex MCP client
  -> TypeScript stdio sidecar
  -> 127.0.0.1 HTTP bridge
  -> ArmaMCP_x64 native extension
  -> SQF Eden addon
```

The current MVP can:

- expose MCP tools for bridge diagnostics, Eden reads/writes, catalog search/scan/measurement, screenshots, composition helpers, procedural generators, and legacy MVP snapshot aliases;
- receive Eden selection snapshots through a localhost bearer-token bridge;
- queue typed, policy-checked Eden actions through the bridge;
- build a HEMTT addon with Eden polling, snapshot capture, typed action dispatch, safe batch operations, composition capture/apply, catalog scanning, measurement, and camera/screenshot helpers;
- build native Linux `.so` and Windows/Proton `.dll` extension binaries when local compilers are present.

## Safety Limits

- Bridge binds to `127.0.0.1` only by default.
- `/bridge/*` endpoints require `Authorization: Bearer <ARMA_MCP_TOKEN>`.
- No raw SQF execution MCP tool is exposed.
- No remote execution or public server control is included.
- Write/destructive tools use typed schemas, policy checks, dry-runs, and explicit confirmation where required.

## Build

```bash
cd sidecar
npm run validate
cd ..
./scripts/build-extension.sh
hemtt build
./scripts/release-signed.sh
```

`hemtt dev` also builds the addon, then tries to deploy to the local Arma 3 install. In restricted environments this may fail at the deployment step even when config and SQF compilation succeeded.

## MCP

Build the sidecar first:

```bash
cd sidecar
npm run build
```

Example Codex CLI registration:

```bash
codex mcp add arma-mcp --env ARMA_MCP_TOKEN=replace-with-local-dev-token -- node /path/to/arma-mcp/sidecar/dist/index.js
```

If a bridge process is already running for Arma to poll, reload Codex MCP in
stdio-only reuse mode so it does not try to bind the same localhost port:

```bash
codex mcp add arma-mcp \
  --env ARMA_MCP_TOKEN=replace-with-local-dev-token \
  --env ARMA_MCP_SKIP_HTTP_LISTEN=1 \
  -- node /path/to/arma-mcp/sidecar/dist/index.js
```

See [docs/CODEX_MCP_CONFIG.md](docs/CODEX_MCP_CONFIG.md).

## Eden Test

1. Set `ARMA_MCP_TOKEN` in the sidecar environment and put the same token in the local mod's `ArmaMCP.ini`.
2. Start the sidecar directly with `node sidecar/dist/index.js`, or start one bridge with `npm run dev:http` and point Codex MCP at it with `ARMA_MCP_SKIP_HTTP_LISTEN=1`.
3. Build/load the addon with HEMTT.
4. Open Eden and select an object.
5. Use `arma.ping`, `arma.bridge.diagnostics`, `arma.bridge.get_status`, `arma.bridge.get_capabilities`, and the Eden read/write tools to inspect, dry-run, apply, and re-read changes. If a Codex-managed session omits individual dotted tool names, use `arma_discovery` to list fallback coverage, `arma_call` with an allowlisted `toolName`, or the discovery-friendly aliases such as `arma_catalog_search`, `arma_visual_inspect_class`, and `arma_composition_plan`.

See [docs/EDEN_TESTING.md](docs/EDEN_TESTING.md).

## Proton Notes

For Arma 3 running under Proton, the Windows game process should load `ArmaMCP_x64.dll`; that DLL can still talk to the native Linux sidecar over `127.0.0.1`. See [docs/PROTON_LINUX_NOTES.md](docs/PROTON_LINUX_NOTES.md).
