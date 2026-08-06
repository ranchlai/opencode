#!/usr/bin/env bash
set -euo pipefail

# Builds the macOS desktop installer for OpenCode.
#
# What it does (per architecture):
#   1. Installs monorepo deps (bun install) unless --skip-deps.
#   2. Cross-compiles the opencode CLI sidecar for macOS (x64 or arm64).
#   3. Stages the sidecar into packages/desktop-electron/resources/opencode-cli.
#   4. Bundles the Electron renderer/main/preload via electron-vite.
#   5. Runs electron-builder --mac to produce a .dmg installer.
#
# Because the opencode CLI is architecture-specific and the electron app ships
# a single opencode-cli per installer, we run the build once per arch.
#
# Usage:
#   ./script/build-mac.sh                 # default: prod channel, arm64 only
#   ./script/build-mac.sh --x64           # build x64 only
#   ./script/build-mac.sh --all           # build both x64 and arm64
#   CHANNEL=beta ./script/build-mac.sh    # beta channel
#   ./script/build-mac.sh --skip-deps     # skip bun install
#
# Outputs:
#   packages/desktop-electron/dist/opencode-electron-macos-<arch>.dmg
#
# Requirements:
#   - bun >= 1.3 (https://bun.sh)
#   - node >= 22 (electron-vite requires it; install via nvm/fnm/n)
#   - electron-builder pulls macOS tooling on first run

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

targets=("arm64")
skip_deps=0
channel="${CHANNEL:-prod}"
models_json="${MODELS_DEV_API_JSON:-$HOME/.cache/opencode/models.json}"
export MODELS_DEV_API_JSON="$models_json"

if [ ! -f "$models_json" ]; then
  echo "error: models.json not found at $models_json" >&2
  echo "hint: run ./build.sh first to cache models.dev/api.json" >&2
  exit 1
fi

while (($#)); do
  case "$1" in
    --arm64)
      targets=("arm64")
      ;;
    --x64)
      targets=("x64")
      ;;
    --all)
      targets=("x64" "arm64")
      ;;
    --skip-deps)
      skip_deps=1
      ;;
    --help|-h)
      sed -n '2,32p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun not found on PATH. Install from https://bun.sh" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found on PATH. Install Node >= 22." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${node_major}" -lt 22 ]; then
  echo "error: Node >= 22 required (found $(node --version)). electron-vite/Vite 7 need it." >&2
  echo "hint: use nvm/fnm/n to switch (e.g. 'fnm install 22 && fnm use 22')." >&2
  exit 1
fi

export OPENCODE_CHANNEL="${channel}"

if [ "${skip_deps}" -eq 0 ]; then
  echo "==> bun install"
  bun install
fi

desktop_dir="${root}/packages/desktop-electron"
opencode_dir="${root}/packages/opencode"

bin_name_for() {
  case "$1" in
    x64)   echo "opencode-darwin-x64" ;;
    arm64) echo "opencode-darwin-arm64" ;;
    *)
      echo "error: unsupported arch $1" >&2
      exit 2
      ;;
  esac
}

filter_for() {
  case "$1" in
    x64)   echo "darwin-x64" ;;
    arm64) echo "darwin-arm64" ;;
  esac
}

builder_arch_for() {
  case "$1" in
    x64)   echo "--x64" ;;
    arm64) echo "--arm64" ;;
  esac
}

for arch in "${targets[@]}"; do
  bin="$(bin_name_for "$arch")"
  filter="$(filter_for "$arch")"
  barch="$(builder_arch_for "$arch")"

  echo
  echo "=========================================="
  echo "  macOS ${arch}"
  echo "=========================================="

  echo "==> staging icons (channel=${channel})"
  cd "${desktop_dir}"
  bun ./scripts/copy-icons.ts "${channel}"

  echo "==> building opencode CLI sidecar (${bin})"
  cd "${opencode_dir}"
  ./script/build.ts "${filter}"

  echo "==> copying sidecar into desktop-electron/resources"
  src="${opencode_dir}/dist/${bin}/bin/opencode"
  if [ ! -f "${src}" ]; then
    echo "error: expected sidecar at ${src}" >&2
    exit 1
  fi
  mkdir -p "${desktop_dir}/resources"
  cp "${src}" "${desktop_dir}/resources/opencode-cli"
  echo "    copied ${src} -> ${desktop_dir}/resources/opencode-cli"

  echo "==> electron-vite build"
  cd "${desktop_dir}"
  bun run build

  echo "==> electron-builder --mac ${barch}"
  cd "${desktop_dir}"
  npx electron-builder --mac "${barch}" --config electron-builder.config.ts --publish never
done

echo
echo "==> done"
echo "Installers:"
ls -1 "${desktop_dir}/dist"/*.dmg 2>/dev/null || true