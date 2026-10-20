// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type URI from '@theia/core/lib/common/uri';

/** Build phases tracked by {@link QaapProjectBootstrapService}. */
export type QaapBootstrapPhase =
    | 'idle'
    | 'detected'
    | 'installing'
    | 'install-failed'
    | 'ready-to-run'
    | 'starting'
    | 'running'
    | 'run-failed'
    | 'dismissed';

/** Readiness inside a dev-server launch; kept separate from the durable bootstrap phase. */
export type QaapPreviewReadiness = 'starting' | 'waiting-for-server' | 'transport-ready' | 'failed';

/** Package manager understood by the detector. */
export type QaapPackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'native';

/** Likely framework guess (used for UI labels and port hints). */
export type QaapProjectKind =
    | 'node-vite'
    | 'node-next'
    | 'node-cra'
    | 'node-astro'
    | 'node-remix'
    | 'node-svelte'
    | 'node-nuxt'
    | 'node-generic'
    | 'python-django'
    | 'python-fastapi'
    | 'python-flask'
    | 'python-generic'
    | 'go'
    | 'rust'
    | 'dotnet'
    | 'php'
    | 'custom'
    | 'static'
    | 'unknown';

/** Sub-package inside a monorepo with its own runnable dev script. */
export interface QaapMonorepoAppCandidate {
    /** Folder of the app (where `package.json` lives). */
    readonly rootUri: URI;
    /** Relative path from the workspace root, e.g. `apps/web`. */
    readonly relativePath: string;
    /** Resolved name (from `package.json.name` or folder name). */
    readonly name: string;
    /** Best-guess framework. */
    readonly kind: QaapProjectKind;
    /** Concrete dev command (`pnpm run dev`, …). Cwd is the app's `rootUri`. */
    readonly devCommand: string;
    /** Same as {@link devCommand}, surfaced separately so the banner can show it monospace. */
    readonly devCommandLabel: string;
    /** Default port hint for this framework, used when stdout parsing fails. */
    readonly expectedPort?: number;
    /**
     * `node_modules/.bin` executable the dev script starts with (`theia`, `vite`, …). Set for members
     * of a package-manager workspace, whose bins are hoisted to the workspace root.
     */
    readonly devScriptBinary?: string;
    /**
     * Script chained before the preview script in {@link devCommand} (`npm run build && npm run
     * start`). Only set when the project opted in with `"build": "auto"` in `.qaap/preview.json`.
     */
    readonly buildScript?: string;
    /**
     * With {@link buildScript}: the start half of {@link devCommand} alone. Port-conflict recovery
     * relaunches only this, since the server could only bind after `build &&` exited 0.
     */
    readonly previewStartCommand?: string;
    /** The preview script runs build output that does not exist and no build is chained (fail fast). */
    readonly buildRequired?: boolean;
    /** The missing output folder behind {@link buildRequired}; a manual build creates it. */
    readonly buildOutputUri?: URI;
    /**
     * The package's declared build chained before its preview script, run only when the user picks
     * "Build and start" after a `build-required` failure. Never run implicitly or retried.
     */
    readonly buildAndStartCommand?: string;
}

/** Build state shared by monorepo apps and a workspace member opened directly. */
export type QaapPreviewBuildTarget = Pick<QaapMonorepoAppCandidate,
    'buildScript' | 'previewStartCommand' | 'buildRequired' | 'buildOutputUri' | 'buildAndStartCommand'>;

/**
 * The package whose dev command Preview runs: the selected app, the only app, or the project
 * itself (same choice as the dev plan).
 */
export function resolveQaapPreviewBuildTarget(
    descriptor: QaapProjectDescriptor | undefined,
    selectedApp: QaapMonorepoAppCandidate | undefined,
): QaapPreviewBuildTarget | undefined {
    if (!descriptor) {
        return undefined;
    }
    return selectedApp ?? (descriptor.apps?.length === 1 ? descriptor.apps[0] : undefined) ?? descriptor;
}

/** Default HTTP port for `@theia/*` example apps (`theia start`). */
export const QAAP_THEIA_DEV_PORT = 3000;

/** Default port the inline static server binds to for `kind: 'static'` projects (no `package.json`). */
export const QAAP_STATIC_DEV_PORT = 8080;

/**
 * Layout hint inferred from the lockfile / config files. We only need the marker presence at this
 * level — the detector enumerates the actual sub-packages separately.
 */
export type QaapMonorepoFlavor =
    | 'pnpm-workspace'
    | 'npm-workspaces'
    | 'yarn-workspaces'
    | 'turborepo'
    | 'nx'
    | 'lerna'
    | 'implicit';

