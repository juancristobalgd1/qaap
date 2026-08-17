// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_STATIC_DEV_PORT, QAAP_THEIA_DEV_PORT, QaapProjectKind } from './qaap-project-bootstrap-types';

/** Default dev port per framework when `package.json` does not imply one. */
export function getImplicitDevPort(kind: QaapProjectKind): number | undefined {
    switch (kind) {
        case 'static':
            return QAAP_STATIC_DEV_PORT;
        case 'node-vite':
        case 'node-svelte':
            return 5173;
        case 'node-astro':
            return 4321;
        case 'node-next':
        case 'node-cra':
        case 'node-nuxt':
        case 'node-remix':
            return QAAP_THEIA_DEV_PORT;
        case 'node-generic':
            return QAAP_THEIA_DEV_PORT;
        case 'python-django':
        case 'python-fastapi':
        case 'python-generic':
        case 'go':
        case 'rust':
        case 'dotnet':
        case 'php':
        case 'custom':
            return 8080;
        case 'python-flask':
            return 5000;
        default:
            return undefined;
    }
}

/**
 * Port the Qaap IDE is served on in the current browser session (localhost, VPS IP, or domain).
 */
export function getQaapIdeListenPort(): number | undefined {
    if (typeof window === 'undefined' || !window.location?.hostname) {
        return undefined;
    }
    const parsed = Number(window.location.port);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    if (window.location.protocol === 'https:') {
        return 443;
    }
    if (window.location.protocol === 'http:') {
        return 80;
    }
    return undefined;
}

/**
 * True when `port` would collide with the IDE listener inside the workspace host.
 * When the browser port is unknown (reverse proxy) or matches the default Theia port, treat
 * {@link QAAP_THEIA_DEV_PORT} as reserved — on Docker/VPS the backend still listens there.
 */
export function isReservedIdePort(port: number, idePort?: number): boolean {
    const effectiveIdePort = arguments.length >= 2 ? idePort : getQaapIdeListenPort();
    if (effectiveIdePort !== undefined && port === effectiveIdePort) {
        return true;
    }
    if (port === QAAP_THEIA_DEV_PORT && (effectiveIdePort === undefined || effectiveIdePort === QAAP_THEIA_DEV_PORT)) {
        return true;
    }
    return false;
}

/**
 * Picks a dev-server port that does not collide with the IDE listener inside the workspace host.
 */
export function pickAlternateDevPort(
    frameworkPort: number,
    idePort?: number,
): number {
    const effectiveIdePort = arguments.length >= 2 ? idePort : getQaapIdeListenPort();
    const reserved = new Set<number>();
    if (effectiveIdePort !== undefined) {
        reserved.add(effectiveIdePort);
    }
    reserved.add(frameworkPort);
    let candidate = frameworkPort === QAAP_THEIA_DEV_PORT ? QAAP_THEIA_DEV_PORT + 1 : frameworkPort + 1;
    while (reserved.has(candidate) || candidate >= 65536) {
        candidate += 1;
    }
    return candidate;
}

/**
 * Picks the next port after a runtime conflict, excluding ports already attempted by this run.
 * This is intentionally deterministic: if :5173 is occupied, retry on :5174, then :5175.
 */
export function pickNextDevPort(
    conflictedPort: number,
    attemptedPorts: readonly number[] = [],
    idePort?: number,
): number | undefined {
    const effectiveIdePort = arguments.length >= 3 ? idePort : getQaapIdeListenPort();
    const unavailable = new Set<number>([conflictedPort, ...attemptedPorts]);
    if (effectiveIdePort !== undefined) {
        unavailable.add(effectiveIdePort);
    }
    for (let candidate = conflictedPort + 1; candidate < 65536; candidate++) {
        if (!unavailable.has(candidate) && !isReservedIdePort(candidate, effectiveIdePort)) {
            return candidate;
        }
    }
    return undefined;
}

/**
 * Resolves the port the dev process should bind to inside the VPS/container.
 */
export function resolveBootstrapDevPort(
    frameworkPort: number | undefined,
    idePort?: number,
): number | undefined {
    const effectiveIdePort = arguments.length >= 2 ? idePort : getQaapIdeListenPort();
    if (frameworkPort === undefined) {
        return undefined;
    }
    if (!isReservedIdePort(frameworkPort, effectiveIdePort)) {
        return frameworkPort;
    }
    return pickAlternateDevPort(frameworkPort, effectiveIdePort);
}

