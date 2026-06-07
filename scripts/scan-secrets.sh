#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

patterns=(
  'OPENAI_API_KEY[[:space:]]*='
  'sk-[A-Za-z0-9_-]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  '-----BEGIN (RSA |DSA |EC |OPENSSH |)PRIVATE KEY-----'
  'ARMA_MCP_TOKEN[[:space:]]*=[[:space:]]*["'\'']?[A-Za-z0-9_/-]{40,}'
  'token[[:space:]]*=[[:space:]]*[A-Za-z0-9_/-]{40,}'
)

found=0
for pattern in "${patterns[@]}"; do
  if git grep -nE -e "${pattern}" -- . \
    ':!docs/SECURITY.md' \
    ':!scripts/scan-secrets.sh'; then
    found=1
  fi
done

if [[ "${found}" -ne 0 ]]; then
  echo "Potential secret material found in tracked files." >&2
  exit 1
fi

echo "No tracked-file secret patterns found."
