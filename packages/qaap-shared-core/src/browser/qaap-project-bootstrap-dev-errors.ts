// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/**
 * A script's executable is missing from every `node_modules/.bin` on `PATH`: `sh: 1: theia: not
 * found` (dash), `bash: line 1: vite: command not found`, `sh: vite: command not found` (macOS).
 * Package managers, runtimes and git are excluded: their absence is an image problem, not install.
 */
const MISSING_SCRIPT_BINARY_REGEX = /\b(?:sh|bash|zsh)(?::\s*(?:line\s*)?\d+)?:\s*(?!(?:npm|npx|pnpm|yarn|bun|node|corepack|git):)([\w@.\/-]+): (?:command )?not found/i;

/**
 * System executables a script may call. Install never provides them, so `python3: not found` is an
 * image problem: it must not be reported as missing dependencies or trigger a reinstall.
 */
const SYSTEM_BINARIES: ReadonlySet<string> = new Set([
    'python', 'python3', 'pip', 'pip3', 'uv', 'poetry', 'docker', 'docker-compose', 'podman', 'make', 'cmake',
    'go', 'cargo', 'rustc', 'java', 'javac', 'mvn', 'gradle', 'ruby', 'gem', 'bundle', 'php', 'composer',
    'dotnet', 'deno', 'curl', 'wget', 'gcc', 'g++', 'cc', 'clang', 'psql', 'mysql', 'redis-server', 'sqlite3',
]);

/** Dev/install output that usually means dependencies were not installed (or only production deps). */
export const DEV_INSTALL_NEEDED_REGEX = /ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|Missing script:|npm error code ENOENT/i;

/**
 * `Cannot find module` naming the repository's own compiled output, not a dependency and not a
 * source import: an absolute or relative path (never a bare or `@/` alias specifier), outside
 * `node_modules` and `src/`, that is a JavaScript file or sits in an output folder
 * (`/repo/dev-packages/cli/lib/theia` when `theia start` runs before `npm run build`).
 * Reinstalling cannot fix it.
 */
const CANNOT_FIND_MODULE_REGEX = /Cannot find module '([^']+)'/gi;

function isMissingBuildOutputPath(specifier: string): boolean {
    const path = specifier.replace(/\\/g, '/');
    if (!/^(?:\/|\.{1,2}\/|[A-Za-z]:\/)/.test(path) || /\/(?:node_modules|src)\//.test(path)) {
        return false;
    }
    // Next.js's own `.next` cache (`./vendor-chunks/x.js` after a stale dev compile) is a framework
    // cache problem fixed by restarting the dev server, not a project that was never built.
    if (/(?:^|\/)\.next\//.test(path) || /(?:^|\/)vendor-chunks\//.test(path)) {
        return false;
    }
    return /\.(?:c|m)?js$/.test(path) || /\/(?:lib|dist|out|build)\//.test(path);
}

/**
 * A dev port bound by another process. Node prints `EADDRINUSE` / `address already in use`, but
 * Vite (and Astro/SvelteKit on top of it) with `--strictPort` catches that error and prints only
 * `Error: Port 5173 is already in use` — without this phrase the conflict was never recognized,
 * so automatic port recovery never ran and the run retried the occupied port.
 */
export const PORT_IN_USE_REGEX = /EADDRINUSE|address already in use|\bport \d{2,5} is (?:already )?in use/i;

/**
 * The dev process died from memory exhaustion: V8's own heap limit, or the kernel OOM killer
 * (shells print `Killed` / exit status 137). A retry is killed the same way, so it is terminal.
 */
export const OUT_OF_MEMORY_REGEX = /JavaScript heap out of memory|Reached heap limit|\bout of memory\b|^\s*Killed\b|(?:code|status) 137\b/im;

/** Appended to the dev output when the backend's cgroup counter shows the run was OOM-killed. */
export const DEV_OUT_OF_MEMORY_NOTICE = '[qaap] The dev server was killed because the workspace ran out of memory.';

/** Next.js refuses a second `next dev` while `.next/dev/lock` is held. */
export const NEXT_DEV_LOCK_REGEX = /Unable to acquire lock|another instance of next dev running/i;

const MISSING_ENV_REGEX = /missing required environment variable|environment variable .{0,80}(?:is not set|is required|missing)|(?:missing|no) (?:api[- ]?)?key|(?:DATABASE_URL|API_KEY|SECRET_KEY|AUTH_SECRET).{0,40}(?:is not set|is required|missing)/i;
const NODE_VERSION_REGEX = /EBADENGINE|unsupported engine|requires Node(?:\.js)?|Node(?:\.js)? version .{0,60}(?:not supported|incompatible)|you are using Node(?:\.js)?/i;
const PERMISSION_REGEX = /EACCES|EPERM|permission denied|operation not permitted/i;
const CONFIGURATION_REGEX = /failed to load config|error loading config|invalid configuration|configuration error|syntaxerror.{0,80}(?:config|\.json|\.ts|\.js)/i;

/** Next.js log when it picks another port, e.g. `using available port 3001 instead`. */
export const NEXT_ALT_PORT_REGEX = /using available port (\d{2,5}) instead/gi;

const DEV_OUTPUT_URL_PORT_REGEX = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})\b/gi;
const DEV_OUTPUT_HOST_PORT_REGEX = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/gi;

const ANSI_REGEX = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export type QaapBootstrapFailureKind =
    | 'out-of-memory'
    | 'build-required'
    | 'build-failed'
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

/**
 * Preview never builds a project on its own (a monorepo build can take tens of minutes and exhaust
 * the workspace memory): this tells the user how to build, or how to opt in explicitly.
 */
const QAAP_PREVIEW_BUILD_REQUIRED_LEAD = 'The project has not been built yet: its start script needs compiled output that does not exist.';

/**
 * The `build-required` copy. Build and start and the `.qaap/preview.json` opt-in exist only for
 * workspace members with a declared build (`buildAndStartCommand`); elsewhere neither is named.
 */
export function formatQaapPreviewBuildRequiredMessage(canBuildAndStart: boolean): string {
    return canBuildAndStart
        ? `${QAAP_PREVIEW_BUILD_REQUIRED_LEAD} Choose Build and start to build it now (a large project can take several minutes), `
            + 'run the build yourself, or opt in to building before every preview with {"build": "auto"} in .qaap/preview.json.'
        : `${QAAP_PREVIEW_BUILD_REQUIRED_LEAD} Run its build yourself (for example npm run build), then start the preview again.`;
}

/** The `build-required` copy when no Build and start action is available. */
export const QAAP_PREVIEW_BUILD_REQUIRED_MESSAGE = formatQaapPreviewBuildRequiredMessage(false);

/**
 * A preview whose command chains an opted-in build (`npm run build && npm run start`) failed.
 * Every retry would rerun the whole build, so the failure is final and says so: an out-of-memory
 * build is reported as such, any other exit quotes the useful line. Diagnoses that are not about the
 * process itself (dependencies, environment, …) keep their own message.
 */
export function diagnoseBuildFirstPreviewFailure(
    diagnosis: QaapBootstrapFailureDiagnosis,
    buildScript: string,
    origin: 'preview-config' | 'build-and-start' = 'preview-config',
): QaapBootstrapFailureDiagnosis {
    const noRetry = 'Qaap does not retry builds automatically.';
    const userStarted = origin === 'build-and-start';
    if (diagnosis.kind === 'out-of-memory') {
        return {
            kind: 'out-of-memory',
            message: userStarted
                ? `The \`${buildScript}\` step started by Build and start ran out of memory and was stopped. ${noRetry} `
                    + 'Build with more memory or a narrower build in a terminal, then start the preview again.'
                : `The \`${buildScript}\` step that runs before the preview ran out of memory and was stopped. ${noRetry} `
                    + 'Build with more memory or a narrower build in a terminal, or remove "build": "auto" from .qaap/preview.json, then start the preview again.',
        };
    }
    if (diagnosis.kind === 'process-exit' || diagnosis.kind === 'unknown') {
        return {
            kind: 'build-failed',
            message: userStarted
                ? `The \`${buildScript}\` step started by Build and start failed: ${diagnosis.message} `
                    + `${noRetry} Fix the error, then choose Build and start again.`
                : `The preview runs \`${buildScript}\` first (opted in via .qaap/preview.json) and it failed: ${diagnosis.message} `
                    + `${noRetry} Fix the error, then start the preview again.`,
        };
    }
    return diagnosis;
}

