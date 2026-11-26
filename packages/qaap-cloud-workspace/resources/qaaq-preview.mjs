#!/usr/bin/env node
// Qaap agent preview CLI fallback (`qaaq-preview`): used by harnesses without an MCP transport (Cursor,
// native non-ACP Copilot/Antigravity, etc.). Dependency-free (Node >= 22 built-ins only) so it runs from
// `resources/` or a task sandbox's shared directory without workspace node_modules.
//
// Credentials come from QAAP_PREVIEW_URL + QAAP_PREVIEW_TOKEN_FILE (0600 file; never a raw token in env).
// Exit codes: 0 ready/ok, 2 failed/exited/error, 3 still starting (follow up with `qaaq-preview wait`).

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Protocol constants duplicated from qaap-shared-core/src/common/qaap-agent-preview-protocol.ts
// and qaap-cloud-workspace/src/common/qaap-agent-delegation-protocol.ts (pinned by qaaq-preview.spec.ts).
export const PREVIEW_API_PATH = '/qaap/api/agent-preview';
export const PREVIEW_TOKEN_HEADER = 'x-qaap-delegation-token';
export const PREVIEW_URL_ENV = 'QAAP_PREVIEW_URL';
export const PREVIEW_TOKEN_FILE_ENV = 'QAAP_PREVIEW_TOKEN_FILE';
export const PREVIEW_DEFAULT_TIMEOUT_SEC = 25;
export const PREVIEW_EXIT_READY = 0;
export const PREVIEW_EXIT_FAILED = 2;
export const PREVIEW_EXIT_STARTING = 3;
export const PREVIEW_ROUTES = Object.freeze({
    start: '/start',
    status: '/status',
    logs: '/logs',
    stop: '/stop',
    restart: '/restart',
    snapshot: '/snapshot',
});

const USAGE = [
    'Usage: qaaq-preview <command> [options]',
    '',
    'Commands:',
    '  start    [--cwd <dir>] [--script <name>] [--port <n>] [--ready-path </path>] [--timeout <sec>] [--restart] [-- <argv...>]',
    '  wait     [--timeout <sec>]                  Wait for a starting preview (default 25s)',
    '  status   [--wait <sec>]                     Inspect preview status',
    '  logs     [--lines <n>] [--stream all|stdout|stderr] [--grep <text>]',
    '  restart  [--cwd <dir>] [--script <name>] [--port <n>] [--ready-path </path>] [--timeout <sec>] [-- <argv...>]',
    '  stop                                        Stop the running preview',
    '  snapshot [--path </path>] [--viewport desktop|mobile] [--wait-ms <n>] [--screenshot]',
    '',
    'Exit codes: 0 ready/ok, 2 failed/exited/error, 3 still starting (run `qaaq-preview wait`).',
].join('\n');

function parsePositiveInt(raw, flag) {
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 0) {
        throw new Error(`${flag} expects a non-negative integer, got "${raw}".`);
    }
    return num;
}

/** Parses CLI argv (excluding node + script path) into `{ operation, body, includeImage }` or `{ help: true }`. */
export function parsePreviewCliArgs(argv) {
    const args = Array.isArray(argv) ? [...argv] : [];
    const cmd = args.shift();
    if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
        return { help: true };
    }
    let operation = cmd;
    const body = {};
    let includeImage = false;
    let passthroughArgv;
    const sep = args.indexOf('--');
    if (sep >= 0) {
        passthroughArgv = args.slice(sep + 1);
        args.splice(sep);
    }

    const takeValue = (index, flag) => {
        if (index + 1 >= args.length) {
            throw new Error(`Missing value for ${flag}.`);
        }
        return args[index + 1];
    };

    if (cmd === 'wait') {
        operation = 'status';
        body.waitSec = PREVIEW_DEFAULT_TIMEOUT_SEC;
    } else if (cmd === 'start' || cmd === 'restart') {
        body.timeoutSec = PREVIEW_DEFAULT_TIMEOUT_SEC;
    }

    if (!Object.prototype.hasOwnProperty.call(PREVIEW_ROUTES, operation)) {
        throw new Error(`Unknown command "${cmd}". Expected start, wait, status, logs, restart, stop, or snapshot.`);
    }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            return { help: true };
        }
        if ((operation === 'start' || operation === 'restart') && arg === '--cwd') {
            body.cwd = takeValue(i++, arg);
        } else if ((operation === 'start' || operation === 'restart') && arg === '--script') {
            body.script = takeValue(i++, arg);
        } else if ((operation === 'start' || operation === 'restart') && arg === '--port') {
            body.port = parsePositiveInt(takeValue(i++, arg), arg);
        } else if ((operation === 'start' || operation === 'restart') && arg === '--ready-path') {
            body.readyPath = takeValue(i++, arg);
        } else if ((operation === 'start' || operation === 'restart') && arg === '--timeout') {
            body.timeoutSec = parsePositiveInt(takeValue(i++, arg), arg);
        } else if (operation === 'start' && arg === '--restart') {
            body.restart = true;
        } else if (operation === 'status' && (arg === '--wait' || arg === '--timeout')) {
            body.waitSec = parsePositiveInt(takeValue(i++, arg), arg);
        } else if (operation === 'logs' && arg === '--lines') {
            body.lines = parsePositiveInt(takeValue(i++, arg), arg);
        } else if (operation === 'logs' && arg === '--stream') {
            body.stream = takeValue(i++, arg);
        } else if (operation === 'logs' && arg === '--grep') {
            body.grep = takeValue(i++, arg);
        } else if (operation === 'snapshot' && arg === '--path') {
            body.path = takeValue(i++, arg);
        } else if (operation === 'snapshot' && arg === '--viewport') {
            body.viewport = takeValue(i++, arg);
        } else if (operation === 'snapshot' && arg === '--wait-ms') {
            body.waitMs = parsePositiveInt(takeValue(i++, arg), arg);
        } else if (operation === 'snapshot' && arg === '--screenshot') {
            body.screenshot = true;
            includeImage = true;
        } else if (operation === 'snapshot' && arg === '--full-page') {
            body.fullPage = true;
        } else {
            throw new Error(`Unknown option "${arg}" for "${cmd}".`);
        }
    }

    if (passthroughArgv && passthroughArgv.length > 0) {
        if (operation !== 'start' && operation !== 'restart') {
            throw new Error(`Extra argv after "--" is only valid for start and restart.`);
        }
        body.argv = passthroughArgv;
    }

    return { help: false, command: cmd, operation, body, includeImage };
}

