#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
    echo "This script is only supported on Linux." >&2
    exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BINARY="${ROOT_DIR}/dist/diode"
TARGET_DIR="${HOME}/.dotfiles.scripts"
TARGET_BINARY="${TARGET_DIR}/diode"

echo "> Building SEA binary"
cd "${ROOT_DIR}"
npm run build:sea

if [[ ! -f "${SOURCE_BINARY}" ]]; then
    echo "Binary not found: ${SOURCE_BINARY}" >&2
    exit 1
fi

echo "> Installing binary to ${TARGET_BINARY}"
mkdir -p "${TARGET_DIR}"
install -m 0755 "${SOURCE_BINARY}" "${TARGET_BINARY}"

echo "Done: ${TARGET_BINARY}"
