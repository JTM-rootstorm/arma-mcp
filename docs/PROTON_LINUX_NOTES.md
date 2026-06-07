# Proton And Linux Notes

For client-side Eden testing under Proton:

```text
Arma 3 Windows executable under Proton
  -> loads ArmaMCP_x64.dll
  -> talks to native Linux sidecar over 127.0.0.1
```

Build the Windows DLL when MinGW is available:

```bash
./scripts/build-extension.sh
```

The script writes generated binaries to `extension/build/`, which is ignored by git.

The native Linux `.so` build is useful for smoke testing and future native server work, but the first Proton client path should load the Windows DLL from the Windows Arma process.

Do not build the MVP around shared memory, named pipes, public networking, or a Linux `.so` loaded by Proton Arma.
