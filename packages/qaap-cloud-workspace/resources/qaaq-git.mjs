#!/usr/bin/env node
// Qaap sealed agent git CLI (`qaaq-git`): lets agents push feature branches and open GitHub pull
// requests through the Qaap backend (`QaapHostedGitPush`) without ever exposing the user's GitHub
// OAuth token to agent processes (see doc/qaap-github-token-boundary.md).
//
// Dependency-free (Node >= 22 built-ins only) so it runs from `resources/` or a task sandbox's
// shared directory without workspace node_modules.
//
// Credentials come from QAAP_GIT_URL + QAAP_GIT_TOKEN_FILE (0600 file; never a raw token in env).
// Exit codes: 0 ok, 2 error.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GIT_API_PATH = '/qaap/api/agent-git';
export const GIT_TOKEN_HEADER = 'x-qaap-git-token';
export const GIT_URL_ENV = 'QAAP_GIT_URL';
export const GIT_TOKEN_FILE_ENV = 'QAAP_GIT_TOKEN_FILE';
export const GIT_EXIT_OK = 0;
export const GIT_EXIT_ERROR = 2;
export const GIT_ROUTES = Object.freeze({
    push: '/push',
    pr: '/pr',
});

const USAGE = [
    'Usage: qaaq-git <command> [options]',
    '',
    'Commands:',
    '  push                                           Push the current non-default feature branch to GitHub',
    '  pr create --title <text> [--body <text>] [--body-file <path>] [--base <branch>] [--draft] [--no-push]',
    '                                                 Push the current feature branch and open a GitHub pull request',
    '',
    'Security: GitHub credentials stay sealed on the Qaap backend; pushing to main/master or the',
    'default branch and force-pushing are refused.',
].join('\n');

/** Parses CLI argv (excluding node + script path) into `{ operation, body }` or `{ help: true }`. */
export function parseGitCliArgs(argv) {
    const args = Array.isArray(argv) ? [...argv] : [];
    const cmd = args.shift();
    if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
        return { help: true };
    }
    const takeValue = (list, index, flag) => {
        if (index + 1 >= list.length) {
            throw new Error(`Missing value for ${flag}.`);
        }
        return list[index + 1];
    };
    if (cmd === 'push') {
        for (const arg of args) {
            if (arg === '--help' || arg === '-h') {
                return { help: true };
            }
            if (arg === '--force' || arg === '-f' || arg === '--force-with-lease') {
                throw new Error('Force-push is not supported by qaaq-git.');
            }
            if (arg === '--delete' || arg === '-d') {
                throw new Error('Deleting remote branches is not supported by qaaq-git.');
            }
            throw new Error(`Unexpected argument "${arg}" for qaaq-git push. Push always targets the current local branch.`);
        }
        return { operation: 'push', body: {} };
    }
    if (cmd === 'pr') {
        const sub = args.shift();
        if (!sub || sub === '--help' || sub === '-h') {
            return { help: true };
        }
        if (sub !== 'create') {
            throw new Error(`Unknown pr subcommand "${sub}". Expected "create".`);
        }
        const body = { body: '', draft: false, push: true };
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg === '--help' || arg === '-h') {
                return { help: true };
            }
            if (arg === '--title' || arg === '-t') {
                body.title = takeValue(args, i++, arg);
            } else if (arg === '--body' || arg === '-b') {
                body.body = takeValue(args, i++, arg);
            } else if (arg === '--body-file' || arg === '-F') {
                const filePath = takeValue(args, i++, arg);
                body.body = readFileSync(filePath, 'utf8');
            } else if (arg === '--base' || arg === '-B') {
                body.base = takeValue(args, i++, arg);
            } else if (arg === '--draft') {
                body.draft = true;
            } else if (arg === '--no-push') {
                body.push = false;
            } else {
                throw new Error(`Unknown option "${arg}" for qaaq-git pr create.`);
            }
        }
        if (!body.title || !body.title.trim()) {
            throw new Error('qaaq-git pr create requires --title <text>.');
        }
        return { operation: 'pr', body };
    }
    throw new Error(`Unknown command "${cmd}". Expected "push" or "pr create".`);
}

function readCredentials(env) {
    const baseUrl = (env[GIT_URL_ENV] || '').trim().replace(/\/+$/, '');
    const tokenFile = (env[GIT_TOKEN_FILE_ENV] || '').trim();
    if (!baseUrl || !tokenFile) {
        throw new Error(`Missing ${GIT_URL_ENV} or ${GIT_TOKEN_FILE_ENV}. Run qaaq-git inside a Qaap agent turn.`);
    }
    const token = readFileSync(tokenFile, 'utf8').trim();
    if (!token) {
        throw new Error(`Empty token file at ${tokenFile}.`);
    }
    return { baseUrl, token };
}

/** Executes one CLI invocation and returns `{ exitCode, stdout, stderr }` (injectable for tests). */
export async function runGitCli(argv, deps = {}) {
    const env = deps.env ?? process.env;
    const fetchImpl = deps.fetch ?? globalThis.fetch;
    let parsed;
    try {
        parsed = parseGitCliArgs(argv);
    } catch (error) {
        return {
            exitCode: GIT_EXIT_ERROR,
            stdout: '',
            stderr: `qaaq-git: ${error instanceof Error ? error.message : String(error)}\n`,
        };
    }
    if (parsed.help) {
        return { exitCode: GIT_EXIT_OK, stdout: `${USAGE}\n`, stderr: '' };
    }
    let creds;
    try {
        creds = readCredentials(env);
    } catch (error) {
        return {
            exitCode: GIT_EXIT_ERROR,
            stdout: '',
            stderr: `qaaq-git: ${error instanceof Error ? error.message : String(error)}\n`,
        };
    }
    const route = GIT_ROUTES[parsed.operation];
    const url = `${creds.baseUrl}${GIT_API_PATH}${route}`;
    let response;
    let text = '';
    try {
        response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [GIT_TOKEN_HEADER]: creds.token,
            },
            body: JSON.stringify(parsed.body),
        });
        text = await response.text();
    } catch (error) {
        return {
            exitCode: GIT_EXIT_ERROR,
            stdout: '',
            stderr: `qaaq-git: request failed (${error instanceof Error ? error.message : String(error)})\n`,
        };
    }
    let payload;
    try {
        payload = text ? JSON.parse(text) : {};
    } catch {
        payload = { error: text || `HTTP ${response.status}` };
    }
    if (!response.ok) {
        const message = typeof payload?.error === 'string' && payload.error.trim()
            ? payload.error.trim()
            : `HTTP ${response.status}`;
        return {
            exitCode: GIT_EXIT_ERROR,
            stdout: '',
            stderr: `qaaq-git: ${message}\n`,
        };
    }
    return {
        exitCode: GIT_EXIT_OK,
        stdout: `${JSON.stringify(payload, null, 2)}\n`,
        stderr: '',
    };
}

function isDirectEntry() {
    if (!process.argv[1]) {
        return false;
    }
    try {
        return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
    } catch {
        return false;
    }
}

if (isDirectEntry()) {
    const result = await runGitCli(process.argv.slice(2));
    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }
    process.exit(result.exitCode);
}