function loadConfig(env) {
    const baseUrl = (env[PREVIEW_URL_ENV] || '').trim().replace(/\/+$/, '');
    const tokenFile = (env[PREVIEW_TOKEN_FILE_ENV] || '').trim();
    if (!baseUrl || !tokenFile) {
        throw new Error(`Missing ${PREVIEW_URL_ENV} or ${PREVIEW_TOKEN_FILE_ENV}; qaaq-preview must be run inside a Qaap agent turn.`);
    }
    const token = readFileSync(tokenFile, 'utf8').trim();
    if (!token) {
        throw new Error('Preview token file is empty.');
    }
    return { baseUrl, token };
}

/** Runs one CLI invocation and returns `{ exitCode, stdout, stderr }`. Testable without spawning. */
export async function runPreviewCli(argv, options = {}) {
    const env = options.env ?? process.env;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    let parsed;
    try {
        parsed = parsePreviewCliArgs(argv);
    } catch (error) {
        return {
            exitCode: PREVIEW_EXIT_FAILED,
            stdout: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
            stderr: '',
        };
    }
    if (parsed.help) {
        return { exitCode: PREVIEW_EXIT_READY, stdout: USAGE, stderr: '' };
    }
    let config;
    try {
        config = loadConfig(env);
    } catch (error) {
        return {
            exitCode: PREVIEW_EXIT_FAILED,
            stdout: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
            stderr: '',
        };
    }
    const route = PREVIEW_ROUTES[parsed.operation];
    const url = `${config.baseUrl}${PREVIEW_API_PATH}${route}`;
    const waitBudgetSec = typeof parsed.body.timeoutSec === 'number'
        ? parsed.body.timeoutSec
        : (typeof parsed.body.waitSec === 'number' ? parsed.body.waitSec : 60);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (waitBudgetSec + 30) * 1000);
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                [PREVIEW_TOKEN_HEADER]: config.token,
            },
            body: JSON.stringify(parsed.body),
            signal: controller.signal,
        });
        const text = await response.text();
        let payload;
        try {
            payload = text ? JSON.parse(text) : {};
        } catch {
            payload = { raw: text };
        }
        if (!response.ok) {
            return {
                exitCode: PREVIEW_EXIT_FAILED,
                stdout: JSON.stringify({
                    error: typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`,
                    ...(typeof payload?.code === 'string' ? { code: payload.code } : {}),
                }, null, 2),
                stderr: '',
            };
        }
        if (parsed.operation === 'snapshot' && !parsed.includeImage && payload && typeof payload === 'object' && 'image' in payload) {
            const { image: _omitted, ...rest } = payload;
            payload = rest;
        }
        if (parsed.operation === 'start' || parsed.operation === 'restart' || parsed.operation === 'status') {
            const status = payload?.status;
            if (status === 'starting') {
                return {
                    exitCode: PREVIEW_EXIT_STARTING,
                    stdout: JSON.stringify({ ...payload, nextCommand: 'qaaq-preview wait' }, null, 2),
                    stderr: '',
                };
            }
            if (status === 'failed' || status === 'exited') {
                return {
                    exitCode: PREVIEW_EXIT_FAILED,
                    stdout: JSON.stringify(payload, null, 2),
                    stderr: '',
                };
            }
        }
        return {
            exitCode: PREVIEW_EXIT_READY,
            stdout: JSON.stringify(payload, null, 2),
            stderr: '',
        };
    } catch (error) {
        const message = controller.signal.aborted
            ? 'qaaq-preview timed out waiting for the Qaap backend.'
            : `qaaq-preview could not reach the Qaap backend: ${error instanceof Error ? error.message : String(error)}`;
        return {
            exitCode: PREVIEW_EXIT_FAILED,
            stdout: JSON.stringify({ error: message }, null, 2),
            stderr: '',
        };
    } finally {
        clearTimeout(timer);
    }
}

function isEntrypoint() {
    if (!process.argv[1]) {
        return false;
    }
    try {
        return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isEntrypoint()) {
    runPreviewCli(process.argv.slice(2)).then(result => {
        if (result.stdout) {
            process.stdout.write(`${result.stdout}\n`);
        }
        if (result.stderr) {
            process.stderr.write(`${result.stderr}\n`);
        }
        process.exit(result.exitCode);
    });
}
