// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

export interface QaapPackagedRuntimeContext {
    /** `app.isPackaged`. A development run keeps what `scripts/qaap-start-electron.mjs` already sets. */
    readonly isPackaged: boolean;
    /** `process.resourcesPath`: where `extraResources` (the bundled plugins) live in an installed build. */
    readonly resourcesPath: string;
    /** `process.env`; a variable that is already set always wins. */
    readonly env: NodeJS.ProcessEnv;
    /** Existence probe, injectable for tests. */
    readonly directoryExists?: (directory: string) => boolean;
}

/** Folder of the installer's resources that holds the bundled VS Code extensions (see `electron-builder.yml`). */
export const QAAP_PACKAGED_PLUGINS_FOLDER = 'plugins';

/**
 * Environment an installed desktop build needs that the dev launcher (`scripts/qaap-start-electron.mjs`)
 * sets from the outside. Returns only the variables to add:
 * - `QAAP_DESKTOP=1`: the local desktop runtime (GitHub device flow, harness launch overrides).
 * - `QAAP_SKIP_AUTH=1`: the same single-user local mode as the dev run; the backend listens on loopback only
 *   and accepts the app window's token cookie, so there is no sign-in gate.
 * - `THEIA_DEFAULT_PLUGINS=local-dir:<resources>/plugins`: the bundled extensions (the dev run passes
 *   `--plugins=local-dir:../../plugins`).
 * No secret is involved. Nothing is added to a development run.
 */
export function resolveQaapPackagedRuntimeEnvironment(context: QaapPackagedRuntimeContext): Record<string, string> {
    if (!context.isPackaged) {
        return {};
    }
    const directoryExists = context.directoryExists ?? (directory => fs.existsSync(directory) && fs.statSync(directory).isDirectory());
    const additions: Record<string, string> = {};
    if (!context.env.QAAP_DESKTOP) {
        additions.QAAP_DESKTOP = '1';
    }
    if (!context.env.QAAP_SKIP_AUTH) {
        additions.QAAP_SKIP_AUTH = '1';
    }
    const pluginsDirectory = path.join(context.resourcesPath, QAAP_PACKAGED_PLUGINS_FOLDER);
    if (!context.env.THEIA_DEFAULT_PLUGINS && directoryExists(pluginsDirectory)) {
        additions.THEIA_DEFAULT_PLUGINS = `local-dir:${pluginsDirectory}`;
    }
    return additions;
}

/** Applies {@link resolveQaapPackagedRuntimeEnvironment} to the live process, before the backend is forked. */
export function applyQaapPackagedRuntimeEnvironment(context: QaapPackagedRuntimeContext & { readonly env: NodeJS.ProcessEnv }): void {
    Object.assign(context.env, resolveQaapPackagedRuntimeEnvironment(context));
}
