# OpenCode Desktop (Electron)

Native OpenCode desktop app, built with Electron + electron-builder.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/desktop-electron dev
```

This starts the Electron dev session (Vite dev server + Electron shell).

## Build

To create a production `dist/` and package the Electron app:

```bash
bun run --cwd packages/desktop-electron build
bun run --cwd packages/desktop-electron package         # current host platform
bun run --cwd packages/desktop-electron package:mac     # macOS (dmg + zip)
bun run --cwd packages/desktop-electron package:win     # Windows (nsis + portable)
bun run --cwd packages/desktop-electron package:linux   # Linux (AppImage + deb + rpm)
```

### One-shot Windows packages

`script/build-windows.sh` automates a full Windows build from any host. It
cross-compiles the opencode CLI sidecar with Bun, then packages the Electron
app via electron-builder (NSIS installer + portable exe).

```bash
./script/build-windows.sh             # x64 packages (prod channel)
./script/build-windows.sh --arm64     # arm64 packages
./script/build-windows.sh --all       # both architectures
CHANNEL=beta ./script/build-windows.sh
./script/build-windows.sh --skip-deps # reuse existing node_modules
```

Outputs:

- `packages/desktop-electron/dist/opencode-electron-windows-<arch>.exe` — NSIS installer
- `packages/desktop-electron/dist/opencode-electron-windows-<arch>-portable.exe` — portable (no install)

Requires:

- `bun >= 1.3`
- `node >= 22` (electron-vite / Vite 7 — use `fnm`/`nvm`/`n` to switch)
- Internet access (first run downloads the Bun Windows runtime + electron-builder tooling)

## Prerequisites

Building the Electron app requires Bun and a recent Node.js. For native
modules used at runtime (only on macOS, via the `native/` directory), see
the [electron-builder docs](https://www.electron.build/).
