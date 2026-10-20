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

/**
 * Globs of the package-manager workspace a directory declares (`pnpm-workspace.yaml` or
 * `package.json#workspaces`). Lerna's own `packages` are left out: without package-manager
 * workspaces (legacy `lerna bootstrap`), installing at the root does not install the members.
 */
export function packageManagerWorkspacePatterns(manifests: QaapWorkspaceManifests): string[] {
    return workspaceMemberPatterns({ packageJson: manifests.packageJson, pnpmPackages: manifests.pnpmPackages });
}

/**
 * Hard ceiling for workspace discovery on a Qaap host: the tenant's own repository area
 * `/workspace/repos/users/<login>`. Discovery never reads above it, so one tenant's checkout can
 * never adopt manifests outside that tenant's area. `undefined` off the hosted layout.
 */
export function qaapTenantRepositoryCeiling(dir: string): string | undefined {
    return /^(.*?\/workspace\/repos\/users\/[^/]+)(?:\/|$)/.exec(dir)?.[1];
}

function isSameOrInside(dir: string, ceiling: string): boolean {
    const normalizedCeiling = ceiling.length > 1 ? ceiling.replace(/\/+$/, '') : ceiling;
    return dir === normalizedCeiling || dir.startsWith(normalizedCeiling === '/' ? '/' : `${normalizedCeiling}/`);
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
 * The walk is bounded: it stops after `maxDepth` levels, at the first directory `isBoundary`
 * reports (the git checkout root, so a clone never adopts a workspace that merely encloses it),
 * and never reads a directory outside `ceilingDirs` (the open workspace roots and the tenant's
 * repository area, see {@link qaapTenantRepositoryCeiling}). Only package-manager workspaces count.
 */
export async function findQaapWorkspaceRoot(
    packageDir: string,
    readManifests: (dir: string) => Promise<QaapWorkspaceManifests | undefined>,
    options: {
        readonly maxDepth?: number;
        readonly isBoundary?: (dir: string) => Promise<boolean>;
        readonly ceilingDirs?: readonly string[];
    } = {},
): Promise<QaapWorkspaceRootMatch | undefined> {
    const maxDepth = options.maxDepth ?? 4;
    const tenantCeiling = qaapTenantRepositoryCeiling(packageDir);
    const ceilings = [...(options.ceilingDirs ?? []), ...(tenantCeiling ? [tenantCeiling] : [])]
        .filter(ceiling => isSameOrInside(packageDir, ceiling));
    const insideCeilings = (candidate: string): boolean => ceilings.every(ceiling => isSameOrInside(candidate, ceiling));
    if (options.isBoundary && await options.isBoundary(packageDir)) {
        return undefined;
    }
    let dir = parentDir(packageDir);
    for (let depth = 0; dir !== undefined && depth < maxDepth && insideCeilings(dir); depth++) {
        const manifests = await readManifests(dir);
        if (manifests) {
            const relativePath = relativeTo(dir, packageDir);
            if (packageManagerWorkspacePatterns(manifests).some(pattern => workspaceGlobMatches(relativePath, pattern))) {
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

/**
 * Whether a script's bin is something install provides, so its absence means install did not
 * finish: a declared dependency of that name (`vite`), the bin of a scoped `@x/cli` dependency
 * (`@theia/cli` → `theia`), or a bin declared by a package of the workspace itself. System tools
 * (`docker`, `python3`, `make`) are none of these and are never treated as missing dependencies.
 */
export function isQaapInstalledBinary(binary: string, options: {
    readonly dependencyNames: readonly string[];
    readonly workspaceBins?: ReadonlySet<string>;
}): boolean {
    if (options.workspaceBins?.has(binary)) {
        return true;
    }
    return options.dependencyNames.some(name => {
        if (name === binary) {
            return true;
        }
        const scoped = /^@([^/]+)\/(.+)$/.exec(name);
        return !!scoped && (scoped[2] === binary || (scoped[2] === 'cli' && scoped[1] === binary));
    });
}

/** Bin names a `package.json#bin` field declares (a string bin is named after the package). */
export function declaredPackageBins(packageName: unknown, bin: unknown): string[] {
    if (typeof bin === 'string' && typeof packageName === 'string') {
        return [packageName.replace(/^@[^/]+\//, '')];
    }
    return bin && typeof bin === 'object' ? Object.keys(bin as Record<string, unknown>) : [];
}

/** Output folders that show a package has already been built. */
export const QAAP_BUILD_OUTPUT_DIRS: readonly string[] = ['lib', 'dist', 'build', 'out', '.next', '.output'];

/** Dev-server scripts that build on the fly; only `start`/`serve` may need a prior build. */
const SCRIPTS_THAT_MAY_NEED_BUILD = new Set(['start', 'serve']);

/** Tokens after which a word names a script or a package, never a folder (`npm run build`). */
const SCRIPT_NAME_PREFIXES = new Set(['run', 'npm', 'yarn', 'pnpm', 'bun', 'npx', '--filter', '-w', '--workspace']);

/**
 * The build-output folder a script runs from (`dist` for `node dist/server.js`, `build` for
 * `serve -s build`), or `undefined` when the script does not name one. The command word of each
 * segment and script names (`npm run build`) are never folders.
 */
export function scriptBuildOutputDir(script: string): string | undefined {
    for (const segment of script.split(/&&|\|\||;|\|/)) {
        const tokens = segment.trim().split(/\s+/).filter(token => token.length > 0 && !/^\w+=/.test(token));
        for (let index = 1; index < tokens.length; index++) {
            if (SCRIPT_NAME_PREFIXES.has(tokens[index - 1])) {
                continue;
            }
            const value = tokens[index].replace(/^--?[\w-]+=/, '').replace(/^["']|["']$/g, '').replace(/^\.\//, '');
            const first = value.split('/')[0];
            if (first && QAAP_BUILD_OUTPUT_DIRS.includes(first)) {
                return first;
            }
        }
    }
    return undefined;
}

/** `build` when the package declares one. */
export function declaredBuildScript(scripts: Readonly<Record<string, unknown>>): string | undefined {
    return typeof scripts.build === 'string' ? 'build' : undefined;
}

/**
 * Opt-in policy for building before preview. Only `"build": "auto"` in `.qaap/preview.json` (alone,
 * or next to a full launch plan) enables it; anything else keeps the build manual.
 */
export type QaapPreviewBuildPolicy = 'auto' | 'manual';

export function parseQaapPreviewBuildPolicy(value: unknown): QaapPreviewBuildPolicy {
    return value && typeof value === 'object' && (value as { build?: unknown }).build === 'auto' ? 'auto' : 'manual';
}

/** Build decision for one previewable package (see {@link resolveQaapPreviewBuildPlan}). */
export interface QaapPreviewBuildPlan {
    /** Script chained before the preview script (`npm run build && npm run start`); only with `policy: 'auto'`. */
    readonly buildScript?: string;
    /**
     * The preview script certainly cannot run yet (it names a build-output folder that does not
     * exist) and no build is chained: Preview fails fast with `build-required` instead of starting.
     */
    readonly buildRequired: boolean;
    /** The missing output folder the script names (relative to the package), when `buildRequired`. */
    readonly missingOutputDir?: string;
}

/**
 * Whether a workspace member's preview needs a build, and whether Preview may run it.
 *
 * The build is NEVER implicit: a monorepo build (Theia compiles the whole TypeScript graph) can take
 * tens of minutes and exhaust a tenant's memory, so it runs only when the project opted in with
 * `"build": "auto"`. Even then it only runs for a `start`/`serve` script of a generic (non
 * dev-server) package that declares `build` and has no build output yet; framework dev servers
 * compile on the fly. Without the opt-in, a script that names a missing output folder
 * (`node dist/server.js`) is reported as `buildRequired` so Preview never starts a server that
 * cannot run.
 */
export function resolveQaapPreviewBuildPlan(options: {
    readonly scriptKey: string;
    readonly script: string;
    readonly scripts: Readonly<Record<string, unknown>>;
    readonly genericKind: boolean;
    readonly outputDirExists: (dir: string) => boolean;
    readonly policy: QaapPreviewBuildPolicy;
}): QaapPreviewBuildPlan {
    const buildScript = declaredBuildScript(options.scripts);
    if (!options.genericKind || !SCRIPTS_THAT_MAY_NEED_BUILD.has(options.scriptKey) || !buildScript) {
        return { buildRequired: false };
    }
    const namedOutputDir = scriptBuildOutputDir(options.script);
    const outputMissing = namedOutputDir !== undefined
        ? !options.outputDirExists(namedOutputDir)
        : !QAAP_BUILD_OUTPUT_DIRS.some(dir => options.outputDirExists(dir));
    if (options.policy === 'auto' && outputMissing) {
        return { buildScript, buildRequired: false };
    }
    return namedOutputDir !== undefined && outputMissing
        ? { buildRequired: true, missingOutputDir: namedOutputDir }
        : { buildRequired: false };
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
 * - `buildScript` runs first, only when `.qaap/preview.json` opted in (see {@link resolveQaapPreviewBuildPlan}); pnpm builds
 *   the package's workspace dependencies too (`--filter 'name...'`).
 */
export function buildQaapWorkspaceScriptCommand(options: {
    readonly packageManager: QaapWorkspacePackageManager;
    readonly packageName: string;
    readonly script: string;
    readonly buildScript?: string;
}): string {
    const run = (script: string, withDependencies: boolean): string => {
        if (options.packageManager === 'pnpm') {
            const quoted = options.packageName.replace(/'/g, '\'\\\'\'');
            return `pnpm --filter '${quoted}${withDependencies ? '...' : ''}' ${script}`;
        }
        return runScript(options.packageManager, script);
    };
    return options.buildScript
        ? `${run(options.buildScript, true)} && ${run(options.script, false)}`
        : run(options.script, false);
}
