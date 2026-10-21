#!/bin/bash
set -euo pipefail

INPUT="$(cat)"

TOOL_NAME="$(echo "$INPUT" | jq -r '.toolName // empty')"

# React only to file-editing tools
case "$TOOL_NAME" in
  edit_file|create_file|apply_diff|write_file|replace_string_in_file|create_and_apply_diff)
    ;;
  *)
    exit 0
    ;;
esac

TOOL_ARGS_RAW="$(echo "$INPUT" | jq -r '.toolArgs // empty')"

# Try to extract the file path from the arguments
FILE_PATH="$(echo "$TOOL_ARGS_RAW" | jq -r '.filePath // .path // .file // empty' 2>/dev/null || true)"

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Run eslint --fix only on .ts/.tsx files
if [[ "$FILE_PATH" == *.ts || "$FILE_PATH" == *.tsx ]]; then
  npx eslint --fix "$FILE_PATH" 2>/dev/null || true
fi
