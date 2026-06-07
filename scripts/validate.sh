#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}/sidecar"
npm run validate

cd "${ROOT_DIR}"
./scripts/build-extension.sh
hemtt build
git status --short --untracked-files=all
git check-ignore -v plans || true
git check-ignore -v plans/arma_mcp_codex_mvp_plans/plans/00-CODEX-ONE-SHOT-PROMPT.md || true