/**
 * Prefixes / suffixes the dev command so the child process binds to `port` inside the host.
 */
export function wrapDevCommandForPort(command: string, port: number, kind: QaapProjectKind): string {
    const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.platform);
    const materialized = command.replaceAll('{{PORT}}', String(port));
    switch (kind) {
        case 'node-vite':
        case 'node-astro':
        case 'node-svelte':
            // Vite reads `process.env.PORT` before CLI flags; Docker sets PORT to the IDE port (4873).
            return appendCliPortFlag(
                injectFrameworkPortIntoMultiProcessCommand(prefixPortEnv(materialized, port, kind, isWindows), port),
                port,
                isWindows,
                true,
            );
        case 'node-next':
            return appendNextDevPort(prefixPortEnv(materialized, port, kind, isWindows), port, isWindows);
        case 'node-remix':
            return appendCliPortFlag(prefixPortEnv(materialized, port, kind, isWindows), port, isWindows);
        default:
            return prefixPortEnv(materialized, port, kind, isWindows);
    }
}

// npm lifecycle scripts can contain their own `PORT=8080` assignment, which overrides a plain
// `PORT=8081 npm run dev` prefix. Every supported Qaap runtime uses Node 22+, so preload a tiny,
// dependency-free module before application code runs. Framework CLIs need a targeted argv patch:
// forcing PORT in *every* child poisoned multi-process scripts such as `concurrently "vite" "node
// bridge.js"` — the bridge inherited the preview port while Vite's config still selected :8080.
// The targeted preload reaches a nested Vite/Next/Astro/Remix executable without touching sibling
// services. Generic/CRA scripts keep the legacy PORT restore for inline `PORT=… node …` commands.
const FORCE_NODE_PREVIEW_PORT_SOURCE = 'process.env.PORT=process.env.QAAP_PREVIEW_PORT';
const FORCE_FRAMEWORK_PREVIEW_PORT_SOURCE = [
    'const p=process.env.QAAP_PREVIEW_PORT,a=process.argv,'
        + "e=(a[1]||'').replaceAll('\\\\','/').split('/').pop()||'',"
        + "hasPort=a.some(v=>v==='--port'||v==='-p'||v.startsWith('--port=')),"
        + "hasStrict=a.some(v=>v==='--strictPort'||v.startsWith('--strictPort=')),"
        + "hasHost=a.some(v=>v==='--host'||v.startsWith('--host=')),"
        + 'isVite=/^(vite|vite\\.js|astro|astro\\.js)$/.test(e)',
    'if(p){if(isVite){'
        + "for(let i=a.length-1;i>=2;i--){if(a[i]==='--open'||String(a[i]).startsWith('--open='))a.splice(i,1)}"
        + 'if(!hasPort){a.push(\'--port\',p)}if(!hasStrict){a.push(\'--strictPort\')}'
        + 'if(!hasHost){a.push(\'--host\',\'127.0.0.1\')}'
        + '}else if(!hasPort){if(/^(next|next\\.js)$/.test(e)){a.push(\'-p\',p)}'
        + 'else if(/^(remix|remix\\.js)$/.test(e)){a.push(\'--port\',p)}}}',
].join(';');

function forceNodePreviewPortImport(kind: QaapProjectKind): string {
    const source = kind === 'node-vite'
        || kind === 'node-astro'
        || kind === 'node-svelte'
        || kind === 'node-next'
        || kind === 'node-remix'
        ? FORCE_FRAMEWORK_PREVIEW_PORT_SOURCE
        : FORCE_NODE_PREVIEW_PORT_SOURCE;
    return `--import=data:text/javascript;base64,${btoa(source)}`;
}

function prefixPortEnv(command: string, port: number, kind: QaapProjectKind, isWindows: boolean): string {
    const isNode = kind.startsWith('node-');
    const forcePortImport = isNode ? forceNodePreviewPortImport(kind) : undefined;
    if (isWindows) {
        const base = `set "QAAP_PREVIEW_PORT=${port}"&& set "PORT=${port}"&& `;
        return isNode
            ? `${base}set "NODE_ENV=development"&& set "NODE_OPTIONS=%NODE_OPTIONS% ${forcePortImport}"&& ${command}`
            : `${base}${command}`;
    }
    return isNode
        ? `QAAP_PREVIEW_PORT=${port} PORT=${port} NODE_ENV=development `
            + `NODE_OPTIONS="$NODE_OPTIONS ${forcePortImport}" ${command}`
        : `QAAP_PREVIEW_PORT=${port} PORT=${port} ${command}`;
}

