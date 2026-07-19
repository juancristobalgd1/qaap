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
    switch (kind) {
        case 'node-vite':
        case 'node-astro':
        case 'node-svelte':
            // Vite reads `process.env.PORT` before CLI flags; Docker sets PORT to the IDE port (4873).
            return appendCliPortFlag(prefixPortEnv(command, port, isWindows), port, isWindows);
        case 'node-next':
            return appendNextDevPort(prefixPortEnv(command, port, isWindows), port, isWindows);
        case 'node-remix':
            return appendCliPortFlag(prefixPortEnv(command, port, isWindows), port, isWindows);
        default:
            return prefixPortEnv(command, port, isWindows);
    }
}

// npm lifecycle scripts can contain their own `PORT=8080` assignment, which overrides a plain
// `PORT=8081 npm run dev` prefix. Every supported Qaap runtime uses Node 22+, so preload a tiny,
// dependency-free module that restores the allocator-owned port before application code runs.
// Framework CLI flags remain in place below because they also cover servers which prefer argv.
const FORCE_NODE_PREVIEW_PORT_IMPORT = '--import=data:text/javascript,process.env.PORT%3Dprocess.env.QAAP_PREVIEW_PORT';

function prefixPortEnv(command: string, port: number, isWindows: boolean): string {
    if (isWindows) {
        return `set "QAAP_PREVIEW_PORT=${port}"&& set "PORT=${port}"&& `
            + `set "NODE_OPTIONS=%NODE_OPTIONS% ${FORCE_NODE_PREVIEW_PORT_IMPORT}"&& ${command}`;
    }
    return `QAAP_PREVIEW_PORT=${port} PORT=${port} `
        + `NODE_OPTIONS="$NODE_OPTIONS ${FORCE_NODE_PREVIEW_PORT_IMPORT}" ${command}`;
}

function appendCliPortFlag(command: string, port: number, isWindows: boolean): string {
    if (isWindows) {
        return `${command} -- --port ${port}`;
    }
    return `${command} -- --port ${port}`;
}

/** Next.js reads `-p` / `--port` on `next dev`; keep explicit flags in addition to `PORT=`. */
function appendNextDevPort(command: string, port: number, isWindows: boolean): string {
    if (isWindows) {
        return `${command} -- -p ${port}`;
    }
    return `${command} -- -p ${port}`;
}
