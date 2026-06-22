// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Minimal shape for install/dev cwd resolution (orphan scaffolds vs workspace root). */
export interface QaapBootstrapInstallTarget {
    readonly rootKey: string;
    readonly devCommand?: string;
    readonly installCommand: string;
    readonly expectedPort?: number;
    readonly kind?: string;
}

export interface QaapBootstrapAppTarget {
    readonly rootKey: string;
    readonly devCommand: string;
}

/** Human-readable hint when preview cannot run because the workspace root has no manifest. */
export function formatMissingBootstrapProjectHint(candidatePaths: readonly string[]): string | undefined {
    if (candidatePaths.length === 0) {
        return 'Run/preview failed: no package.json in the workspace root and no runnable child project was found. '
            + 'Scaffold the app in the workspace root or in a subfolder with a dev script.';
    }
    if (candidatePaths.length === 1) {
        return `Run/preview failed: no package.json in the workspace root. `
            + `App detected in ${candidatePaths[0]}/ — Qaap preview targets that folder automatically.`;
    }
    return `Run/preview failed: no package.json in the workspace root. Runnable apps detected in: ${candidatePaths.join(', ')}. `
        + 'Pick one as the preview target.';
}

/** Timeline copy when a scaffolded app lives in a child folder instead of the workspace root. */
export function formatBootstrapScaffoldDetectedNotice(relativePath: string): string {
    return `App created in ${relativePath}/. Qaap runs install and preview from that folder, not the workspace root.`;
}

/** Orphan scaffolds install inside the child app folder; monorepos with a root manifest install at root. */
export function resolveBootstrapInstallTarget(
    descriptor: QaapBootstrapInstallTarget,
    selectedApp: QaapBootstrapAppTarget | undefined,
    fallbackApp: QaapBootstrapAppTarget | undefined,
): { readonly cwdKey: string; readonly command: string } {
    const targetApp = selectedApp ?? fallbackApp;
    if (targetApp && !descriptor.devCommand) {
        return { cwdKey: targetApp.rootKey, command: descriptor.installCommand };
    }
    return { cwdKey: descriptor.rootKey, command: descriptor.installCommand };
}

/** Dev server cwd/command — orphan apps run from their folder; pnpm filters stay at workspace root. */
export function resolveBootstrapDevTarget(
    descriptor: QaapBootstrapInstallTarget & { readonly packageManager: string },
    selectedApp: QaapBootstrapAppTarget & { readonly expectedPort?: number; readonly kind: string } | undefined,
    fallbackApp: (QaapBootstrapAppTarget & { readonly expectedPort?: number; readonly kind: string }) | undefined,
): { readonly cwdKey: string; readonly command: string; readonly expectedPort?: number; readonly kind: string } | undefined {
    const app = selectedApp ?? fallbackApp;
    if (app) {
        const cwdKey = descriptor.packageManager === 'pnpm' && descriptor.devCommand
            ? descriptor.rootKey
            : app.rootKey;
        return { cwdKey, command: app.devCommand, expectedPort: app.expectedPort, kind: app.kind };
    }
    if (descriptor.devCommand) {
        return {
            cwdKey: descriptor.rootKey,
            command: descriptor.devCommand,
            expectedPort: descriptor.expectedPort,
            kind: descriptor.kind ?? 'node-generic',
        };
    }
    return undefined;
}

export function enrichBootstrapDevRunError(message: string, previewRoot?: string): string {
    if (!previewRoot) {
        return message;
    }
    if (/package\.json|ENOENT|no such file|cannot find module/i.test(message)) {
        return `${message} Suggested fix: run preview from ${previewRoot}/ (not the workspace root).`;
    }
    return `${message} Preview root: ${previewRoot}/.`;
}
