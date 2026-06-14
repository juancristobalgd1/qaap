// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import {
    buildVerifyRunCommand,
    type QaapVerifyCheckKind,
    type QaapVerifyPackageManager,
    resolveVerifyCheckFromScripts,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-verify-checks';

export interface QaapResolvedAgentVerifyCheck {
    readonly label: string;
    readonly command: string;
}

interface PackageJsonShape {
    scripts?: Record<string, unknown>;
    packageManager?: unknown;
}

const LOCKFILE_TO_PM: ReadonlyArray<readonly [string, QaapVerifyPackageManager]> = [
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
];

const VERIFY_KIND_LABEL: Record<QaapVerifyCheckKind, string> = {
    build: 'Build',
    test: 'Test',
    typecheck: 'Typecheck',
    lint: 'Lint',
};

function detectVerifyPackageManager(cwd: string): QaapVerifyPackageManager {
    for (const [fileName, pm] of LOCKFILE_TO_PM) {
        if (fs.existsSync(path.join(cwd, fileName))) {
            return pm;
        }
    }
    return 'npm';
}

function readPackageJsonScripts(cwd: string): Record<string, unknown> | undefined {
    const packageJsonPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return undefined;
    }
    try {
        const raw = fs.readFileSync(packageJsonPath, 'utf8');
        const parsed = JSON.parse(raw) as PackageJsonShape;
        return parsed.scripts;
    } catch {
        return undefined;
    }
}

/** Resolves verify shell commands for a workspace cwd (VPS backend — no FileService). */
export function resolveAgentVerifyChecksForCwd(cwd: string): QaapResolvedAgentVerifyCheck[] {
    const scripts = readPackageJsonScripts(cwd);
    if (!scripts) {
        return [];
    }
    const packageManager = detectVerifyPackageManager(cwd);
    const resolved = resolveVerifyCheckFromScripts(
        scripts,
        script => buildVerifyRunCommand(script, packageManager),
    );
    if (!resolved) {
        return [];
    }
    return [{
        label: VERIFY_KIND_LABEL[resolved.kind],
        command: resolved.command,
    }];
}

export function tailVerifyLog(log: string | undefined, lines = 12): string {
    if (!log) {
        return '';
    }
    return log.trimEnd().split('\n').slice(-lines).join('\n');
}
