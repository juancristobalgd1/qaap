// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure + DI helpers extracted from QaapAgentTaskRunner (batch 3).

import { spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    extractRetrievalKeywords,
    formatRelevantFilesHint,
} from '../common/qaap-agent-retrieval';
import {
    QAAP_BUILTIN_AGENT_DEFINITIONS,
    isUiHiddenVpsAgent,
} from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
import type { QaapTurnLatencyMark } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import type { QaapAgentTask, QaapAgentDescriptor, QaapAgentTaskReview, QaapAgentTaskVerification, QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task';
import { resolveTaskAgentModel } from '../common/qaap-agent-task';
import {
    buildAgentReviewPrompt,
    parseAgentReviewVerdict,
    parseGitNumstat,
    resolveAgentReviewMode,
    resolveTaskReviewRisk,
} from '../common/qaap-agent-review';
import type { QaapGenericCommandResult } from './qaap-agent-task-runner';
import type { AgentCandidate } from './qaap-agent-task-runner-types';
import type { QaapAgentStdinPromptMode } from './qaap-agent-task-runner-utils';
import { extractImprovedComposerPromptFromAgentStdout } from '@theia/qaap-mobile-shell/lib/common/qaap-composer-prompt-improve';

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

// ─── Pure: readRelevantFiles ─────────────────────────────────────────────────

export function readRelevantFiles(cwd: string, userQuery: string | undefined): string | undefined {
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
        const out = spawnSync('rg', args, { cwd, encoding: 'utf8', timeout: 4000, maxBuffer: 4 * 1024 * 1024 });
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
    if (!pid || globalThis.process.platform === 'win32') {
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
    runGenericCommand(command: string, cwd: string, env: NodeJS.ProcessEnv, taskId: string, timeoutMs: number, options: { readonly header?: string; readonly streamOutput?: boolean; readonly maxCaptureChars?: number; readonly stdinPrompt?: string }): Promise<QaapGenericCommandResult>;
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
    ensureAgentCwdOwnership(cwd: string): void;
    spawnAgentCommand(command: string, options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ('ignore' | 'pipe')[] }): ChildProcess;
    killAgentProcessTree(child: ChildProcess): void;
    reapAgentProcessGroupAfterExit(child: ChildProcess): void;
}

export function runOneShotCommand(
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    agentId: string | undefined,
    timeoutMs: number,
    deps: RunOneShotCommandDeps,
): Promise<string> {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let child: ChildProcess;
        try {
            deps.enforceAgentIsolationPolicy();
            deps.ensureAgentCwdOwnership(cwd);
            child = deps.spawnAgentCommand(command, {
                cwd,
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        const timer = setTimeout(() => {
            deps.killAgentProcessTree(child);
            reject(new Error('Prompt improvement timed out.'));
        }, timeoutMs);
        child.stdout?.on('data', (chunk: Buffer | string) => {
            stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
            stderr += String(chunk);
        });
        child.on('error', error => {
            clearTimeout(timer);
            reject(error);
        });
        child.once('exit', () => {
            deps.reapAgentProcessGroupAfterExit(child);
        });
        child.on('close', code => {
            clearTimeout(timer);
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
    runAgentVerificationFixTurn(task: QaapAgentTask, env: NodeJS.ProcessEnv, failedCommand: string, failure: QaapGenericCommandResult, attempt: number, startedAt: number): Promise<QaapGenericCommandResult | undefined>;
    summarizeVerificationFailure(command: string, result: QaapGenericCommandResult): string;
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
    let attempts = 0;
    let lastCommand = '';
    let lastFailure: QaapGenericCommandResult | undefined;
    while (deps.isTaskStillRunning(task.id) && Date.now() - startedAt < QAAP_AGENT_VERIFY_WALL_CLOCK_MS) {
        const failed = await deps.runVerificationScripts(task, env, scripts, startedAt);
        if (!failed) {
            return { status: 'passed', command: lastCommand || `npm run ${scripts[scripts.length - 1]}`, attempts };
        }
        lastCommand = failed.command;
        lastFailure = failed.result;
        if (attempts >= QAAP_AGENT_VERIFY_MAX_ATTEMPTS || Date.now() - startedAt >= QAAP_AGENT_VERIFY_WALL_CLOCK_MS) {
            break;
        }
        attempts++;
        const fixed = await deps.runAgentVerificationFixTurn(task, env, failed.command, failed.result, attempts, startedAt);
        if (fixed === undefined) {
            // No agent was available to attempt a fix — retrying the same failing scripts again
            // would just burn the remaining attempts for nothing, so stop here.
            break;
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
