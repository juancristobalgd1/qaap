// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure + DI helpers extracted from QaapAgentTaskRunner (batch 3).

import { execFileKillingGroup, killProcessGroup } from './qaap-exec-file-group';
import { spawnSync, type ChildProcess, type SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { nls } from '@theia/core/lib/common/nls';
import { agentProcessIdentityOf, signalAgentProcess } from './qaap-agent-process-signal';
import {
    extractRetrievalKeywords,
    formatRelevantFilesHint,
} from '../common/qaap-agent-retrieval';
import {
    QAAP_BUILTIN_AGENT_DEFINITIONS,
    isUiHiddenVpsAgent,
} from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import type { QaapTurnLatencyMark } from '@theia/qaap-shared-core/lib/common/qaap-agent-stream-metrics';
import type { QaapAgentTask, QaapAgentDescriptor, QaapAgentConnectionState, QaapAgentTaskReview, QaapAgentTaskVerification, QaapAgentTaskVerificationPhase, QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task';
import { resolveTaskAgentModel } from '../common/qaap-agent-task';
import {
    classifyVerificationFailureScope,
    findChangesExceedingScopeLimit,
    findChangesSinceBaseline,
    findOutOfScopeChanges,
    isDocsOnlyVerificationScope,
    isPerFileVerificationScript,
    resolveAgentTaskChangedFilesLimit,
    type QaapWorktreeChange,
} from '../common/qaap-verification-scope';
import {
    buildAgentReviewPrompt,
    groundAgentReviewVerdict,
    parseAgentReviewVerdict,
    parseGitNumstat,
    resolveAgentReviewMode,
    resolveTaskReviewRisk,
} from '../common/qaap-agent-review';
import type { QaapGenericCommandResult } from './qaap-agent-task-runner';
import type { AgentCandidate } from './qaap-agent-task-runner-types';
import {
    quoteShellArg,
    removeAgentPromptTempDir,
    type QaapAgentStdinPromptMode,
} from './qaap-agent-task-runner-utils';
import { extractImprovedComposerPromptFromAgentStdout } from '@theia/qaap-composer/lib/common/qaap-composer-prompt-improve';
import { childProcessEnv } from './qaap-child-process-env';

const AGENT_CANDIDATES: readonly AgentCandidate[] = QAAP_BUILTIN_AGENT_DEFINITIONS;
const QAAP_AGENT_RETRIEVAL_ENABLED = !/^(0|false|off)$/i.test(process.env.QAAP_AGENT_RETRIEVAL?.trim() ?? '');
const RETRIEVAL_MAX_FILES = 5;
const RETRIEVAL_HINT_MAX_CHARS = 400;
const REPO_MAP_EXCLUDED_DIRS = new Set<string>([
    'node_modules', '.git', 'dist', 'build', 'out',
    '.next', '.nuxt', '.output', '.svelte-kit',
    'coverage', '.nyc_output', '.cache', '.turbo',
]);
const SHELL_AGENT_ID = 'shell';
const ENV_AGENT_ID = 'env';

/** Bounded read-only process seam; hosted callers execute the search inside the tenant worker. */
export type QaapReadProcessSync = (cwd: string, file: string, args: readonly string[], maxBuffer: number) => SpawnSyncReturns<string>;

// ─── Pure: readRelevantFiles ─────────────────────────────────────────────────

export function readRelevantFiles(cwd: string, userQuery: string | undefined, readProcess: QaapReadProcessSync = (root, file, args, maxBuffer) => spawnSync(file, args, { cwd: root, encoding: 'utf8', timeout: 4000, maxBuffer })): string | undefined {
    if (!QAAP_AGENT_RETRIEVAL_ENABLED) {
        return undefined;
    }
    const keywords = extractRetrievalKeywords(userQuery);
    if (keywords.length === 0) {
        return undefined;
    }
    try {
        // Case-insensitive, files-with-matches, count per file so we can rank by hit count.
        // Exclude the hygiene dirs; -g globs keep it scoped to source.
        const pattern = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const args = ['--count-matches', '--no-messages', '-i', '-e', pattern, '--max-count', '50'];
        for (const dir of REPO_MAP_EXCLUDED_DIRS) {
            args.push('-g', `!${dir}/**`);
        }
        args.push('--', '.');
        const out = readProcess(cwd, 'rg', args, 4 * 1024 * 1024);
        if (out.status !== 0 && out.status !== 1 || !out.stdout) {
            return undefined; // status 1 = no matches; other non-zero = rg missing/error
        }
        const ranked: Array<{ file: string; hits: number }> = [];
        for (const line of out.stdout.split('\n')) {
            const sep = line.lastIndexOf(':');
            if (sep <= 0) {
                continue;
            }
            const file = line.slice(0, sep).replace(/^\.\//, '');
            const hits = Number.parseInt(line.slice(sep + 1), 10);
            if (file && Number.isFinite(hits)) {
                ranked.push({ file, hits });
            }
        }
        ranked.sort((a, b) => b.hits - a.hits);
        return formatRelevantFilesHint(ranked.slice(0, RETRIEVAL_MAX_FILES).map(r => r.file), RETRIEVAL_HINT_MAX_CHARS);
    } catch {
        return undefined;
    }
}

// ─── Pure: reapAgentProcessGroupAfterExit ────────────────────────────────────

export function reapAgentProcessGroupAfterExit(child: ChildProcess): void {
    const pid = child.pid;
    if (!pid) {
        return;
    }
    if (globalThis.process.platform === 'win32') {
        try {
            spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } catch {
            /* already gone */
        }
        return;
    }
    // ESRCH is the common clean case: the agent left no descendants behind.
    if (signalAgentProcess(-pid, 'SIGKILL', agentProcessIdentityOf(child)) === 'failed') {
        console.warn(`[qaap-agent] could not reap the process group ${pid}: its descendants may still be running`);
    }
}

// ─── DI: resolveProjectName ──────────────────────────────────────────────────

export function resolveProjectName(cwd: string, projectNameCache: Map<string, string>): string {
    const cached = projectNameCache.get(cwd);
    if (cached !== undefined) {
        return cached;
    }
    let name = path.basename(cwd) || cwd;
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { name?: unknown };
        if (typeof manifest.name === 'string' && manifest.name.trim()) {
            name = manifest.name.trim();
        }
    } catch {
        /* no package.json — fall back to basename */
    }
    projectNameCache.set(cwd, name);
    return name;
}

// ─── DI: listAgents ──────────────────────────────────────────────────────────

export function listAgents(detectedAgents: Map<string, AgentCandidate>): QaapAgentDescriptor[] {
    const result: QaapAgentDescriptor[] = [];
    for (const candidate of AGENT_CANDIDATES) {
        if (detectedAgents.has(candidate.id)) {
            result.push({ id: candidate.id, label: candidate.label, available: true });
        }
    }
    for (const [, candidate] of detectedAgents) {
        if (!AGENT_CANDIDATES.some(builtIn => builtIn.id === candidate.id)) {
            result.push({ id: candidate.id, label: candidate.label, available: true });
        }
    }
    if (process.env.QAAP_AGENT_COMMAND?.trim()) {
        result.push({ id: ENV_AGENT_ID, label: 'Custom (QAAP_AGENT_COMMAND)', available: true });
    }
    result.push({ id: SHELL_AGENT_ID, label: 'Shell command', available: true });
    return result.filter(agent => !isUiHiddenVpsAgent(agent.id));
}

// ─── DI: probeAgentBinOnce ───────────────────────────────────────────────────

/** Boot-time `<cli> --version` probes never wait longer than this; a miss is logged once and the boot goes on. */
const AGENT_BIN_VERSION_PROBE_TIMEOUT_MS = 5_000;

export function probeAgentBinOnce(
    agentId: string,
    resolveBin: () => string | undefined,
    probedAgentBins: Set<string>,
): boolean {
    if (probedAgentBins.has(agentId)) {
        return true;
    }
    const bin = resolveBin();
    if (!bin) {
        return false;
    }
    // Diagnostic only (the answer is never used): asynchronous, so a slow CLI (`qaiq --version` boots a Node CLI in
    // 2-3.5 s) no longer blocks the backend event loop for every request behind it.
    probedAgentBins.add(agentId);
    try {
        execFileKillingGroup(bin, ['--version'], { timeoutMs: AGENT_BIN_VERSION_PROBE_TIMEOUT_MS, lowPriority: true }, error => {
            if (error) {
                console.warn(`[qaap-agent-tasks] ${agentId} --version probe failed: ${error.message}`);
            }
        });
    } catch {
        // A missing binary is reported by the regular detection; nothing to log here.
    }
    return true;
}

/**
 * Probe the authentication state that belongs to the current tenant user. Installation is not
 * enough for a hosted picker: Codex can be present on PATH while its per-user login is absent.
 * Keep this intentionally small and read-only; the Connect action remains responsible for login.
 */
export interface QaapAgentConnectionProbeOptions {
    readonly file?: string;
    readonly args?: readonly string[];
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    /** Probe timeout; defaults to {@link QAAP_AGENT_CONNECTION_PROBE_TIMEOUT_MS} (specs shorten it). */
    readonly timeoutMs?: number;
}

/**
 * Only QAIQ authenticates with Settings API keys. Every other harness signs in with its own CLI
 * (OpenClaude, Hermes and Gemini/Antigravity included) and reports its state through an auth probe.
 */
const SETTINGS_CREDENTIAL_PREFS_BY_AGENT: Readonly<Record<string, readonly string[]>> = {
    qaiq: [
        'ai-features.openAiOfficial.openAiApiKey',
        'ai-features.anthropic.AnthropicApiKey',
        'ai-features.google.apiKey',
        'ai-features.openrouter.openrouterApiKey',
        'ai-features.nvidia.nvidiaApiKey',
        'ai-features.huggingFace.apiKey',
        'ai-features.openAiCustom.customOpenAiApiKey',
    ],
};

/** Provider credentials that the background task runner actually injects for Settings-backed harnesses. */
export function hasAgentSettingsCredentials(agentId: string, readPreference: (key: string) => unknown): boolean | undefined {
    const preferences = SETTINGS_CREDENTIAL_PREFS_BY_AGENT[agentId.trim().toLowerCase()];
    if (!preferences) {
        return undefined;
    }
    return preferences.some(key => {
        const value = readPreference(key);
        return typeof value === 'string' && value.trim().length > 0;
    });
}

/**
 * API-key variables a sign-in-only harness must never receive. Product rule: only QAIQ runs on an
 * API key. Codex prefers `OPENAI_API_KEY`/`CODEX_API_KEY` over its ChatGPT sign-in, so an inherited
 * or Settings key turned every turn into "401 Incorrect API key provided" instead of a sign-in.
 */
export const SIGN_IN_ONLY_AGENT_API_KEY_ENV: Readonly<Record<string, readonly string[]>> = {
    codex: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'],
    // Claude Code prefers an inherited key or token over its own sign-in, so signing out of Claude in
    // Settings → Harness left it signed in whenever the app was started from a shell that exports one.
    claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
};

/** Harness id of a task: its agent id, or `codex` for a legacy task whose command runs the Codex CLI. */
export function resolveTaskHarnessId(agentId: string | undefined, command: string | undefined): string | undefined {
    const normalized = agentId?.trim().toLowerCase();
    if (normalized) {
        return normalized;
    }
    return /^\s*(?:\S*\/)?codex(?:\s|$)/.test(command ?? '') ? 'codex' : undefined;
}

/** Deletes the API-key variables of a sign-in-only harness ({@link SIGN_IN_ONLY_AGENT_API_KEY_ENV}) in place. */
export function stripSignInOnlyAgentApiKeyEnv(env: NodeJS.ProcessEnv, agentId: string | undefined): NodeJS.ProcessEnv {
    const keys = SIGN_IN_ONLY_AGENT_API_KEY_ENV[agentId?.trim().toLowerCase() ?? ''];
    if (keys) {
        for (const key of Object.keys(env)) {
            if (keys.includes(key.toUpperCase())) {
                delete env[key];
            }
        }
    }
    return env;
}

/** CLI commands whose exit/output can safely report an authentication state. */
export function resolveAgentConnectionProbeArgs(agentId: string): readonly string[] | undefined {
    switch (agentId.trim().toLowerCase()) {
        case 'codex':
            return ['login', 'status'];
        case 'claude':
        case 'openclaude':
            // `{"loggedIn": true|false, …}`; exits 1 when signed out.
            return ['auth', 'status'];
        case 'cursor':
            return ['status'];
        case 'opencode':
            return ['auth', 'list'];
        case 'hermes':
            // `nous: logged in` / `nous: logged out` (the Nous Portal device-code sign-in).
            return ['auth', 'status', 'nous'];
        default:
            return undefined;
    }
}

/**
 * Gemini CLI has no status command. "Login with Google" stores `~/.gemini/oauth_creds.json`; the
 * Connect command also selects `oauth-personal`, so the file is what makes `gemini -p` usable.
 */
export const GEMINI_CLI_CONNECTION_PROBE_SCRIPT = 'test -s "$HOME/.gemini/oauth_creds.json" && echo "logged in" || echo "not logged in"';

/**
 * Google's Antigravity CLI (`agy`) has no status command, but `agy models` lists the catalog only with a
 * session and prints `Please sign in to view available models` without one. `$1` is the agy executable.
 * Exit 0 with a listing → "logged in"; the sign-in message → "not logged in"; anything else (timeout,
 * other error) prints nothing and exits non-zero, so the probe reads it as unknown. `timeout` is optional
 * (absent on macOS): the probe's own 10 s limit then bounds the run.
 *
 * agy's output goes to a temp file, never to a `$(…)` pipe: a helper process agy leaves running keeps such
 * a pipe (and the probe's own stdout) open after `timeout` killed agy, so the shell and the backend's
 * `execFile` waited for EOF forever and the picker showed "Checking sign-in…" for good. `-k 2` follows the
 * TERM with a KILL for an agy that ignores it.
 */
export const AGY_CLI_CONNECTION_PROBE_SCRIPT = 'T=""; command -v timeout >/dev/null 2>&1 && T="timeout -k 2 20"; '
    + 'f=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/qaap-agy-probe.$$"); '
    + '$T "$1" models >"$f" 2>&1 </dev/null; rc=$?; out=$(cat "$f" 2>/dev/null); rm -f "$f"; '
    + 'case "$out" in *"Please sign in"*) echo "not logged in" ;; *) [ "$rc" -eq 0 ] && echo "logged in" ;; esac';

/**
 * Pi has no provider-agnostic status command (`pi auth check` needs `--provider`). `/login` and
 * API-key logins both store an entry with a `"type"` in `~/.pi/agent/auth.json` (`{}` when empty).
 */
export const PI_CONNECTION_PROBE_SCRIPT = 'f="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/auth.json"; grep -q \'"type"\' "$f" 2>/dev/null && echo "logged in" || echo "not logged in"';

/**
 * Grok CLI has no status subcommand; `grok login` writes OAuth/session credentials into
 * `~/.grok/auth.json`. A non-empty file containing an access/session token or user id proves a
 * signed-in session; its absence reports `"not logged in"`.
 */
export const GROK_CONNECTION_PROBE_SCRIPT = 'f="$HOME/.grok/auth.json"; [ -s "$f" ] && grep -Eq \'"(access_token|refresh_token|token|session_token|api_key|user_id)"[[:space:]]*:[[:space:]]*"[^"]\' "$f" 2>/dev/null && echo "logged in" || echo "not logged in"';

/**
 * Windows counterpart of {@link GROK_CONNECTION_PROBE_SCRIPT}. Windows has no POSIX `sh` to run that script, so
 * the probe runs as PowerShell, which every Windows install ships. Same test and same output phrases: the file is
 * `~/.grok/auth.json` (`USERPROFILE`, or `HOME` when that is missing), and any error reads as `not logged in`.
 * The script is passed as one argv element (no shell) and has no double quotes of its own: the JSON key quotes
 * are written as `\x22`, which the regex reads as `"`.
 */
export const GROK_CONNECTION_PROBE_POWERSHELL = '$ErrorActionPreference = \'Stop\'; $h = $env:USERPROFILE; if (-not $h) { $h = $env:HOME }; '
    + 'try { $f = Join-Path $h \'.grok\\auth.json\'; '
    + 'if ((Test-Path -LiteralPath $f -PathType Leaf) -and ((Get-Item -LiteralPath $f).Length -gt 0) '
    + '-and ((Get-Content -LiteralPath $f -Raw) -cmatch \'\\x22(access_token|refresh_token|token|session_token|api_key|user_id)\\x22\\s*:\\s*\\x22[^\\x22]\')) '
    + '{ Write-Output \'logged in\' } else { Write-Output \'not logged in\' } } '
    + 'catch { Write-Output \'not logged in\' }';

/** Absolute path of the Windows PowerShell that ships with every Windows install (`%SystemRoot%`, else `C:\\Windows`). */
export function resolveWindowsPowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
    const systemRoot = env.SystemRoot?.trim() || env.SYSTEMROOT?.trim() || env.windir?.trim() || 'C:\\Windows';
    return path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * Copilot CLI has no status command. `copilot login` records the account in `~/.copilot/config.json`
 * (`loggedInUsers: [{ host, login, kind }]`; the token itself sits in the OS keychain or, without one, in the same
 * file) and sign-out removes it. A recorded account is a session; its absence is NOT a sign-out (Copilot also runs
 * on `GH_TOKEN` / `gh`), so the script never prints a signed-out phrase and the state stays `unknown` then.
 */
export const COPILOT_CONNECTION_PROBE_SCRIPT = 'f="${COPILOT_HOME:-$HOME/.copilot}/config.json"; '
    + '[ -s "$f" ] && tr -d \' \\t\\r\\n\' < "$f" | grep -Eq \'"(loggedInUsers|logged_in_users)":\\[\\{\' && echo "logged in" || echo "no copilot account recorded"';

/**
 * Codex sign-in check. `codex login status` alone is fooled by a hollow `auth.json`: with
 * `{"OPENAI_API_KEY":null,"tokens":null}` it prints "Logged in using ChatGPT" and exits 0, while every
 * turn then fails ("plan type is required for chatgpt authentication" or "401 Unauthorized: Missing
 * bearer"). So when the file exists it must carry a non-empty ChatGPT token before the CLI's own answer
 * counts; without the file (keyring storage) the CLI decides alone. `$1` is the codex executable.
 */
export const CODEX_CONNECTION_PROBE_SCRIPT = 'f="${CODEX_HOME:-$HOME/.codex}/auth.json"; if [ -f "$f" ] && ! grep -Eq \'"(access_token|refresh_token)"[[:space:]]*:[[:space:]]*"[^"]\' "$f"; then echo "not logged in"; exit 0; fi; exec "$1" login status';

/** Executable + argv that report one harness's sign-in state, for the executable it runs as. */
export function resolveAgentConnectionProbe(agentId: string, bin: string): { readonly file: string; readonly args: readonly string[] } | undefined {
    const normalized = agentId.trim().toLowerCase();
    if (normalized === 'antigravity' || normalized === 'gemini') {
        // The community `antigravity`/`ag` CLI talks to a running Antigravity desktop app and has
        // no sign-in of its own. `agy` (the supported client) and the Gemini CLI fallback can be signed in.
        const base = path.basename(bin);
        if (base === 'agy') {
            return { file: 'sh', args: ['-c', AGY_CLI_CONNECTION_PROBE_SCRIPT, 'agy-probe', bin] };
        }
        return base === 'gemini' ? { file: 'sh', args: ['-c', GEMINI_CLI_CONNECTION_PROBE_SCRIPT] } : undefined;
    }
    if (normalized === 'pi') {
        return { file: 'sh', args: ['-c', PI_CONNECTION_PROBE_SCRIPT] };
    }
    if (normalized === 'copilot' && process.platform !== 'win32') {
        return { file: 'sh', args: ['-c', COPILOT_CONNECTION_PROBE_SCRIPT] };
    }
    if (normalized === 'grok' && process.platform !== 'win32') {
        return { file: 'sh', args: ['-c', GROK_CONNECTION_PROBE_SCRIPT] };
    }
    if (normalized === 'grok' && process.platform === 'win32') {
        // No POSIX shell on Windows: the same check runs in PowerShell, which every Windows install ships. Absolute
        // path: a bare `powershell.exe` is looked up in the cwd first on Windows, where a repo could plant one.
        return { file: resolveWindowsPowerShellPath(), args: ['-NoProfile', '-NonInteractive', '-Command', GROK_CONNECTION_PROBE_POWERSHELL] };
    }
    if (normalized === 'codex' && process.platform !== 'win32') {
        // No POSIX shell on Windows: there the CLI's own `login status` answers alone.
        return { file: 'sh', args: ['-c', CODEX_CONNECTION_PROBE_SCRIPT, 'codex-probe', bin] };
    }
    const args = resolveAgentConnectionProbeArgs(normalized);
    return args ? { file: bin, args } : undefined;
}

/** Interpret only clear auth output; unsupported commands and ambiguous output stay unknown. */
export function classifyAgentConnectionProbe(
    agentId: string,
    status: number | null,
    output: string,
    hasError: boolean,
): QaapAgentConnectionState {
    if (hasError || status === null) {
        return 'unknown';
    }
    const sample = output.toLowerCase();
    // `codex login status` → "Logged in using an API key - sk-…": Codex must run on a ChatGPT
    // sign-in (only QAIQ uses API keys), so an API-key login needs the sign-in flow.
    // codex-cli ≥ 0.16x words the same state "API key configured - ***".
    if (agentId.trim().toLowerCase() === 'codex' && /logged in using an api key|api key configured/.test(sample)) {
        return 'disconnected';
    }
    if (/\"(?:authenticated|isloggedin|loggedin)\"\s*:\s*false/.test(sample)
        || /not logged in|not authenticated|logged out|no active login|no credentials|no providers configured|not connected|no authentication information found|sign in required/.test(sample)) {
        return 'disconnected';
    }
    // Cursor (`status` / `agent login`) that reports a successful login counts as connected even when it adds
    // "unable to fetch user details": the CLI itself says the sign-in succeeded. A turn that later proves the token
    // rejected ("Authentication required. Please run 'agent login' first") still flips the session to disconnected.
    // Checked after the disconnected patterns above, so "Not logged in" never reads as connected.
    if (agentId.trim().toLowerCase() === 'cursor' && status === 0 && /login successful|logged in/.test(sample)) {
        return 'connected';
    }
    // Cursor with no successful-login line and "unable to fetch user details" stays inconclusive: unknown, which the
    // Free/Pro rule locks like a sign-out (fail-closed).
    if (agentId.trim().toLowerCase() === 'cursor' && /unable to fetch user details/.test(sample)) {
        return 'unknown';
    }
    if (status !== 0) {
        return 'unknown';
    }
    if (/\"(?:authenticated|isloggedin|loggedin)\"\s*:\s*true/.test(sample)
        || /logged in|authenticated|credentials configured|active account/.test(sample)) {
        return 'connected';
    }
    if (agentId.trim().toLowerCase() === 'opencode' && /\b0 credentials\b/.test(sample)) {
        // `opencode auth list` exits 0 and prints its table even when nothing is saved.
        return 'disconnected';
    }
    if (agentId.trim().toLowerCase() === 'opencode' && sample.trim().length > 0) {
        // `opencode auth list` reports saved providers as rows without using the word "authenticated".
        return 'connected';
    }
    return 'unknown';
}

/**
 * Upper bound for one CLI auth probe. Claude Code 2.1 is a 245 MB native binary that, behind the
 * tenant wrapper (setpriv/rlimits or `docker exec`), regularly needs more than the former 4 s on a
 * loaded VPS; a timeout only ever yields `unknown`, never a usable answer.
 */
export const QAAP_AGENT_CONNECTION_PROBE_TIMEOUT_MS = 10_000;

/**
 * agy starts a language server for `agy models`: about 2 s alone, but well over 8 s when every harness is probed at
 * once in a CPU-limited tenant (1 CPU on staging, 2 in production), which settled the probe `unknown` and made the
 * pre-spawn guard refuse a signed-in owner with "Sign in to Antigravity CLI" while the composer showed no sign-in
 * prompt (staging, 23 Nov 2026). Its script allows 20 s (`timeout -k 2 20`); the probe itself gets this budget.
 */
export const QAAP_AGY_CONNECTION_PROBE_TIMEOUT_MS = 25_000;

/** The auth probe budget of one harness: agy's is longer (see {@link QAAP_AGY_CONNECTION_PROBE_TIMEOUT_MS}). */
export function resolveAgentConnectionProbeTimeoutMs(agentId: string): number {
    const normalized = agentId.trim().toLowerCase();
    return normalized === 'antigravity' || normalized === 'gemini' ? QAAP_AGY_CONNECTION_PROBE_TIMEOUT_MS : QAAP_AGENT_CONNECTION_PROBE_TIMEOUT_MS;
}
/**
 * After the probe timeout, how long the probe may still take to hand back its pipes before it is settled as
 * `unknown` anyway. `execFile` kills the child at the timeout but only calls back once every holder of its
 * stdout/stderr has closed them; a grandchild (agy's helper, a tenant wrapper's descendant) can hold them
 * forever, and an unsettled probe kept the session `checking` for good.
 */
export const QAAP_AGENT_CONNECTION_PROBE_SETTLE_GRACE_MS = 1_500;

/**
 * Asynchronous auth probe. Never use a synchronous spawn here: the picker catalog, the settings
 * API and every other request share the backend event loop, and a few 4 s CLI probes behind the
 * tenant wrapper stalled them for tens of seconds.
 */
export function probeAgentConnectionState(
    agentId: string,
    bin = agentId,
    options?: QaapAgentConnectionProbeOptions,
): Promise<QaapAgentConnectionState> {
    const normalized = agentId.trim().toLowerCase();
    const args = options?.args ?? resolveAgentConnectionProbeArgs(normalized);
    if (!args) {
        return Promise.resolve('unknown');
    }
    const timeoutMs = options?.timeoutMs ?? QAAP_AGENT_CONNECTION_PROBE_TIMEOUT_MS;
    return new Promise<QaapAgentConnectionState>(resolve => {
        let settled = false;
        let settleTimer: ReturnType<typeof setTimeout> | undefined;
        const settle = (state: QaapAgentConnectionState): void => {
            if (!settled) {
                settled = true;
                clearTimeout(settleTimer);
                resolve(state);
            }
        };
        try {
            // The deadline kills the probe's whole process tree: a wrapper (`sh -c`, npm shim) left the CLI alive.
            const child = execFileKillingGroup(options?.file ?? bin, [...args], {
                cwd: options?.cwd,
                env: childProcessEnv(options?.env),
                timeoutMs,
                windowsHide: true,
                lowPriority: true,
            }, (error, stdout, stderr) => {
                const output = `${stdout ?? ''}\n${stderr ?? ''}`;
                // A non-zero exit is still a readable answer ("Not logged in" exits 1); only a
                // spawn failure, a timeout or a signal makes the probe inconclusive.
                const exitCode = typeof error?.code === 'number' ? error.code : undefined;
                const failed = !!error && (exitCode === undefined || !!error.killed || !!error.signal);
                settle(classifyAgentConnectionProbe(normalized, failed ? null : exitCode ?? 0, output, failed));
            });
            // Hard bound: a probe whose pipes stay open past the timeout is inconclusive, not pending.
            settleTimer = setTimeout(() => {
                killProcessGroup(child);
                try {
                    child.stdout?.destroy();
                    child.stderr?.destroy();
                } catch {
                    // Already gone.
                }
                settle('unknown');
            }, timeoutMs + QAAP_AGENT_CONNECTION_PROBE_SETTLE_GRACE_MS);
            settleTimer.unref?.();
        } catch {
            settle('unknown');
        }
    });
}

// ─── DI: recordTaskLatencyMark ───────────────────────────────────────────────

export function recordTaskLatencyMark(
    taskId: string,
    mark: QaapTurnLatencyMark,
    tasks: Map<string, QaapAgentTask>,
    at = Date.now(),
): void {
    const task = tasks.get(taskId);
    if (!task || task.latencyMarks?.[mark] !== undefined) {
        return;
    }
    tasks.set(taskId, {
        ...task,
        latencyMarks: {
            ...task.latencyMarks,
            [mark]: at,
        },
    });
}

// ─── DI-extracted: reviewSuccessfulAgentTask ────────────────────────────────

const QAAP_AGENT_REVIEW_WALL_CLOCK_MS = 3 * 60 * 1000;
const QAAP_AGENT_REVIEW_GIT_TIMEOUT_MS = 15_000;

export interface ReviewSuccessfulAgentTaskDeps {
    isTaskStillRunning(taskId: string): boolean;
    resolveTaskAgentId(task: QaapAgentTask): string;
    buildChildEnv(task: QaapAgentTask): NodeJS.ProcessEnv;
    hasEditedFilesForVerification(task: QaapAgentTask, env: NodeJS.ProcessEnv): Promise<boolean>;
    runGenericCommand(command: string, cwd: string, env: NodeJS.ProcessEnv, taskId: string, timeoutMs: number, options: { readonly header?: string; readonly streamOutput?: boolean; readonly maxCaptureChars?: number; readonly stdinPrompt?: string; readonly ownerLogin?: string }): Promise<QaapGenericCommandResult>;
    /** Read-only one-shot gate grant for a reviewer harness; returns the function that revokes it. */
    applyOneShotToolGateEnv?(env: NodeJS.ProcessEnv, task: Pick<QaapAgentTask, 'ownerLogin' | 'cwd' | 'agentId' | 'command'>): () => void;
    changedSensitiveFiles(task: QaapAgentTask): string[];
    resolveReviewerCandidates(task: QaapAgentTask): string[];
    buildAgentCommand(prompt: string, agentId: string | undefined, autoApprove: boolean, agentModel?: QaapCreateAgentTaskQaiqModel, cwd?: string, contextPreamble?: string, interactionModeId?: string, approvalPolicyId?: string): { command: string; stdinPrompt?: string; stdinPromptMode?: QaapAgentStdinPromptMode; agentId: string };
    appendAndFireOutput(taskId: string, text: string): void;
    agentHealth?: { noteSuccess(agentId: string): void; noteFailure(agentId: string): void };
}

export async function reviewSuccessfulAgentTask(
    task: QaapAgentTask,
    verification: QaapAgentTaskVerification | undefined,
    deps: ReviewSuccessfulAgentTaskDeps,
): Promise<QaapAgentTaskReview | undefined> {
    const mode = resolveAgentReviewMode(process.env.QAAP_AGENT_REVIEW);
    if (mode === 'off' || !deps.isTaskStillRunning(task.id)) {
        return undefined;
    }
    if (task.externalReview) {
        // A workflow run owns the review for this turn (its judge node). Reviewing here as well
        // would spend a second reviewer agent on the same diff and delay the turn for nothing.
        return undefined;
    }
    const agentId = deps.resolveTaskAgentId(task);
    if (agentId === SHELL_AGENT_ID) {
        return undefined;
    }
    const env = deps.buildChildEnv(task);
    // Verification already proved edits exist when it ran; re-check only when it was skipped
    // (undefined covers both "no edits" and "no scripts" — review only cares about the former).
    if (verification === undefined && !await deps.hasEditedFilesForVerification(task, env)) {
        return undefined;
    }
    const numstat = await deps.runGenericCommand('git diff --numstat HEAD', task.cwd, env, task.id, QAAP_AGENT_REVIEW_GIT_TIMEOUT_MS, {});
    const untracked = await deps.runGenericCommand('git ls-files --others --exclude-standard', task.cwd, env, task.id, QAAP_AGENT_REVIEW_GIT_TIMEOUT_MS, {});
    // Gitignored secrets files never appear in either git listing; a rewritten .env must both
    // count as a change and trip the sensitive-path high-risk signal.
    const sensitiveChanges = deps.changedSensitiveFiles(task);
    // Exclude files that were already dirty before the task started so pre-existing workspace dirt
    // never tricks the risk classifier into spawning a 3-minute independent reviewer for a low-risk,
    // docs-only, or commit-only turn.
    const baselinePaths = task.worktreeBaselinePaths !== undefined
        ? new Set(task.worktreeBaselinePaths.map(filePath => filePath.replace(/\\/g, '/')))
        : undefined;
    const isTaskOwnedPath = (filePath: string): boolean => !baselinePaths || !baselinePaths.has(filePath.replace(/\\/g, '/'));
    const trackedChanges = parseGitNumstat(numstat.stdout).filter(file => isTaskOwnedPath(file.path));
    const untrackedChanges = untracked.stdout.split('\n').map(line => line.trim()).filter(Boolean)
        .filter(isTaskOwnedPath)
        .map(p => ({ path: p, added: 0, removed: 0 }));
    const changedFiles = [
        ...trackedChanges,
        // Untracked (new) files never show in `diff HEAD` — count them for the file-count and
        // sensitive-path signals; their line counts are unknown and stay at 0.
        ...untrackedChanges,
        ...sensitiveChanges.map(p => ({ path: p, added: 0, removed: 0 })),
    ];
    if (baselinePaths !== undefined && changedFiles.length === 0) {
        return undefined;
    }
    if (mode === 'high-risk' && resolveTaskReviewRisk(changedFiles) === 'low') {
        return undefined;
    }
    const diffCommand = baselinePaths !== undefined && baselinePaths.size > 0 && trackedChanges.length > 0
        ? `git diff HEAD -- ${trackedChanges.map(file => quoteShellArg(file.path)).join(' ')}`
        : 'git diff HEAD';
    const diff = baselinePaths !== undefined && baselinePaths.size > 0 && trackedChanges.length === 0
        ? { exitCode: 0, stdout: '', stderr: '', timedOut: false }
        : await deps.runGenericCommand(diffCommand, task.cwd, env, task.id, QAAP_AGENT_REVIEW_GIT_TIMEOUT_MS, {});
    // Name the secrets files the diff cannot show, so the reviewer inspects them read-only
    // instead of judging a change it cannot see. Contents are never inlined.
    const diffForReview = sensitiveChanges.length > 0
        ? `${diff.stdout}\n# gitignored sensitive files CHANGED by this task (not shown above — inspect them):\n${sensitiveChanges.map(name => `#   ${name}`).join('\n')}\n`
        : diff.stdout;
    const prompt = buildAgentReviewPrompt({ originalCommand: task.command, diff: diffForReview, verification });
    // Composer tasks share the workflow judge's brain: routing picks an INDEPENDENT reviewer
    // (not the agent that wrote the change), health cooldowns skip backends whose CLI is down,
    // and an infra-failed reviewer fails over to the next candidate instead of burning the
    // review. UX is unchanged — same streaming into the task log, same review shape.
    const candidates = deps.resolveReviewerCandidates(task);
    let ranAnyReviewer = false;
    let lastReviewer = agentId;
    for (const reviewerId of candidates) {
        if (!deps.isTaskStillRunning(task.id)) {
            return undefined;
        }
        lastReviewer = reviewerId;
        let command: string;
        let stdinPrompt: string | undefined;
        let stdinPromptMode: QaapAgentStdinPromptMode | undefined;
        try {
            ({ command, stdinPrompt, stdinPromptMode } = deps.buildAgentCommand(
                prompt,
                reviewerId,
                true,
                // The task's model binding only makes sense on the task's own CLI.
                reviewerId === agentId ? resolveTaskAgentModel(task) : undefined,
                task.cwd,
                undefined,
                undefined,
                'full-access',
            ));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.appendAndFireOutput(task.id, `\n[qaap] Skipping reviewer ${reviewerId}: ${message}\n`);
            continue;
        }
        ranAnyReviewer = true;
        // The reviewer is a separate harness run: it gets its own read-only one-shot grant on a COPY of the
        // env (the git commands above keep the plain env), revoked as soon as the reviewer ends.
        const reviewerEnv: NodeJS.ProcessEnv = { ...env };
        const releaseGate = deps.applyOneShotToolGateEnv?.(reviewerEnv, { ...task, agentId: reviewerId, command }) ?? (() => undefined);
        let result: QaapGenericCommandResult;
        try {
            result = await deps.runGenericCommand(command, task.cwd, reviewerEnv, task.id, QAAP_AGENT_REVIEW_WALL_CLOCK_MS, {
                header: `\n[qaap] High-risk change — starting independent ${reviewerId} review.\n`,
                streamOutput: true,
                ...(stdinPromptMode === 'plain' && stdinPrompt !== undefined ? { stdinPrompt } : {}),
            });
        } finally {
            releaseGate();
        }
        const verdict = parseAgentReviewVerdict(`${result.stdout}\n${result.stderr}`);
        if (verdict) {
            deps.agentHealth?.noteSuccess(reviewerId);
            // A rejection without a concrete path:line defect is recorded as approved with notes.
            const grounded = groundAgentReviewVerdict(verdict);
            return { status: grounded.status, reason: grounded.reason, agentId: reviewerId };
        }
        if (result.exitCode !== 0 && !result.timedOut) {
            // The reviewer CLI itself died (quota, auth, broken install): cool it down and try
            // the next candidate, exactly like a failed workflow judge turn.
            deps.agentHealth?.noteFailure(reviewerId);
            continue;
        }
        // Ran to completion but stayed silent, or timed out: a second reviewer would double the
        // cost for the same fail-open outcome — keep the single-attempt behavior.
        return {
            status: 'inconclusive',
            reason: result.timedOut
                ? 'Reviewer timed out before emitting a verdict.'
                : 'Reviewer did not emit a verdict.',
            agentId: reviewerId,
        };
    }
    if (!ranAnyReviewer) {
        // No candidate could even be started (all build failures) — same skip as before.
        return undefined;
    }
    return {
        status: 'inconclusive',
        reason: 'Every reviewer agent failed before emitting a verdict.',
        agentId: lastReviewer,
    };
}

// ─── DI-extracted: runOneShotCommand (0 field accesses, 5 method calls) ──────

export interface RunOneShotCommandDeps {
    enforceAgentIsolationPolicy(): void;
    ensureAgentCwdOwnership(cwd: string): void | Promise<void>;
    spawnAgentCommand(command: string, options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ('ignore' | 'pipe')[]; detached?: boolean }): ChildProcess;
    killAgentProcessTree(child: ChildProcess): void;
    reapAgentProcessGroupAfterExit(child: ChildProcess): void;
}

export class QaapAgentCommandTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Agent call timed out after ${Math.round(timeoutMs / 1000)}s.`);
        this.name = 'QaapAgentCommandTimeoutError';
    }
}

export async function runOneShotCommand(
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    agentId: string | undefined,
    timeoutMs: number,
    deps: RunOneShotCommandDeps,
    stdinPrompt?: string,
    promptTempDir?: string,
): Promise<string> {
    deps.enforceAgentIsolationPolicy();
    await deps.ensureAgentCwdOwnership(cwd);
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let child: ChildProcess;
        const cleanupPromptTempDir = (): void => {
            removeAgentPromptTempDir(promptTempDir);
        };
        try {
            child = deps.spawnAgentCommand(command, {
                cwd,
                env,
                stdio: stdinPrompt === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
                ...(stdinPrompt === undefined || process.platform !== 'win32' ? {} : { detached: false }),
            });
            if (stdinPrompt !== undefined) {
                child.stdin?.end(stdinPrompt);
            }
        } catch (error) {
            cleanupPromptTempDir();
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        const timer = setTimeout(() => {
            cleanupPromptTempDir();
            deps.killAgentProcessTree(child);
            reject(new QaapAgentCommandTimeoutError(timeoutMs));
        }, timeoutMs);
        child.stdout?.on('data', (chunk: Buffer | string) => {
            stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
            stderr += String(chunk);
        });
        child.on('error', error => {
            clearTimeout(timer);
            cleanupPromptTempDir();
            reject(error);
        });
        child.once('exit', () => {
            deps.reapAgentProcessGroupAfterExit(child);
        });
        child.on('close', code => {
            clearTimeout(timer);
            cleanupPromptTempDir();
            if (code !== 0) {
                reject(new Error(stderr.trim() || stdout.trim() || `Agent exited with code ${code ?? 'unknown'}.`));
                return;
            }
            const improved = extractImprovedComposerPromptFromAgentStdout(agentId, stdout);
            if (!improved) {
                reject(new Error('Agent returned an empty prompt.'));
                return;
            }
            resolve(improved);
        });
    });
}

// ─── DI-extracted: verifySuccessfulAgentTask (0 field accesses, 7 method calls) ─

export const QAAP_AGENT_VERIFY_MAX_ATTEMPTS = 2;
export const QAAP_AGENT_VERIFY_WALL_CLOCK_MS = 5 * 60 * 1000;
const VERIFY_NPM_RUN_PREFIX = 'npm run ';

export interface VerifySuccessfulAgentTaskDeps {
    buildChildEnv(task: QaapAgentTask): NodeJS.ProcessEnv;
    hasEditedFilesForVerification(task: QaapAgentTask, env: NodeJS.ProcessEnv): Promise<boolean>;
    resolveVerificationScriptsForCwd(cwd: string): Promise<readonly string[]>;
    isTaskStillRunning(taskId: string): boolean;
    runVerificationScripts(task: QaapAgentTask, env: NodeJS.ProcessEnv, scripts: readonly string[], startedAt: number): Promise<{ command: string; result: QaapGenericCommandResult } | undefined>;
    /**
     * Fingerprint of the task's worktree state (HEAD, tracked diff, untracked files); `undefined`
     * when it cannot be read, which disables the reuse of earlier passes.
     */
    fingerprintWorktree?(task: QaapAgentTask): string | undefined;
    runAgentVerificationFixTurn(task: QaapAgentTask, env: NodeJS.ProcessEnv, failedCommand: string, failure: QaapGenericCommandResult, attempt: number, startedAt: number, scopePaths: readonly string[]): Promise<QaapGenericCommandResult | undefined>;
    summarizeVerificationFailure(command: string, result: QaapGenericCommandResult): string;
    /** Dirty paths in the task's checkout; `undefined` when git cannot report them (scope rules then stay off). */
    listWorktreeChanges(task: QaapAgentTask): readonly QaapWorktreeChange[] | undefined;
    /** Gitignored sensitive files (`.env*`, etc.) modified by this task; non-empty always keeps verification active. */
    changedSensitiveFiles?(task: QaapAgentTask): readonly string[];
    /** Put the given paths back to how they were before the fix turn; returns the paths restored. */
    revertWorktreeChanges(task: QaapAgentTask, changes: readonly QaapWorktreeChange[]): readonly string[];
    /**
     * Live progress hook: called once the loop is about to run repo scripts and again before/after
     * each fix turn so the runner can surface "automatic verification in progress" while the task
     * is still `'running'`. Never called when verification is skipped (no edits / no scripts).
     */
    onVerificationPhase?(task: QaapAgentTask, phase: QaapAgentTaskVerificationPhase): void;
}

export async function verifySuccessfulAgentTask(
    task: QaapAgentTask,
    deps: VerifySuccessfulAgentTaskDeps,
): Promise<QaapAgentTaskVerification | undefined> {
    const env = deps.buildChildEnv(task);
    const startedAt = Date.now();
    if (!await deps.hasEditedFilesForVerification(task, env)) {
        return undefined;
    }
    const scripts = await deps.resolveVerificationScriptsForCwd(task.cwd);
    if (scripts.length === 0) {
        return undefined;
    }
    // Only include paths that were clean at task start. Dirty files from the user's own work must
    // never widen the agent's repair scope.
    const currentChanges = deps.listWorktreeChanges(task);
    const taskChanges = currentChanges ? findChangesSinceBaseline(currentChanges, task.worktreeBaselinePaths) : undefined;
    const scopePaths = taskChanges?.map(change => change.path);
    const changedFilesLimit = resolveAgentTaskChangedFilesLimit(process.env);
    const exceededFiles = currentChanges && changedFilesLimit !== undefined && task.worktreeBaselinePaths !== undefined
        ? findChangesExceedingScopeLimit(currentChanges, task.worktreeBaselinePaths, changedFilesLimit)
        : undefined;
    if (exceededFiles) {
        return {
            status: 'failed',
            command: 'Qaap change-scope limit',
            attempts: 0,
            summary: nls.localize(
                'qaap/agentTask/automaticFixScopeLimit',
                'This task reached the default scope limit of {0} changed files: {1}. Automatic repair is paused. Review these changes and explicitly confirm before asking the agent to continue.',
                String(changedFilesLimit),
                exceededFiles.slice(0, 10).join(', '),
            ),
        };
    }
    const hasSensitiveChanges = (deps.changedSensitiveFiles?.(task).length ?? 0) > 0;
    if (!hasSensitiveChanges && scopePaths && isDocsOnlyVerificationScope(scopePaths)) {
        return undefined;
    }
    let attempts = 0;
    let lastCommand = '';
    let lastFailure: QaapGenericCommandResult | undefined;
    deps.onVerificationPhase?.(task, { status: 'running', attempt: 0, maxAttempts: QAAP_AGENT_VERIFY_MAX_ATTEMPTS, startedAt });
    // A script that already passed on the exact same worktree state is not run again: a fix turn
    // that changed nothing cannot have turned it red, and a full build or typecheck is costly.
    const passedOnFingerprint = new Map<string, string>();
    while (deps.isTaskStillRunning(task.id) && Date.now() - startedAt < QAAP_AGENT_VERIFY_WALL_CLOCK_MS) {
        const fingerprint = deps.fingerprintWorktree?.(task);
        const pendingScripts = fingerprint === undefined
            ? scripts
            : scripts.filter(script => passedOnFingerprint.get(script) !== fingerprint);
        const failed = await deps.runVerificationScripts(task, env, pendingScripts, startedAt);
        if (fingerprint !== undefined) {
            // Scripts run in order and stop at the first failure: everything before it passed.
            const failedScript = failed?.command.startsWith(VERIFY_NPM_RUN_PREFIX)
                ? failed.command.slice(VERIFY_NPM_RUN_PREFIX.length)
                : undefined;
            const failedIndex = failed === undefined ? pendingScripts.length : pendingScripts.indexOf(failedScript ?? '');
            for (const script of pendingScripts.slice(0, Math.max(0, failedIndex))) {
                passedOnFingerprint.set(script, fingerprint);
            }
        }
        if (!failed) {
            return { status: 'passed', command: lastCommand || `npm run ${scripts[scripts.length - 1]}`, attempts };
        }
        lastCommand = failed.command;
        lastFailure = failed.result;
        // Lint-style findings name their file. When none of them is a file this task edited, the
        // repo was already red before the turn: report it, never hand it to the agent as work.
        if (scopePaths && isPerFileVerificationScript(failed.command)
            && classifyVerificationFailureScope(`${failed.result.stdout}\n${failed.result.stderr}`, scopePaths) === 'out-of-scope') {
            return {
                status: 'preexisting',
                command: failed.command,
                attempts,
                summary: deps.summarizeVerificationFailure(failed.command, failed.result),
            };
        }
        if (attempts >= QAAP_AGENT_VERIFY_MAX_ATTEMPTS || Date.now() - startedAt >= QAAP_AGENT_VERIFY_WALL_CLOCK_MS) {
            break;
        }
        attempts++;
        deps.onVerificationPhase?.(task, {
            status: 'fixing', attempt: attempts, maxAttempts: QAAP_AGENT_VERIFY_MAX_ATTEMPTS, command: failed.command, startedAt,
        });
        const beforeFix = scopePaths ? deps.listWorktreeChanges(task) : undefined;
        const fixed = await deps.runAgentVerificationFixTurn(task, env, failed.command, failed.result, attempts, startedAt, scopePaths ?? []);
        if (fixed === undefined) {
            // No agent was available to attempt a fix — retrying the same failing scripts again
            // would just burn the remaining attempts for nothing, so stop here.
            break;
        }
        if (beforeFix) {
            // Hard scope guard: the prompt asks the fixer to stay inside the task's files, this
            // enforces it. Anything it touched that was clean before the fix turn goes back.
            const afterFix = deps.listWorktreeChanges(task);
            const outOfScope = afterFix ? findOutOfScopeChanges(afterFix, new Set(beforeFix.map(change => change.path))) : [];
            if (outOfScope.length > 0) {
                deps.revertWorktreeChanges(task, outOfScope);
            }
        }
        if (deps.isTaskStillRunning(task.id)) {
            deps.onVerificationPhase?.(task, { status: 'running', attempt: attempts, maxAttempts: QAAP_AGENT_VERIFY_MAX_ATTEMPTS, startedAt });
        }
    }
    if (!lastFailure) {
        return {
            status: 'failed',
            command: lastCommand || 'qaap self-verification',
            attempts,
            summary: 'Verification did not complete before the task stopped or the wall-clock limit was reached.',
        };
    }
    return {
        status: 'failed',
        command: lastCommand,
        attempts,
        summary: deps.summarizeVerificationFailure(lastCommand, lastFailure),
    };
}
