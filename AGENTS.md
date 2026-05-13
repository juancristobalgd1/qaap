# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Eclipse Theia is a TypeScript monorepo (Lerna + npm workspaces) that produces a browser-based IDE and an Electron desktop IDE. The primary development target for cloud agents is the **browser example** at `examples/browser`.

### Quick reference

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Build browser app | `npm run build:browser` |
| Start browser app | `npm run start:browser` (serves at `http://localhost:3000`) |
| Compile only (TS) | `npm run compile` |
| Lint | `npm run lint` |
| Lint fix | `npm run lint:fix` |
| Test all packages | `npm run test:theia` |
| Test single package | `npx lerna run test --scope @theia/package-name` |
| Test single file | `npx mocha ./packages/core/lib/browser/some-file.spec.js` |

### Important caveats

- **`NODE_OPTIONS=--max_old_space_size=4096`** is recommended for builds; without it, the TypeScript compilation or webpack bundling may OOM.
- **`npm run compile` alone is not enough for UI testing** — you must run `npm run build:browser` which compiles TS AND bundles via webpack.
- The `preinstall` hook runs `node-gyp install` and `postinstall` runs `theia-patch`, `compute-references`, and lerna `afterInstall` hooks. These execute automatically during `npm install`.
- Native modules (`node-pty`, `@parcel/watcher`, `drivelist`, `@vscode/ripgrep`) require `build-essential`, `libx11-dev`, `libxkbfile-dev`, and `libsecret-1-dev` on Debian/Ubuntu. These are pre-installed on the Cloud Agent VM.
- There is a pre-existing lint error in `@theia/application-manager` (2 quote-style violations in `frontend-generator.ts`). This is not caused by your changes.
- **Plugin download** (`npm run download:plugins`) downloads VS Code extensions from Open VSX. This is optional — the IDE runs without plugins but lacks language support. It requires network access and a `GITHUB_TOKEN` for `vscode-ripgrep`.
- The backend server logs plugin warnings about missing directories (`~/.theia/plugins`, `~/.theia/deployedPlugins`, `../../plugins`). These are expected when no plugins are downloaded and do not affect functionality.
- Hot reload: Use `npm run watch:browser` for incremental TS compilation + webpack watch. Backend changes require restarting the server process.
