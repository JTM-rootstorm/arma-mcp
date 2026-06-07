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

- expose MCP tools for ping, snapshots, checkpoint plan generation, plan queueing, and bridge events;
- receive Eden selection snapshots through a localhost bearer-token bridge;
- queue structured `requestSnapshot` and `applyPlan` commands for Eden;
- build a HEMTT addon with Eden polling, snapshot capture, and safe create-object/create-marker plan application;
- build native Linux `.so` and Windows/Proton `.dll` extension binaries when local compilers are present.

## Safety Limits

- Bridge binds to `127.0.0.1` only by default.
- `/bridge/*` endpoints require `Authorization: Bearer <ARMA_MCP_TOKEN>`.
- No raw SQF execution MCP tool is exposed.
- No remote execution or public server control is included.
- MVP plan operations are restricted to `createObject` and `createMarker`.

## Build

```bash
cd sidecar
npm run validate
cd ..
./scripts/build-extension.sh
hemtt build
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
codex mcp add arma-mcp --env ARMA_MCP_TOKEN=replace-with-local-dev-token -- node /home/mike/Documents/Programming/arma-mcp/sidecar/dist/index.js
```

See [docs/CODEX_MCP_CONFIG.md](docs/CODEX_MCP_CONFIG.md).

## Eden Test

1. Set `ARMA_MCP_TOKEN` in the sidecar environment and in the Arma/extension environment.
2. Start the sidecar through Codex MCP or `node sidecar/dist/index.js`.
3. Build/load the addon with HEMTT.
4. Open Eden and select an object.
5. Use the MCP tools to request/read a snapshot, generate a checkpoint plan, set `dryRun=false`, queue it, then inspect bridge events.

See [docs/EDEN_TESTING.md](docs/EDEN_TESTING.md).

## Proton Notes

For Arma 3 running under Proton, the Windows game process should load `ArmaMCP_x64.dll`; that DLL can still talk to the native Linux sidecar over `127.0.0.1`. See [docs/PROTON_LINUX_NOTES.md](docs/PROTON_LINUX_NOTES.md).
