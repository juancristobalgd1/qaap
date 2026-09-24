// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type QaapVerifyCheckKind = 'build' | 'test' | 'typecheck' | 'lint';

export interface QaapResolvedVerifyCheck {
    readonly kind: QaapVerifyCheckKind;
    readonly script: string;
    readonly command: string;
}

/** Scripts picked for agent transcript verification, in priority order. */
const VERIFY_SCRIPT_PRIORITY: ReadonlyArray<readonly [string, QaapVerifyCheckKind]> = [
    ['compile', 'build'],
    ['build', 'build'],
    ['test', 'test'],
    ['typecheck', 'typecheck'],
    ['lint', 'lint'],
];

/**
 * True when the package.json declares npm/yarn/pnpm/bun workspaces — i.e. a monorepo root whose
 * `build`/`test` scripts fan out to every package. Auto-verify skips these: a whole-monorepo build
 * after each turn is slow and fails on packages the agent never touched (a pre-existing failure the
 * agent then wrongly tries to "fix"). A pnpm/lerna monorepo is also detected via its workspace file
 * (see the resolver).
 */
export function packageJsonDeclaresWorkspaces(packageJson: unknown): boolean {
    if (!packageJson || typeof packageJson !== 'object') {
        return false;
    }
    const workspaces = (packageJson as { workspaces?: unknown }).workspaces;
    if (Array.isArray(workspaces)) {
        return workspaces.length > 0;
    }
    if (workspaces && typeof workspaces === 'object') {
        const packages = (workspaces as { packages?: unknown }).packages;
        return Array.isArray(packages) && packages.length > 0;
    }
    return false;
}

export function buildVerifyRunCommand(script: string, packageManager: QaapVerifyPackageManager = 'npm'): string {
    switch (packageManager) {
        case 'pnpm':
            return `pnpm run ${script}`;
        case 'yarn':
            return `yarn ${script}`;
        case 'bun':
            return `bun run ${script}`;
        default:
            return `npm run ${script}`;
    }
}

export type QaapVerifyPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type QaapVerifyWorkspaceFlavor = 'lerna' | 'pnpm' | 'npm';

export interface QaapLeafVerifyPackage {
    readonly name: string;
    readonly script: string;
    readonly kind: QaapVerifyCheckKind;
}

/** Scoped run so a monorepo root does not fan out to every package. */
export function buildScopedVerifyRunCommand(
    script: string,
    packageName: string,
    flavor: QaapVerifyWorkspaceFlavor,
): string {
    switch (flavor) {
        case 'lerna':
            return `npx lerna run ${script} --scope ${packageName}`;
        case 'pnpm':
            return `pnpm --filter ${packageName} run ${script}`;
        default:
            return `npm run ${script} --workspace ${packageName}`;
    }
}

/**
 * Prefer product `@theia/qaap-*` leaf packages, then the first compile-capable leaf.
 * Caps at two scopes so verify stays fast after a turn.
 */
export function pickMonorepoVerifyTargets(
    packages: readonly QaapLeafVerifyPackage[],
    max = 2,
): QaapLeafVerifyPackage[] {
    if (packages.length === 0) {
        return [];
    }
    const qaap = packages.filter(entry => entry.name.startsWith('@theia/qaap-'));
    const pool = qaap.length > 0 ? qaap : packages;
    const compileFirst = [...pool].sort((left, right) => {
        const leftCompile = left.script === 'compile' || left.kind === 'build' ? 0 : 1;
        const rightCompile = right.script === 'compile' || right.kind === 'build' ? 0 : 1;
        return leftCompile - rightCompile || left.name.localeCompare(right.name);
    });
    return compileFirst.slice(0, Math.max(1, max));
}

/** Picks the first runnable npm script for post-turn verification. */
export function resolveVerifyCheckFromScripts(
    scripts: Record<string, unknown> | undefined,
    buildRunCommand: (script: string) => string = script => buildVerifyRunCommand(script),
): QaapResolvedVerifyCheck | undefined {
    if (!scripts || typeof scripts !== 'object') {
        return undefined;
    }
    for (const [script, kind] of VERIFY_SCRIPT_PRIORITY) {
        const value = scripts[script];
        if (typeof value === 'string' && value.trim().length > 0) {
            return {
                kind,
                script,
                command: buildRunCommand(script),
            };
        }
    }
    return undefined;
}
