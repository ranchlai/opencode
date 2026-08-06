#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
cd "$root"

cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
models_json="${MODELS_DEV_API_JSON:-$cache_dir/models.json}"
tmpdir="${TMPDIR:-/tmp}"
fetched="$tmpdir/opencode-models-api.json"

fetch_models() {
  if [[ -n "${MODELS_DEV_API_JSON:-}" && -f "$MODELS_DEV_API_JSON" ]]; then
    echo "==> using MODELS_DEV_API_JSON=$MODELS_DEV_API_JSON"
    return 0
  fi

  echo "==> fetching models.dev/api.json"
  if curl -fsSL --max-time 30 https://models.dev/api.json -o "$fetched" \
    && [[ -s "$fetched" ]]; then
    mkdir -p "$cache_dir"
    cp "$fetched" "$models_json"
    export MODELS_DEV_API_JSON="$models_json"
    echo "==> saved $models_json"
    return 0
  fi

  if [[ -s "$models_json" ]]; then
    echo "==> models.dev fetch failed; using cached $models_json"
    export MODELS_DEV_API_JSON="$models_json"
    return 0
  fi

  echo "error: could not fetch https://models.dev/api.json and no cache at $models_json" >&2
  echo "hint: download api.json on a working network, then:" >&2
  echo "  MODELS_DEV_API_JSON=/path/to/api.json ./build.sh" >&2
  return 1
}

echo "==> installing dependencies"
bun install

fetch_models

echo "==> building binaries${*:+ ($*)}"
./packages/opencode/script/build.ts "$@"

echo "==> done"
echo "binaries in: $root/packages/opencode/dist"
ls -1 packages/opencode/dist
