#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/extension/build"

if command -v cmake >/dev/null 2>&1; then
  cmake \
    -S "${ROOT_DIR}/extension" \
    -B "${BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DARMA_MCP_PREFER_STATIC_RUNTIME=ON
  cmake --build "${BUILD_DIR}"
else
  echo "cmake is required to build the native extension." >&2
  echo "Install cmake or use a direct compiler command documented in extension/README.md." >&2
  exit 1
fi

if command -v x86_64-w64-mingw32-g++ >/dev/null 2>&1; then
  x86_64-w64-mingw32-g++ \
    -std=c++17 \
    -O2 \
    -shared \
    -static \
    -static-libgcc \
    -static-libstdc++ \
    -Wl,--exclude-libs,ALL \
    -o "${ROOT_DIR}/extension/build/ArmaMCP_x64.dll" \
    "${ROOT_DIR}/extension/src/ArmaMCP.cpp" \
    -lws2_32
else
  echo "Windows cross-compiler not found: x86_64-w64-mingw32-g++" >&2
  echo "Linux/shared-object build is complete if cmake succeeded." >&2
  echo "Install mingw-w64 to build ArmaMCP_x64.dll for Proton/Windows Arma." >&2
fi
