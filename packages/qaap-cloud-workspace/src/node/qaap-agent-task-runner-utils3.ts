// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure + DI helpers extracted from QaapAgentTaskRunner (batch 3).

import { execFile, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { nls } from '@theia/core/lib/common/nls';
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
    isPerFileVerificationScript,
    resolveAgentTaskChangedFilesLimit,
    type QaapWorktreeChange,
} from '../common/qaap-verification-scope';
import {
    buildAgentReviewPrompt,
    parseAgentReviewVerdict,
    parseGitNumstat,
    resolveAgentReviewMode,
    resolveTaskReviewRisk,
} from '../common/qaap-agent-review';
import type { QaapGenericCommandResult } from './qaap-agent-task-runner';
import type { AgentCandidate } from './qaap-agent-task-runner-types';
import {
    removeAgentPromptTempDir,
    type QaapAgentStdinPromptMode,
} from './qaap-agent-task-runner-utils';
import { extractImprovedComposerPromptFromAgentStdout } from '@theia/qaap-composer/lib/common/qaap-composer-prompt-improve';

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
    try {
        globalThis.process.kill(-pid, 'SIGKILL');
    } catch {
        // ESRCH is the common clean case: the agent left no descendants behind.
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
    try {
        spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
        probedAgentBins.add(agentId);
        return true;
    } catch {
        return false;
    }
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

/** Executable + argv that report one harness's sign-in state, for the executable it runs as. */
export function resolveAgentConnectionProbe(agentId: string, bin: string): { readonly file: string; readonly args: readonly string[] } | undefined {
    const normalized = agentId.trim().toLowerCase();
    if (normalized === 'antigravity' || normalized === 'gemini') {
        // The community `antigravity`/`ag` CLI talks to a running Antigravity desktop app and has
        // no sign-in of its own; only the Gemini CLI fallback can be signed in on a server.
        return path.basename(bin) === 'gemini' ? { file: 'sh', args: ['-c', GEMINI_CLI_CONNECTION_PROBE_SCRIPT] } : undefined;
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
    if (/\"(?:authenticated|isloggedin|loggedin)\"\s*:\s*false/.test(sample)
        || /not logged in|not authenticated|logged out|no active login|no credentials|no providers configured|not connected|no authentication information found|sign in required/.test(sample)) {
        return 'disconnected';
    }
    if (status !== 0) {
        return 'unknown';
    }
    if (/\"(?:authenticated|isloggedin|loggedin)\"\s*:\s*true/.test(sample)
        || /logged in|authenticated|credentials configured|active account/.test(sample)) {
        return 'connected';
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
    return new Promise<QaapAgentConnectionState>(resolve => {
        try {
            execFile(options?.file ?? bin, [...args], {
                cwd: options?.cwd,
                env: options?.env,
                encoding: 'utf8',
                timeout: QAAP_AGENT_CONNECTION_PROBE_TIMEOUT_MS,
                windowsHide: true,
            }, (error, stdout, stderr) => {
                const output = `${stdout ?? ''}\n${stderr ?? ''}`;
                // A non-zero exit is still a readable answer ("Not logged in" exits 1); only a
                // spawn failure, a timeout or a signal makes the probe inconclusive.
                const exitCode = typeof error?.code === 'number' ? error.code : undefined;
                const failed = !!error && (exitCode === undefined || !!error.killed || !!error.signal);
                resolve(classifyAgentConnectionProbe(normalized, failed ? null : exitCode ?? 0, output, failed));
            });
        } catch {
            resolve('unknown');
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
    const changedFiles = [
        ...parseGitNumstat(numstat.stdout),
        // Untracked (new) files never show in `diff HEAD` — count them for the file-count and
        // sensitive-path signals; their line counts are unknown and stay at 0.
        ...untracked.stdout.split('\n').map(line => line.trim()).filter(Boolean)
            .map(p => ({ path: p, added: 0, removed: 0 })),
        ...sensitiveChanges.map(p => ({ path: p, added: 0, removed: 0 })),
    ];
    if (mode === 'high-risk' && resolveTaskReviewRisk(changedFiles) === 'low') {
        return undefined;
    }
    const diff = await deps.runGenericCommand('git diff HEAD', task.cwd, env, task.id, QAAP_AGENT_REVIEW_GIT_TIMEOUT_MS, {});
    // Name the secrets files the diff cannot show, so the reviewer inspects them read-only
    // instead of judging a change it cannot see. Contents are never inlined.
    const diffForReview = sensitiveChanges.length > 0
        ? `${diff.stdout}\n# gitignored sensitive files CHANGED by this task (not shown above — inspect them):\n${sensitiveChanges.map(name => `#   ${name}`).join('\n')}\n`
        : diff.stdout;
    const prompt = buildAgentReviewPrompt({ originalCommand: task.command, diff: diffForReview });
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
        const result = await deps.runGenericCommand(command, task.cwd, env, task.id, QAAP_AGENT_REVIEW_WALL_CLOCK_MS, {
            header: `\n[qaap] High-risk change — starting independent ${reviewerId} review.\n`,
            streamOutput: true,
            ...(stdinPromptMode === 'plain' && stdinPrompt !== undefined ? { stdinPrompt } : {}),
        });
        const verdict = parseAgentReviewVerdict(`${result.stdout}\n${result.stderr}`);
        if (verdict) {
            deps.agentHealth?.noteSuccess(reviewerId);
            return { status: verdict.status, reason: verdict.reason, agentId: reviewerId };
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
                ...(stdinPrompt === undefined ? {} : { detached: false }),
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

export interface VerifySuccessfulAgentTaskDeps {
    buildChildEnv(task: QaapAgentTask): NodeJS.ProcessEnv;
    hasEditedFilesForVerification(task: QaapAgentTask, env: NodeJS.ProcessEnv): Promise<boolean>;
    resolveVerificationScriptsForCwd(cwd: string): Promise<readonly string[]>;
    isTaskStillRunning(taskId: string): boolean;
    runVerificationScripts(task: QaapAgentTask, env: NodeJS.ProcessEnv, scripts: readonly string[], startedAt: number): Promise<{ command: string; result: QaapGenericCommandResult } | undefined>;
    runAgentVerificationFixTurn(task: QaapAgentTask, env: NodeJS.ProcessEnv, failedCommand: string, failure: QaapGenericCommandResult, attempt: number, startedAt: number, scopePaths: readonly string[]): Promise<QaapGenericCommandResult | undefined>;
    summarizeVerificationFailure(command: string, result: QaapGenericCommandResult): string;
    /** Dirty paths in the task's checkout; `undefined` when git cannot report them (scope rules then stay off). */
    listWorktreeChanges(task: QaapAgentTask): readonly QaapWorktreeChange[] | undefined;
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
    let attempts = 0;
    let lastCommand = '';
    let lastFailure: QaapGenericCommandResult | undefined;
    deps.onVerificationPhase?.(task, { status: 'running', attempt: 0, maxAttempts: QAAP_AGENT_VERIFY_MAX_ATTEMPTS, startedAt });
    while (deps.isTaskStillRunning(task.id) && Date.now() - startedAt < QAAP_AGENT_VERIFY_WALL_CLOCK_MS) {
        const failed = await deps.runVerificationScripts(task, env, scripts, startedAt);
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