/** Result of a single workspace-root inspection. */
export interface QaapProjectDescriptor {
    /** Root URI used for the inspection. */
    readonly rootUri: URI;
    /** Cwd of the launch plan when it differs from the inspected workspace root. */
    readonly previewRootUri?: URI;
    /** Human-readable workspace name, e.g. `qaap-store-web`. */
    readonly name: string;
    /** Best-guess project kind. */
    readonly kind: QaapProjectKind;
    /** Package manager to use (driven by lockfile, falls back to `npm`). */
    readonly packageManager: QaapPackageManager;
    /** `${packageManager} install` (or equivalent). */
    readonly installCommand: string;
    /** Dev script the user is asked to run, or `undefined` if none was confidently detected. */
    readonly devCommand?: string;
    /** Pretty label for the dev script, e.g. `npm run dev`. */
    readonly devCommandLabel?: string;
    /** Optional hint to seed port detection if stdout parsing fails. */
    readonly expectedPort?: number;
    /** True when dev tooling shims exist under `node_modules/.bin` (not just an empty tree). */
    readonly nodeModulesPresent: boolean;
    /** Workspace layout flavor, when the project is a monorepo. */
    readonly monorepoFlavor?: QaapMonorepoFlavor;
    /** Sub-apps with a runnable dev script, empty unless the project is a monorepo. */
    readonly apps: QaapMonorepoAppCandidate[];
    /**
     * Package-manager workspace root that owns `node_modules` (npm/yarn/pnpm/bun workspaces, Lerna,
     * Turborepo, Nx). Install runs there, never inside a member. Equal to {@link rootUri} for a
     * monorepo opened at its root; an ancestor when the inspected folder is itself a member.
     */
    readonly workspaceRootUri?: URI;
    /**
     * When preview/install targets a child folder (e.g. `create-vite` scaffold) while the workspace
     * root has no `package.json`, the relative path from the workspace root to that app.
     */
    readonly scaffoldRelativePath?: string;
    /** {@link QaapMonorepoAppCandidate.devScriptBinary} for a workspace member opened directly. */
    readonly devScriptBinary?: string;
    /** {@link QaapMonorepoAppCandidate.buildScript} for a workspace member opened directly. */
    readonly buildScript?: string;
    /** {@link QaapMonorepoAppCandidate.previewStartCommand} for a workspace member opened directly. */
    readonly previewStartCommand?: string;
    /** {@link QaapMonorepoAppCandidate.buildAndStartCommand} for a workspace member opened directly. */
    readonly buildAndStartCommand?: string;
    /** {@link QaapMonorepoAppCandidate.buildRequired} for a workspace member opened directly. */
    readonly buildRequired?: boolean;
    /** {@link QaapMonorepoAppCandidate.buildOutputUri} for a workspace member opened directly. */
    readonly buildOutputUri?: URI;
}

/** True when a managed preview stop closed the dev terminal on purpose. */
export function isQaapUserCancelledPreviewError(error?: string): boolean {
    if (!error) {
        return false;
    }
    return /dev server tab closed/i.test(error)
        || /preview stopped/i.test(error)
        || /vista previa detenida/i.test(error);
}

/** Distinguishes install failures (build) from a failed preview/dev-server start. */
export function qaapBootstrapFailureKind(
    phase: QaapBootstrapPhase,
    error?: string,
): 'cancelled' | 'install' | 'preview' | undefined {
    if (phase !== 'install-failed' && phase !== 'run-failed') {
        return undefined;
    }
    if (isQaapUserCancelledPreviewError(error)) {
        return 'cancelled';
    }
    return phase === 'install-failed' ? 'install' : 'preview';
}

/**
 * A port observed in the dev-server stdout. We keep one entry per port (deduped by port number,
 * since `localhost` / `127.0.0.1` / `0.0.0.0` are equivalent endpoints), tagged with metadata that
 * the UI uses to render the strip and decide which pill is "active".
 */
export interface QaapForwardedPort {
    /** Numeric port (`3000`, `8080`, …). Used as the dedup key. */
    readonly port: number;
    /** The full URL as printed by the dev server, with the chosen host preserved. */
    readonly url: string;
    /** First time we saw this port, used to keep the strip sorted by appearance order. */
    readonly firstSeenAt: number;
    /** True when this port currently has an open mini-browser tab. */
    readonly previewOpen: boolean;
    /** Set on the entry the bootstrap auto-opened as the "main" preview. */
    readonly primary: boolean;
}
