// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Monorepo workspace roots for preview bootstrap.
 *
 * A package inside an npm/yarn/pnpm/bun workspace (Lerna and Turborepo sit on top of those) has
 * no complete dependency tree of its own: install hoists every dependency and every bin into the
 * workspace root's `node_modules`. Install must therefore run at the workspace root, and the
 * member's scripts must run with the root's `node_modules/.bin` reachable. These helpers are pure
 * (paths are POSIX strings) so the detector can feed them from any file system.
 */

/** Package managers whose workspace commands Qaap knows how to build. */
export type QaapWorkspacePackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** Workspace configuration found in one directory. */
export interface QaapWorkspaceManifests {
    /** Parsed `package.json`, when present. */
    readonly packageJson?: { readonly workspaces?: unknown };
    /** `packages` globs of `pnpm-workspace.yaml`, when present. */
    readonly pnpmPackages?: readonly string[];
    /** Parsed `lerna.json`, when present. */
    readonly lernaJson?: { readonly packages?: unknown };
}

/** The workspace root that owns a package. */
export interface QaapWorkspaceRootMatch {
    /** Directory of the workspace root. */
    readonly rootDir: string;
    /** Package directory relative to {@link rootDir}, e.g. `examples/browser`. */
    readonly relativePath: string;
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Member globs declared by a directory's workspace configuration, in the order the package
 * managers honour them: `pnpm-workspace.yaml`, then `package.json` `workspaces` (array or yarn's
 * `{ packages }`), then `lerna.json` `packages`. Negated globs are dropped.
 */
export function workspaceMemberPatterns(manifests: QaapWorkspaceManifests): string[] {
    const fromField = (workspaces: unknown): string[] => Array.isArray(workspaces)
        ? stringArray(workspaces)
        : workspaces && typeof workspaces === 'object'
            ? stringArray((workspaces as { packages?: unknown }).packages)
            : [];
    const patterns = manifests.pnpmPackages?.length
        ? [...manifests.pnpmPackages]
        : fromField(manifests.packageJson?.workspaces);
    const all = patterns.length > 0 ? patterns : stringArray(manifests.lernaJson?.packages);
    if (all.length === 0 && manifests.lernaJson) {
        // Lerna without `packages` defaults to packages/*.
        all.push('packages/*');
    }
    return all
        .map(pattern => pattern.trim().replace(/^\.\//, '').replace(/\/+$/, ''))
        .filter(pattern => pattern.length > 0 && !pattern.startsWith('!'));
}

/** Whether a root-relative package path matches a workspace glob (`*` one segment, `**` any). */
export function workspaceGlobMatches(relativePath: string, pattern: string): boolean {
    const pathSegments = relativePath.split('/').filter(segment => segment.length > 0);
    const patternSegments = pattern.split('/').filter(segment => segment.length > 0 && segment !== '.');
    const segmentMatches = (segment: string, glob: string): boolean => {
        const source = glob.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
        return new RegExp(`^${source}$`).test(segment);
    };
    const match = (p: number, g: number): boolean => {
        if (g === patternSegments.length) {
            return p === pathSegments.length;
        }
        if (patternSegments[g] === '**') {
            for (let next = p; next <= pathSegments.length; next++) {
                if (match(next, g + 1)) {
                    return true;
                }
            }
            return false;
        }
        return p < pathSegments.length && segmentMatches(pathSegments[p], patternSegments[g]) && match(p + 1, g + 1);
    };
    return match(0, 0);
}

function parentDir(dir: string): string | undefined {
    const trimmed = dir.length > 1 ? dir.replace(/\/+$/, '') : dir;
    const index = trimmed.lastIndexOf('/');
    if (index < 0 || trimmed === '/') {
        return undefined;
    }
    return index === 0 ? '/' : trimmed.slice(0, index);
}

function relativeTo(rootDir: string, dir: string): string {
    const prefix = rootDir.endsWith('/') ? rootDir : `${rootDir}/`;
    return dir.startsWith(prefix) ? dir.slice(prefix.length).replace(/\/+$/, '') : dir;
}

/**
 * The nearest ancestor of `packageDir` whose workspace configuration lists `packageDir` as a
 * member, or `undefined` for a standalone package.
 *
 * The walk is bounded: it stops after `maxDepth` levels and at the first directory `isBoundary`
 * reports (the git checkout root), so a clone never adopts a workspace that merely encloses it.
 */
export async function findQaapWorkspaceRoot(
    packageDir: string,
    readManifests: (dir: string) => Promise<QaapWorkspaceManifests | undefined>,
    options: { readonly maxDepth?: number; readonly isBoundary?: (dir: string) => Promise<boolean> } = {},
): Promise<QaapWorkspaceRootMatch | undefined> {
    const maxDepth = options.maxDepth ?? 4;
    if (options.isBoundary && await options.isBoundary(packageDir)) {
        return undefined;
    }
    let dir = parentDir(packageDir);
    for (let depth = 0; dir !== undefined && depth < maxDepth; depth++) {
        const manifests = await readManifests(dir);
        if (manifests) {
            const relativePath = relativeTo(dir, packageDir);
            if (workspaceMemberPatterns(manifests).some(pattern => workspaceGlobMatches(relativePath, pattern))) {
                return { rootDir: dir, relativePath };
            }
        }
        if (options.isBoundary && await options.isBoundary(dir)) {
            return undefined;
        }
        dir = parentDir(dir);
    }
    return undefined;
}

/** Commands that are never workspace bins: package managers, runtimes and shell builtins. */
const NON_BIN_COMMANDS = new Set([
    'npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'node', 'deno', 'corepack',
    'cd', 'echo', 'exit', 'true', 'false', 'test', 'exec', 'sh', 'bash', 'export', 'set',
]);

/** Wrappers that run the next word as the real command. */
const COMMAND_WRAPPERS = new Set(['cross-env', 'env', 'dotenv', 'nodemon']);

/**
 * The `node_modules/.bin` executable a package script starts with (`theia` for
 * `theia start --plugins=…`, `vite` for `cross-env FOO=1 vite`), or `undefined` when the script
 * starts with a package manager, a runtime, a shell builtin or a path.
 */
export function extractScriptBinary(script: string): string | undefined {
    const firstCommand = script.split(/&&|\|\||;|\|/)[0] ?? '';
    const tokens = firstCommand.trim().split(/\s+/).filter(token => token.length > 0);
    for (const token of tokens) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || token === '--' || token.startsWith('-')) {
            continue;
        }
        if (COMMAND_WRAPPERS.has(token)) {
            continue;
        }
        if (NON_BIN_COMMANDS.has(token) || !/^[A-Za-z0-9@][\w.@-]*$/.test(token)) {
            return undefined;
        }
        return token;
    }
    return undefined;
}

/** Output folders that show a package has already been built. */
export const QAAP_BUILD_OUTPUT_DIRS: readonly string[] = ['lib', 'dist', 'build', 'out', '.next', '.output'];

/** Dev-server scripts that build on the fly; only `start`/`serve` may need a prior build. */
const SCRIPTS_THAT_MAY_NEED_BUILD = new Set(['start', 'serve']);

/**
 * The build script a workspace member must run before its preview script, or `undefined`.
 *
 * A `start`/`serve` script of a generic (non dev-server) package usually runs build output — `theia
 * start` serves `lib/backend/main.js`, `node dist/server.js` needs `tsc` first. When the package
 * declares `build` and none of {@link QAAP_BUILD_OUTPUT_DIRS} exists yet, the build runs first.
 * Framework dev servers (Vite, Next, …) compile on the fly and never get a build step.
 */
export function resolveWorkspacePreviewBuildScript(options: {
    readonly scriptKey: string;
    readonly scripts: Readonly<Record<string, unknown>>;
    readonly genericKind: boolean;
    readonly buildOutputPresent: boolean;
}): string | undefined {
    if (!options.genericKind || options.buildOutputPresent || !SCRIPTS_THAT_MAY_NEED_BUILD.has(options.scriptKey)) {
        return undefined;
    }
    return typeof options.scripts.build === 'string' ? 'build' : undefined;
}

function runScript(pm: QaapWorkspacePackageManager, script: string): string {
    switch (pm) {
        case 'pnpm': return `pnpm run ${script}`;
        case 'yarn': return `yarn ${script}`;
        case 'bun': return `bun run ${script}`;
        default: return `npm run ${script}`;
    }
}

/**
 * The command that runs a workspace member's script.
 *
 * - pnpm runs from the workspace root with `--filter` (Corepack often only provides pnpm there).
 * - npm, yarn and bun run from the member folder: each adds the `node_modules/.bin` of the member
 *   and of every ancestor — the workspace root included — to `PATH`, so hoisted bins resolve.
 * - `buildScript` (see {@link resolveWorkspacePreviewBuildScript}) runs first, in the same way.
 */
export function buildQaapWorkspaceScriptCommand(options: {
    readonly packageManager: QaapWorkspacePackageManager;
    readonly packageName: string;
    readonly script: string;
    readonly buildScript?: string;
}): string {
    const run = (script: string): string => {
        if (options.packageManager === 'pnpm') {
            const quoted = options.packageName.replace(/'/g, '\'\\\'\'');
            return `pnpm --filter '${quoted}' ${script}`;
        }
        return runScript(options.packageManager, script);
    };
    return options.buildScript
        ? `${run(options.buildScript)} && ${run(options.script)}`
        : run(options.script);
}
