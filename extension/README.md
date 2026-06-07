# ArmaMCP Native Extension

`ArmaMCP_x64` is a small `callExtension` courier for the local sidecar HTTP bridge.

Supported verbs:

- `ping`
- `postSnapshot:<json>`
- `pollCommands`
- `postResult:<json>`
- `postEvent:<json>`

Preferred local mod configuration:

Create `ArmaMCP.ini` next to `ArmaMCP_x64.dll` in the local mod folder:

```ini
host=127.0.0.1
port=38473
token=replace-with-local-token
```

Environment fallback:

- `ARMA_MCP_HOST`, default `127.0.0.1`
- `ARMA_MCP_PORT`, default `38473`
- `ARMA_MCP_TOKEN`, required for `/bridge/*` endpoints if `ArmaMCP.ini` is absent

If both are present, `ArmaMCP.ini` wins for values it defines. Do not commit a real
`ArmaMCP.ini` containing a token.

Linux build:

```bash
cmake -S extension -B extension/build
cmake --build extension/build
```

Windows/Proton DLL build with MinGW, when available:

```bash
x86_64-w64-mingw32-g++ -std=c++17 -O2 -shared -o ArmaMCP_x64.dll extension/src/ArmaMCP.cpp -lws2_32
```

The extension returns short strings in `OK:<json>` or `ERR:<message>` form and uses short localhost socket timeouts so Eden does not freeze for multi-second bridge failures.
