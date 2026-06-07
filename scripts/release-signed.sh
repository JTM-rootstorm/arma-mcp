#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"
hemtt release

AUTHORITY="$(hemtt value project.signing.authority)"
PBO=".hemttout/release/addons/amcp_main.pbo"
BIKEY=".hemttout/release/keys/${AUTHORITY}.bikey"
BISIGN="${PBO}.${AUTHORITY}.bisign"

if [[ ! -f "${PBO}" ]]; then
  echo "Missing signed release PBO: ${PBO}" >&2
  exit 1
fi

if [[ ! -f "${BISIGN}" ]]; then
  echo "Missing release signature: ${BISIGN}" >&2
  exit 1
fi

if [[ ! -f "${BIKEY}" ]]; then
  echo "Missing public BI key: ${BIKEY}" >&2
  exit 1
fi

hemtt utils verify "${PBO}" "${BIKEY}"