/**
 * Dev/install commands must not inherit the host's `NODE_ENV=production` (the Docker/VPS backend
 * exports it): `npm install` then skips devDependencies and `vite dev` poisons the browser with a
 * production `process.env.NODE_ENV` via `/@vite/env`, flipping React and framework dev branches.
 * An inline assignment in the project's own script still wins over this prefix — deliberate.
 */
export function wrapCommandForDevNodeEnv(command: string): string {
    const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.platform);
    if (isWindows) {
        return `set "NODE_ENV=development"&& ${command}`;
    }
    return `NODE_ENV=development ${command}`;
}

const CONCURRENTLY_OR_RUN_ALL_PATTERN = /\bconcurrently\b|\bnpm-run-all\b|\brun-p\b|\brun-s\b/;
const QUOTED_FRAMEWORK_CHAIN_PATTERN = /["'][^"']*\b(?:vite|astro|svelte(?:-kit)?)\b/i;
const FRAMEWORK_EXECUTABLE_PATTERN = /\b(?:vite(?:\.js)?|astro(?:\.js)?|svelte(?:-kit)?(?:\.js)?)\b/i;

function needsMultiProcessPortRewrite(command: string): boolean {
    return CONCURRENTLY_OR_RUN_ALL_PATTERN.test(command) || QUOTED_FRAMEWORK_CHAIN_PATTERN.test(command);
}

function segmentHasPortFlag(segment: string): boolean {
    return /(?:^|\s)--port(?:=|\s|$)/.test(segment) || /(?:^|\s)-p(?:=|\s|$)/.test(segment);
}

function segmentHasStrictPort(segment: string): boolean {
    return /(?:^|\s)--strictPort(?:=|\s|$)/.test(segment);
}

function injectPortIntoQuotedSegment(segment: string, port: number): string {
    if (!FRAMEWORK_EXECUTABLE_PATTERN.test(segment)) {
        return segment;
    }
    let result = segment;
    if (!segmentHasPortFlag(result)) {
        result += ` --port ${port}`;
    }
    if (!segmentHasStrictPort(result)) {
        result += ' --strictPort';
    }
    return result;
}

/**
 * Rewrites quoted subcommands in concurrently / npm-run-all scripts so Vite/Astro receive explicit
 * port flags even when npm's `--` separator forwards them to the wrapper instead of the child.
 */
export function injectFrameworkPortIntoMultiProcessCommand(command: string, port: number): string {
    if (!needsMultiProcessPortRewrite(command)) {
        return command;
    }
    let result = '';
    let index = 0;
    while (index < command.length) {
        const char = command[index];
        if (char === '"' || char === "'") {
            const quote = char;
            let end = index + 1;
            while (end < command.length) {
                if (command[end] === '\\' && end + 1 < command.length) {
                    end += 2;
                    continue;
                }
                if (command[end] === quote) {
                    break;
                }
                end++;
            }
            const inner = command.slice(index + 1, end);
            result += quote + injectPortIntoQuotedSegment(inner, port) + quote;
            index = end + 1;
            continue;
        }
        result += char;
        index++;
    }
    return result;
}

// pnpm forwards args after the script name to the child literally: `--` would reach vite/next as
// a real token (end-of-options) instead of being consumed, silently dropping the port flags.
const PNPM_RUNNER_PATTERN = /(?:^|\s)pnpm\s+(?:run\s+)?\S+/;

function appendCliPortFlag(command: string, port: number, isWindows: boolean, strictPort?: boolean): string {
    const strictSuffix = strictPort ? ' --strictPort' : '';
    if (PNPM_RUNNER_PATTERN.test(command)) {
        return `${command} --port ${port}${strictSuffix}`;
    }
    if (isWindows) {
        return `${command} -- --port ${port}${strictSuffix}`;
    }
    return `${command} -- --port ${port}${strictSuffix}`;
}

/** Next.js reads `-p` / `--port` on `next dev`; keep explicit flags in addition to `PORT=`. */
function appendNextDevPort(command: string, port: number, isWindows: boolean): string {
    // Same pnpm caveat as appendCliPortFlag.
    if (PNPM_RUNNER_PATTERN.test(command)) {
        return `${command} -p ${port}`;
    }
    if (isWindows) {
        return `${command} -- -p ${port}`;
    }
    return `${command} -- -p ${port}`;
}