export function terminalOutputNeedsInstall(output: string): boolean {
    if (terminalOutputNeedsBuild(output)) {
        return false;
    }
    const missingBinary = terminalOutputMissingBinary(output);
    return (missingBinary !== undefined && !isSystemBinary(missingBinary)) || DEV_INSTALL_NEEDED_REGEX.test(output);
}

/** The executable a script could not find (`theia` for `sh: 1: theia: not found`). */
export function terminalOutputMissingBinary(output: string): string | undefined {
    return MISSING_SCRIPT_BINARY_REGEX.exec(output.replace(ANSI_REGEX, ''))?.[1];
}

/** Whether a missing executable is a system tool that install cannot provide. */
export function isSystemBinary(binary: string): boolean {
    // `python3.12` is `python3`'s versioned alias.
    return SYSTEM_BINARIES.has(binary) || SYSTEM_BINARIES.has(binary.replace(/\.[\d.]+$/, ''));
}

/** Whether the output shows the project's own compiled output is missing (needs a build, not an install). */
export function terminalOutputNeedsBuild(output: string): boolean {
    const clean = output.replace(ANSI_REGEX, '');
    if (clean.includes(QAAP_PREVIEW_BUILD_REQUIRED_LEAD)) {
        return true;
    }
    for (const match of clean.matchAll(CANNOT_FIND_MODULE_REGEX)) {
        if (isMissingBuildOutputPath(match[1])) {
            return true;
        }
    }
    return false;
}

