// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Dev/install output that usually means dependencies were not installed (or only production deps). */
export const DEV_INSTALL_NEEDED_REGEX = /ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|(?:sh|bash):\s*1:\s*(?:vite|esbuild|next|nuxt|astro): not found|Missing script:|npm error code ENOENT/i;

export const PORT_IN_USE_REGEX = /EADDRINUSE|address already in use/i;

/** Next.js refuses a second `next dev` while `.next/dev/lock` is held. */
export const NEXT_DEV_LOCK_REGEX = /Unable to acquire lock|another instance of next dev running/i;

const MISSING_ENV_REGEX = /missing required environment variable|environment variable .{0,80}(?:is not set|is required|missing)|(?:missing|no) (?:api[- ]?)?key|(?:DATABASE_URL|API_KEY|SECRET_KEY|AUTH_SECRET).{0,40}(?:is not set|is required|missing)/i;
const NODE_VERSION_REGEX = /EBADENGINE|unsupported engine|requires Node(?:\.js)?|Node(?:\.js)? version .{0,60}(?:not supported|incompatible)|you are using Node(?:\.js)?/i;
const PERMISSION_REGEX = /EACCES|EPERM|permission denied|operation not permitted/i;
const CONFIGURATION_REGEX = /failed to load config|error loading config|invalid configuration|configuration error|syntaxerror.{0,80}(?:config|\.json|\.ts|\.js)/i;

/** Next.js log when it picks another port, e.g. `using available port 3001 instead`. */
export const NEXT_ALT_PORT_REGEX = /using available port (\d{2,5}) instead/gi;

const DEV_OUTPUT_URL_PORT_REGEX = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})\b/gi;

const ANSI_REGEX = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export type QaapBootstrapFailureKind =
    | 'dependencies'
    | 'port-conflict'
    | 'next-lock'
    | 'environment'
    | 'runtime-version'
    | 'permission'
    | 'configuration'
    | 'process-exit'
    | 'unknown';

export interface QaapBootstrapFailureDiagnosis {
    readonly kind: QaapBootstrapFailureKind;
    readonly message: string;
}

export function terminalOutputNeedsInstall(output: string): boolean {
    return DEV_INSTALL_NEEDED_REGEX.test(output);
}

export function terminalOutputPortInUse(output: string): boolean {
    return PORT_IN_USE_REGEX.test(output);
}

export function terminalOutputNextDevLock(output: string): boolean {
    return NEXT_DEV_LOCK_REGEX.test(output);
}

/** Ports mentioned in dev-server stdout (Next alternate port, Local: URLs, …). */
export function extractDevOutputProbePorts(output: string): number[] {
    const clean = output.replace(ANSI_REGEX, '');
    const ports: number[] = [];
    for (const match of clean.matchAll(NEXT_ALT_PORT_REGEX)) {
        ports.push(Number(match[1]));
    }
    for (const match of clean.matchAll(DEV_OUTPUT_URL_PORT_REGEX)) {
        ports.push(Number(match[1]));
    }
    return [...new Set(ports.filter(p => Number.isFinite(p) && p > 0 && p < 65536))];
}

export function isTerminalDoesNotExistError(message: string): boolean {
    return /terminal "[\d]+" does not exist/i.test(message);
}

function lastUsefulErrorLine(output: string): string | undefined {
    const clean = output.replace(ANSI_REGEX, '');
    const lines = clean.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (/^(Error|error|npm error|failed to|Cannot find|SyntaxError)/i.test(line)) {
            return line.length > 220 ? `${line.slice(0, 217)}…` : line;
        }
    }
    return undefined;
}

/** Classifies a failed preview and returns copy that tells the user what to do next. */
export function diagnoseBootstrapFailure(output: string, fallback: string): QaapBootstrapFailureDiagnosis {
    if (terminalOutputNeedsInstall(output)) {
        return {
            kind: 'dependencies',
            message: 'Dev dependencies are missing. Run Install — on Docker, NODE_ENV=production skips devDependencies until install runs with NODE_ENV=development.',
        };
    }
    if (terminalOutputNextDevLock(output)) {
        const ports = extractDevOutputProbePorts(output);
        const hint = ports.length > 0 ? ` Try Open preview · :${ports[0]}.` : ' Stop the other Next dev or remove .next/dev/lock, then retry.';
        return { kind: 'next-lock', message: `Next.js is already running in this project.${hint}` };
    }
    const clean = output.replace(ANSI_REGEX, '');
    if (terminalOutputPortInUse(clean)) {
        return {
            kind: 'port-conflict',
            message: 'Dev port is already in use. Qaap will try the next available port automatically; use Open preview if another server is already running.',
        };
    }
    if (MISSING_ENV_REGEX.test(clean)) {
        return {
            kind: 'environment',
            message: 'Required environment configuration is missing. Add the missing value in Env, then retry the preview.',
        };
    }
    if (NODE_VERSION_REGEX.test(clean)) {
        return {
            kind: 'runtime-version',
            message: 'The project requires a different Node.js version. Check package.json engines or the framework requirement, switch Node, then retry.',
        };
    }
    if (PERMISSION_REGEX.test(clean)) {
        return {
            kind: 'permission',
            message: 'The dev server cannot read, write, or bind a required resource. Check workspace ownership and file permissions, then retry.',
        };
    }
    if (CONFIGURATION_REGEX.test(clean)) {
        return {
            kind: 'configuration',
            message: 'The project configuration could not be loaded. Check the last config-file error in the terminal, fix it, then retry.',
        };
    }
    const usefulLine = lastUsefulErrorLine(clean);
    return {
        kind: usefulLine ? 'process-exit' : 'unknown',
        message: usefulLine ?? fallback,
    };
}

/** Picks the most useful single-line error from the tail of terminal output. */
export function extractTerminalFailureLine(output: string, fallback: string): string {
    return diagnoseBootstrapFailure(output, fallback).message;
}
