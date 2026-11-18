// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * What a settled agent turn means for the project's preview: shared by the backend headless
 * capture (should it reuse the live dev server?) and the Work Hub (restart the Qaap-managed dev
 * server, reload the Browser, or leave both alone because the dev server reloads by itself).
 */

/** Directories never walked: dependencies, VCS, build output, caches, Qaap/IDE state. */
const IGNORED_DIRECTORIES = new Set([
    'node_modules', '.git', '.hg', '.svn', '.theia', '.qaap', '.vscode', '.idea',
    '.next', '.nuxt', '.svelte-kit', '.astro', '.turbo', '.parcel-cache', '.cache', '.vite',
    'dist', 'build', 'out', 'coverage', 'tmp', '.tmp', '__pycache__', '.venv', 'venv', 'target',
]);

/** Directories whose files are served to the browser as-is (a reload is enough). */
const FRONTEND_DIRECTORIES = new Set(['public', 'static', 'www', 'assets', 'client', 'frontend']);

/** Browser-only assets: changing them never needs a server restart. */
const FRONTEND_EXTENSIONS = /\.(?:html?|css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|md|txt|map)$/i;

/** Code or config a server process loads at start. */
const SERVER_EXTENSIONS = /\.(?:[cm]?js|[cm]?ts|json|py|rb|go|rs|php|java|kt|toml|ya?ml|ini|cfg)$/i;

/** Dev commands whose server restarts itself when its code changes (frameworks, watchers). */
const SERVER_SELF_RESTART_PATTERN = new RegExp([
    '\\bnodemon\\b', '\\bnode\\b[^&|;]*--watch\\b', '\\btsx\\s+watch\\b', '\\bts-node-dev\\b',
    '\\bbun\\b[^&|;]*--(?:watch|hot)\\b', '\\buvicorn\\b[^&|;]*--reload\\b', '\\bflask\\b[^&|;]*--debug\\b',
    '\\bvite\\b', '\\bnext\\s+dev\\b', '\\bnuxt\\b', '\\bastro\\s+dev\\b', '\\bremix\\s+(?:vite:)?dev\\b',
    '\\bsvelte-kit\\b', '\\bwebpack(?:-dev-server|\\s+serve)\\b', '\\breact-scripts\\s+start\\b',
    '\\bparcel\\b', '\\bng\\s+serve\\b', '\\bvue-cli-service\\s+serve\\b', '\\bgatsby\\s+develop\\b',
    '\\bmanage\\.py\\s+runserver\\b',
].join('|'), 'i');

/** Dev commands that push changes into the open page by themselves (HMR / live reload). */
const CLIENT_HOT_RELOAD_PATTERN = new RegExp([
    '\\bvite\\b', '\\bnext\\s+dev\\b', '\\bnuxt\\b', '\\bastro\\s+dev\\b', '\\bremix\\s+(?:vite:)?dev\\b',
    '\\bsvelte-kit\\b', '\\bwebpack(?:-dev-server|\\s+serve)\\b', '\\breact-scripts\\s+start\\b',
    '\\bparcel\\b', '\\bng\\s+serve\\b', '\\bvue-cli-service\\s+serve\\b', '\\bgatsby\\s+develop\\b',
    '\\blive-server\\b', '\\bbrowser-sync\\b',
].join('|'), 'i');

function pathSegments(relativePath: string): string[] {
    return relativePath.replace(/\\/g, '/').split('/').filter(segment => segment && segment !== '.');
}

/** True for paths inside dependency, VCS, build-output or tool-state directories. */
export function isQaapPreviewIgnoredPath(relativePath: string): boolean {
    return pathSegments(relativePath).some(segment => IGNORED_DIRECTORIES.has(segment));
}

/** True when a change to this project file only takes effect after the dev server restarts. */
export function isQaapPreviewServerSideFile(relativePath: string): boolean {
    const segments = pathSegments(relativePath);
    if (segments.length === 0 || segments.some(segment => IGNORED_DIRECTORIES.has(segment))) {
        return false;
    }
    const name = segments[segments.length - 1]!;
    if (name === 'package.json' || /^\.env(?:\..+)?$/.test(name)) {
        return true;
    }
    if (segments.slice(0, -1).some(segment => FRONTEND_DIRECTORIES.has(segment)) || FRONTEND_EXTENSIONS.test(name)) {
        return false;
    }
    return SERVER_EXTENSIONS.test(name);
}

export function qaapPreviewCommandRestartsServerItself(command: string | undefined): boolean {
    return !!command && SERVER_SELF_RESTART_PATTERN.test(command);
}

export function qaapPreviewCommandHotReloadsClient(command: string | undefined): boolean {
    return !!command && CLIENT_HOT_RELOAD_PATTERN.test(command);
}

/**
 * - `restart`: server code changed and the dev server does not restart itself — restart the
 *   Qaap-managed process, then reload the page.
 * - `reload`: something the page uses changed and nothing pushes it — reload the Browser.
 * - `none`: no project change, or the dev server's own HMR / watcher handles it.
 */
export type QaapPreviewTurnRefreshAction = 'restart' | 'reload' | 'none';

export function classifyQaapPreviewTurnRefresh(
    changedRelativePaths: readonly string[],
    devCommand: string | undefined,
): QaapPreviewTurnRefreshAction {
    const changed = changedRelativePaths.filter(item => !isQaapPreviewIgnoredPath(item));
    if (changed.length === 0) {
        return 'none';
    }
    if (changed.some(isQaapPreviewServerSideFile) && !qaapPreviewCommandRestartsServerItself(devCommand)) {
        return 'restart';
    }
    return qaapPreviewCommandHotReloadsClient(devCommand) ? 'none' : 'reload';
}

/** The `dev` (else `start`) script a package.json preview runs, for the HMR checks above. */
export function resolveQaapPreviewDevScript(packageJson: { readonly scripts?: Readonly<Record<string, string>> } | undefined): string | undefined {
    return packageJson?.scripts?.['dev'] ?? packageJson?.scripts?.['start'];
}

/** Bounds of the changed-file walk: a preview refresh must never stall on a huge tree. */
export const QAAP_PREVIEW_CHANGE_WALK_MAX_DEPTH = 6;
export const QAAP_PREVIEW_CHANGE_WALK_MAX_ENTRIES = 4000;