export function terminalOutputOutOfMemory(output: string): boolean {
    return OUT_OF_MEMORY_REGEX.test(output.replace(ANSI_REGEX, ''));
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
    // Some CLIs omit the scheme in their startup line (`Local: localhost:5173`). The scanner
    // can still probe this port through Qaap's backend proxy and discover the canonical URL.
    for (const match of clean.matchAll(DEV_OUTPUT_HOST_PORT_REGEX)) {
        ports.push(Number(match[1]));
    }
    return [...new Set(ports.filter(p => Number.isFinite(p) && p > 0 && p < 65536))];
}

export function isTerminalDoesNotExistError(message: string): boolean {
    return /terminal "[\d]+" does not exist/i.test(message);
}

/**
 * Output whose line breaks arrived as literal `\n` escapes (JSON-encoded or double-escaped
 * terminal text) is one long line; restore real line breaks so it is quoted line by line.
 * Text that already has real line breaks is left alone (`C:\new` in a Windows path stays intact).
 */
export function restoreEscapedLineBreaks(output: string): string {
    if (/[\r\n]/.test(output) || !/\\n/.test(output)) {
        return output;
    }
    return output.replace(/(?:\\r)?\\n/g, '\n');
}

function lastUsefulErrorLine(output: string): string | undefined {
    const clean = restoreEscapedLineBreaks(output.replace(ANSI_REGEX, ''));
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
    if (terminalOutputOutOfMemory(output)) {
        return {
            kind: 'out-of-memory',
            message: 'The dev server ran out of memory and was stopped. Raise the workspace memory limit or use a lighter '
                + 'dev mode (for example Next.js with Turbopack instead of --webpack), then retry.',
        };
    }
    if (terminalOutputNeedsBuild(output)) {
        return {
            kind: 'build-required',
            message: QAAP_PREVIEW_BUILD_REQUIRED_MESSAGE,
        };
    }
    const missingBinary = terminalOutputMissingBinary(output);
    if (missingBinary && isSystemBinary(missingBinary)) {
        return {
            kind: 'runtime-version',
            message: `\`${missingBinary}\` is not available in the workspace environment. Installing dependencies cannot add it: `
                + 'install it in the workspace image or change the script to use an available executable.',
        };
    }
    if (missingBinary) {
        return {
            kind: 'dependencies',
            message: `The \`${missingBinary}\` command is not installed. In a monorepo it is installed at the workspace root, `
                + 'so run Install there (Try again does it automatically), then retry the preview.',
        };
    }
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

/** How many output lines a "dev command exited" error quotes. */
export const DEV_EXIT_OUTPUT_LINES = 12;

/** The last non-empty lines of dev output, without ANSI escapes. */
export function lastDevOutputLines(output: string, maxLines: number = DEV_EXIT_OUTPUT_LINES): string {
    return restoreEscapedLineBreaks(output.replace(ANSI_REGEX, ''))
        .split(/\r?\n|\r/)
        .map(line => line.trimEnd())
        .filter(line => line.trim().length > 0)
        .slice(-maxLines)
        .join('\n');
}

export interface QaapDevProcessExitReport {
    readonly message: string;
    /** Exit code 0 before the preview answered: retrying the same command cannot help. */
    readonly exitedWithoutListening: boolean;
}

/**
 * The failure to report when the dev process exits while the preview is still starting. A clean
 * exit is the silent case (a `theia start` that lost its port, a build-only script): name the port
 * it never listened on and quote its last lines instead of a generic "finished" message.
 */
export function describeDevProcessExit(code: number | undefined, output: string, port?: number): QaapDevProcessExitReport {
    if (code !== 0) {
        return {
            message: output || nls.localize(
                'qaap/projectBootstrap/devServerExited',
                'Dev server exited with code {0}.',
                String(code ?? '?'),
            ),
            exitedWithoutListening: false,
        };
    }
    const summary = port !== undefined
        ? nls.localize(
            'qaap/projectBootstrap/devExitedWithoutListeningOnPort',
            'The dev command exited with code 0 without listening on port {0}.',
            String(port),
        )
        : nls.localize(
            'qaap/projectBootstrap/devExitedWithoutListening',
            'The dev command exited with code 0 before the preview server started listening.',
        );
    const lines = lastDevOutputLines(output);
    return {
        message: lines
            ? `${summary}\n${nls.localize('qaap/projectBootstrap/devExitLastOutput', 'Last output:')}\n${lines}`
            : `${summary} ${nls.localize(
                'qaap/projectBootstrap/devExitNoOutput',
                'It printed no output. Check that the script starts a server and honors PORT or --port.',
            )}`,
        exitedWithoutListening: true,
    };
}
