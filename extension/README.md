# ArmaMCP Native Extension

`ArmaMCP` is a small `callExtension` courier for the local sidecar HTTP bridge.
Arma loads the physical 64-bit binary as `ArmaMCP_x64.dll` or `ArmaMCP_x64.so`,
but SQF calls it with the base extension name:

```sqf
"ArmaMCP" callExtension "ping";
```

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
cmake -S extension -B extension/build -DCMAKE_BUILD_TYPE=Release -DARMA_MCP_PREFER_STATIC_RUNTIME=ON
cmake --build extension/build
```

The Linux extension is still a shared object, as Arma loads it through
`callExtension`, but the default build statically links the compiler runtimes
where the compiler supports it.

Windows/Proton DLL build with MinGW, when available:

```bash
x86_64-w64-mingw32-g++ -std=c++17 -O2 -shared -static -static-libgcc -static-libstdc++ -Wl,--exclude-libs,ALL -o ArmaMCP_x64.dll extension/src/ArmaMCP.cpp -lws2_32
```

The MinGW path prefers a self-contained DLL so Proton/Windows does not need
extra GCC runtime DLLs beside the mod.

The extension returns short strings in `OK:<json>` or `ERR:<message>` form and uses short localhost socket timeouts so Eden does not freeze for multi-second bridge failures.
