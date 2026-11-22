import { formatTaskStartLog } from './qaap-agent-conversation-persist-policy';
import { createAgySignInWaitWatcher } from './qaap-agy-sign-in-wait-watcher';
import { QAAP_HARNESS_ADAPTER_REGISTRY } from './harness/qaap-harness-adapter-registry';
import { qaapAcpFlavorPrintsStreamJson, resolveQaapAcpFlavor, resolveQaapAcpSpawnCommand } from './harness/acp/qaap-acp-bridge-launch';
import { QAAP_OPENCODE_GATE_PROBE } from './qaap-tool-gate-opencode-probe';
import {
    opencodeGatePluginSeeded,
    resolveOpencodeArmTimeoutMs,
    resolveQaapToolGateOpencodePluginPath,
    startOpencodeArmWatch,
} from './qaap-tool-gate-opencode-adapter';
import {
    assertCodexGateTokenIssued, DEFAULT_QAAP_CODEX_GATE_OVERLAY_BUILDER, resolveCodexGateOverlayRoot, type QaapCodexGateOverlay,
} from './qaap-codex-gate-overlay';
import { resolveCodexAgentHome } from './qaap-agent-native-models';
import { IDLE_TASK_TIMEOUT_MS, QAAP_AGENT_VERIFY_ENABLED, QUEUED_APPROVAL_GRACE_TIMEOUT_MS, USER_REQUEST_MAX_CHARS } from './qaap-agent-task-runner-constants';
import { QaapQaiqProviderKeyMissingError } from './qaap-qaiq-provider-preflight';
import { QaapAgentSignInRequiredError } from './qaap-agent-sign-in-preflight';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { awaitQaapAgentTaskSpawnGate } from './qaap-agent-task-spawn-gate';
import {
    appendQaapDelegationLaunchArgs,
    applyQaapOpencodeDelegation,
    applyQaapPiDelegation,
    buildQaapDelegationMcpConfig,
    currentQaapDelegationMcpConfigOptions,
    QAAP_AGENT_DELEGATION_GUIDANCE,
    releaseQaapDelegationMcpConfigFile,
    resolveQaapDelegationPlacement,
    writeQaapDelegationMcpConfigFile,
    writeQaapDelegationTokenFile,
    type QaapDelegationPlacement,
    type QaapDelegationWiring,
} from './qaap-agent-delegation-launch';
import { isQaapAgentDelegationEnabled, QAAP_AGENT_DELEGATION_TOKEN_ENV, QAAP_AGENT_DELEGATION_URL_ENV } from '../common/qaap-agent-delegation-protocol';
import { finishTaskWithPauseCause, logCancelExitExtracted, releaseStoppingTaskSlotOnExitExtracted } from './qaap-agent-task-runner-streaming2';
import { createOpencodeFatalStderrWatcher } from './qaap-opencode-fatal-error';
import { createPiProviderErrorWatcher } from './qaap-pi-provider-error-watcher';
import { removeStaleOpencodeSnapshotLocks } from './qaap-opencode-snapshot-lock';
import { type AgentProcessSignalOutcome, signalAgentProcessTree } from './qaap-agent-process-signal';
// Extracted from qaap-agent-task-runner.ts

import { ChildProcess, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { nls } from '@theia/core/lib/common/nls';
import {
    type QaapAgentTask,
    type QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import { isQaapHostedEnvironment } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';
import {
    buildQaiqControlResponseLine,
    buildQaiqStdioPromptLine,
    parseQaiqStdioEvent,
    type QaapQaiqPendingControlRequest,
} from '../common/qaap-qaiq-stdio-approvals';
import { findQaiqDevServerGuardDenial } from '../common/qaap-agent-dev-server-guard';
import { probeReservedDevPreviewStatus } from './qaap-dev-preview-status-probe';
import { buildLivePreviewPortHint } from '../common/qaap-agent-live-preview-port';
import {
    buildQaiqQueuedApprovalTimeoutMessage,
    commandMayChangeShellCwd,
} from '../common/qaap-qaiq-control-auto-response';
import { DEFAULT_QAAP_TOOL_GATE_SERVICE } from './qaap-tool-gate-service';
import {
    QAAP_AUTO_APPROVE_READONLY_SHELL_PREF,
    resolveAutoApproveReadOnlyShellPreference,
} from '@theia/qaap-shared-core/lib/common/qaap-bash-readonly-classifier';
import { resolveTaskAgentModel } from '../common/qaap-agent-task';
import {
    applyAntigravityModelSetting,
    isAntigravityCliCommand,
} from './qaap-antigravity-settings';
import { snapshotSensitiveFiles } from './qaap-sensitive-files';
import { findChangesExceedingScopeLimit, resolveAgentTaskChangedFilesLimit } from '../common/qaap-verification-scope';

/** `git status` runs synchronously, so the opt-in scope watch polls sparingly. */
const CHANGE_SCOPE_WATCH_INTERVAL_MS = 10_000;
import {
    findPendingControlRequestEntry as findPendingControlRequestEntryHelper,
    removeAgentPromptTempDir as removeAgentPromptTempDirHelper,
    quoteShellArg,
} from './qaap-agent-task-runner-utils';
import { applyPreTurnAgentHooks, createQaiqPreToolUseHookGate } from './qaap-agent-task-runner-hooks';
import { canProbeProviderKey, runProviderKeyPreflight } from './qaap-provider-key-preflight';
import { applyQaapHarnessBinaryOverride, applyQaapHarnessUserEnv, resolveQaapHarnessLaunchPlan } from './qaap-harness-launch-overrides';
import { isConversationalTurn, isConversationalTurnTask } from '../common/qaap-agent-conversational-turn';
import { QAAP_AGENT_EXIT_AFTER_RESULT_GRACE_MS, QaapAgentFinalResultWatcher, type QaapAgentFinalResult } from './qaap-agent-final-result-watcher';

export function enforceAgentTaskChangeScopeLimitExtracted(
    ctx: QaapAgentTaskRunnerContext,
    taskId: string,
    cwd: string,
    baselinePaths: readonly string[] | undefined,
    child: ChildProcess,
    maxFiles = resolveAgentTaskChangedFilesLimit(process.env),
): boolean {
    const currentTask = ctx.tasks.get(taskId);
    if (!currentTask || currentTask.state !== 'running' || maxFiles === undefined) {
        return false;
    }
    const currentChanges = ctx.listWorktreeChanges(cwd);
    const exceededFiles = currentChanges
        ? findChangesExceedingScopeLimit(currentChanges, baselinePaths, maxFiles)
        : undefined;
    if (!exceededFiles) {
        return false;
    }
    const summary = nls.localize(
        'qaap/agentTask/changeScopeLimitExceeded',
        'The agent reached the default scope limit of {0} changed files and was paused. Review these changes ({1}) and explicitly confirm before asking it to continue.',
        String(maxFiles),
        exceededFiles.slice(0, 10).join(', '),
    );
    const scopeLimitedTask: QaapAgentTask = {
        ...currentTask,
        scopeLimitExceededFiles: exceededFiles,
        verification: {
            status: 'failed',
            command: 'Qaap change-scope limit',
            attempts: 0,
            summary,
        },
    };
    ctx.tasks.set(taskId, scopeLimitedTask);
    void ctx.persist();
    ctx.onDidChangeTaskEmitter.fire({ type: 'updated', task: scopeLimitedTask });
    ctx.appendAndFireOutput(taskId, `\n[qaap] ${summary}\n`, currentTask.ownerLogin);
    ctx.killAgentProcessTree(child, { escalateAfterMs: 0 });
    return true;
}

/** A stream-json housekeeping record (`api_retry`, hook, status): the CLI is alive, the agent is not working. */
const AGENT_SYSTEM_RECORD_LINE = /^\{\s*"type"\s*:\s*"system"/;

/**
 * Whether an output chunk is agent progress for the no-output timer. Chunks made only of
 * stream-json `system` records do not count: a CLI looping on provider retries is not working.
 * Anything else counts — including a line split across chunks — so plain-text agents and
 * unknown formats keep the old "any output" behaviour.
 */
export function isAgentProgressChunk(chunk: unknown): boolean {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    return text.split('\n').some(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !AGENT_SYSTEM_RECORD_LINE.test(trimmed);
    });
}

/** What the no-output timer did when it fired: see {@link expireIdleAgentTask}. */
export type QaapIdleAgentTaskExpiry = 'not-running' | 'waiting-for-user' | 'interrupted';

/**
 * The runner's no-output timer fired. A run waiting on a permission approval is waiting for the
 * user, not hung, so it is kept. Otherwise the process is stopped and the task ends `interrupted`:
 * the agent went quiet rather than failing, so it offers Continue (not Retry) and does not move
 * the turn to a fallback model, whose retry contract only covers `failed` runs. The log line is
 * what the turn's failure message reads ("Timed out after 20 minutes without output").
 */
export function expireIdleAgentTask(
    ctx: Pick<QaapAgentTaskRunnerContext, 'tasks' | 'pendingQaiqControlRequests' | 'killAgentProcessTree' | 'finishTask'>
        & Partial<Pick<QaapAgentTaskRunnerContext, 'taskPauseCauses'>>,
    taskId: string,
    child: ChildProcess,
    logStream: Pick<fs.WriteStream, 'write'>,
): QaapIdleAgentTaskExpiry {
    if (ctx.tasks.get(taskId)?.state !== 'running') {
        return 'not-running';
    }
    if (ctx.pendingQaiqControlRequests.get(taskId)?.length) {
        return 'waiting-for-user';
    }
    // Settle only once the line is flushed: the settle reads the log right away to build the turn
    // reason, and a read racing the buffered write would miss the timeout line. The process is
    // killed in the same callback, so its `close` cannot settle the task first as `failed`.
    logStream.write(`\n[qaap] task timed out after ${Math.round(IDLE_TASK_TIMEOUT_MS / 1000)}s without output.\n`, () => {
        if (ctx.tasks.get(taskId)?.state !== 'running') {
            return;
        }
        ctx.killAgentProcessTree(child);
        finishTaskWithPauseCause(ctx, taskId, { cause: 'idle', limitMinutes: IDLE_TASK_TIMEOUT_MS / 60_000 });
    });
    return 'interrupted';
}

/** Period of the event-loop gap sampler used by the stop timing log. */
const LOOP_SAMPLER_INTERVAL_MS = 100;

export function killAgentProcessTreeExtracted(ctx: QaapAgentTaskRunnerContext, child: ChildProcess,
        options?: { readonly escalateAfterMs?: number; readonly onGracePeriodElapsed?: () => void; readonly onSignalFailed?: () => void },): NodeJS.Timeout | undefined {
        const pid = child.pid;
        if (!pid) {
            options?.onGracePeriodElapsed?.();
            return undefined;
        }
        // Timing evidence for a slow exit: the epoch each signal left, and the largest event-loop gap
        // seen while the grace timer waited (a blocked loop delays the timer by the same amount). The
        // sampler stops when the escalation fires, which is at most one grace period after the signal.
        const armedAt = Date.now();
        let lastTick = armedAt;
        let maxLoopGapMs = 0;
        const loopSampler = setInterval(() => {
            const now = Date.now();
            maxLoopGapMs = Math.max(maxLoopGapMs, now - lastTick - LOOP_SAMPLER_INTERVAL_MS);
            lastTick = now;
        }, LOOP_SAMPLER_INTERVAL_MS);
        loopSampler.unref?.();
        const sendSignal = (signal: NodeJS.Signals): AgentProcessSignalOutcome => {
            if (globalThis.process.platform === 'win32') {
                spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
                return 'sent';
            }
            console.warn(`[qaap-stop] signal pid=${pid} target=group sig=${signal} epoch=${Date.now()}`);
            // Group first, then the leader when the group is gone. EPERM is relayed as the agent uid inside.
            const outcome = signalAgentProcessTree(child, signal);
            if (outcome === 'failed') {
                console.error(`[qaap-stop] could not deliver ${signal} to pid=${pid}; the agent may still be running`);
            }
            return outcome;
        };
        sendSignal('SIGTERM');
        const escalateAfterMs = options?.escalateAfterMs ?? 5_000;
        const sendKill = (): void => {
            const firedAt = Date.now();
            clearInterval(loopSampler);
            console.warn(`[qaap-stop] escalation-fired pid=${pid} armedAt=${armedAt} deadline=${armedAt + escalateAfterMs} fired=${firedAt} lagMs=${firedAt - armedAt - escalateAfterMs} maxLoopGapMs=${maxLoopGapMs}`);
            // A failed SIGKILL leaves the agent alive: it is not stopped, so do not run the stopped continuation.
            if (sendSignal('SIGKILL') === 'failed') {
                options?.onSignalFailed?.();
                return;
            }
            options?.onGracePeriodElapsed?.();
        };
        if (escalateAfterMs <= 0) {
            sendKill();
            return undefined;
        }
        console.warn(`[qaap-stop] escalation-armed pid=${pid} armedAt=${armedAt} graceMs=${escalateAfterMs}`);
        const escalation = setTimeout(sendKill, escalateAfterMs);
        escalation.unref?.();
        return escalation;
}

export function getApprovalChannelExtracted(ctx: QaapAgentTaskRunnerContext, taskId: string): 'qaiq-stdio' | 'stdin' | 'none' {
        if (!ctx.processes.get(taskId)?.stdin) {
            return 'none';
        }
        if (ctx.qaiqStdioTasks.has(taskId)) {
            return 'qaiq-stdio';
        }
        if (ctx.stdinInteractiveTasks.has(taskId)) {
            return 'stdin';
        }
        return 'none';
}

export function respondToApprovalPromptExtracted(ctx: QaapAgentTaskRunnerContext, taskId: string, action: 'approve' | 'reject', toolUseId?: string): boolean {
        const child = ctx.processes.get(taskId);
        if (!child?.stdin) {
            return false;
        }
        const pending = ctx.pendingQaiqControlRequests.get(taskId);
        if (pending?.length) {
            const entry = ctx.findPendingControlRequestEntry(pending, toolUseId);
            if (!entry) {
                return false;
            }
            try {
                child.stdin.write(buildQaiqControlResponseLine(entry, action));
            } catch {
                return false;
            }
            const task = ctx.tasks.get(taskId);
            const command = typeof entry.toolInput?.command === 'string' ? entry.toolInput.command : undefined;
            ctx.observability?.recordAgentToolCommand({
                taskId,
                tenantLogin: task?.ownerLogin,
                agentId: task?.agentId,
                requestId: entry.requestId,
                toolUseId: entry.toolUseId,
                toolName: entry.toolName,
                command,
                decision: action,
            });
            pending.splice(pending.indexOf(entry), 1);
            ctx.clearQueuedApprovalTimer(taskId, entry.requestId);
            return true;
        }
        if (ctx.qaiqStdioTasks.has(taskId)) {
            return false;
        }
        if (!ctx.stdinInteractiveTasks.has(taskId)) {
            return false;
        }
        const payload = action === 'approve' ? 'y\n' : 'n\n';
        try {
            child.stdin.write(payload);
            return true;
        } catch {
            return false;
        }
}

export function findPendingControlRequestEntryExtracted(ctx: QaapAgentTaskRunnerContext, pending: QaapQaiqPendingControlRequest[],
        idFromApproval?: string,): QaapQaiqPendingControlRequest | undefined {
        return findPendingControlRequestEntryHelper(pending, idFromApproval);
}

export function scheduleQueuedApprovalTimeoutExtracted(ctx: QaapAgentTaskRunnerContext, taskId: string,
        request: QaapQaiqPendingControlRequest,
        logStream: fs.WriteStream,): void {
        const timers = ctx.queuedApprovalTimers.get(taskId) ?? new Map<string, NodeJS.Timeout>();
        ctx.queuedApprovalTimers.set(taskId, timers);
        const timer = setTimeout(() => {
            timers.delete(request.requestId);
            const pending = ctx.pendingQaiqControlRequests.get(taskId);
            const index = pending?.findIndex(entry => entry.requestId === request.requestId) ?? -1;
            if (!pending || index < 0) {
                return;
            }
            pending.splice(index, 1);
            const toolName = request.toolName ?? 'Tool';
            logStream.write(`\n[qaap] approval for ${toolName} not granted within `
                + `${Math.round(QUEUED_APPROVAL_GRACE_TIMEOUT_MS / 1000)}s — auto-denied.\n`);
            const task = ctx.tasks.get(taskId);
            const command = typeof request.toolInput?.command === 'string' ? request.toolInput.command : undefined;
            ctx.observability?.recordAgentToolCommand({
                taskId,
                tenantLogin: task?.ownerLogin,
                agentId: task?.agentId,
                requestId: request.requestId,
                toolUseId: request.toolUseId,
                toolName: request.toolName,
                command,
                decision: 'reject',
            });
            try {
                ctx.processes.get(taskId)?.stdin?.write(buildQaiqControlResponseLine(
                    request,
                    'reject',
                    { denyMessage: buildQaiqQueuedApprovalTimeoutMessage(toolName) },
                ));
            } catch {
                // stdin already closed — the turn is over anyway.
            }
        }, QUEUED_APPROVAL_GRACE_TIMEOUT_MS);
        timers.set(request.requestId, timer);
}

export function clearQueuedApprovalTimerExtracted(ctx: QaapAgentTaskRunnerContext, taskId: string, requestId: string): void {
        const timers = ctx.queuedApprovalTimers.get(taskId);
        const timer = timers?.get(requestId);
        if (timers && timer) {
            clearTimeout(timer);
            timers.delete(requestId);
            if (timers.size === 0) {
                ctx.queuedApprovalTimers.delete(taskId);
            }
        }
}

export function clearQueuedApprovalTimersExtracted(ctx: QaapAgentTaskRunnerContext, taskId: string): void {
        const timers = ctx.queuedApprovalTimers.get(taskId);
        if (timers) {
            for (const timer of timers.values()) {
                clearTimeout(timer);
            }
            ctx.queuedApprovalTimers.delete(taskId);
        }
}

/**
 * Leader-exit reap of the agent's process group. A stop (user cancel, or a turn-watchdog pause that
 * ends the task `interrupted`) owns the longer `cancelExtracted` grace window so active tools can
 * finish cleanup; reaping here would SIGKILL the group early and defeat it.
 */
export function reapAgentProcessGroupOnExitExtracted(
    ctx: Pick<QaapAgentTaskRunnerContext, 'tasks' | 'stoppingTaskIds' | 'reapAgentProcessGroupAfterExit'>,
    taskId: string,
    child: ChildProcess,
): void {
    if (ctx.tasks.get(taskId)?.state === 'cancelled' || ctx.stoppingTaskIds.has(taskId)) {
        return;
    }
    ctx.reapAgentProcessGroupAfterExit(child);
}

/** Thrown inside spawnProcessExtracted when Stop settled the task before its agent could spawn. */
class QaapAgentSpawnSkippedError extends Error {
    constructor() {
        super('Stopped before the agent started');
        this.name = 'QaapAgentSpawnSkippedError';
    }
}

/** Longest a pre-spawn step may wait on another subsystem before the task fails with its stage. */
export const QAAP_TASK_START_STEP_TIMEOUT_MS = 60_000;

/**
 * Entry point of every start (create, queue drain): a rejection before the agent command is built used to
 * be an unhandled promise rejection, which left the task `running` with an empty log. The steps are
 * {@link spawnProcessWhenReadyStepsExtracted}; any error they throw ends the task as `failed` with the stage.
 */
export async function spawnProcessWhenReadyExtracted(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask, request: QaapCreateAgentTaskRequest): Promise<void> {
        const progress: { stage: string } = { stage: 'preferences' };
        try {
            await spawnProcessWhenReadyStepsExtracted(ctx, task, request, progress);
        } catch (error) {
            failTaskStartExtracted(ctx, task.id, error, progress.stage);
        }
}

/**
 * Records the task as `failed` with `Failed to start (<stage>): <message>`, unless Stop already settled it
 * (cancelled tasks keep their state) or a child process exists (its own exit handling owns the outcome).
 */
export function failTaskStartExtracted(ctx: QaapAgentTaskRunnerContext, taskId: string, error: unknown, stage: string): void {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.tasks.get(taskId)?.state !== 'running' || ctx.processes.has(taskId)) {
            console.warn(`[qaap-start] task=${taskId} stopped before spawn at ${stage}: ${message}`);
            return;
        }
        console.error(`[qaap-start] task=${taskId} failed to start before spawn: ${message}`);
        fs.mkdirSync(path.dirname(ctx.logPath(taskId)), { recursive: true });
        fs.writeFileSync(ctx.logPath(taskId), `Failed to start (${stage}): ${message}\n`, 'utf8');
        ctx.finishTask(taskId, 'failed', undefined);
}

/** Races a pre-spawn step against the start timeout; the timer is cleared when the step settles. */
function withStartStepTimeout<T>(ctx: QaapAgentTaskRunnerContext, step: Promise<T>): Promise<T> {
        const timeoutMs = ctx.taskStartStepTimeoutMs ?? QAAP_TASK_START_STEP_TIMEOUT_MS;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs >= 1000 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`}`)), timeoutMs);
        });
        return Promise.race([step, expired]).finally(() => {
            if (timer) {
                clearTimeout(timer);
            }
        });
}

async function spawnProcessWhenReadyStepsExtracted(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask, request: QaapCreateAgentTaskRequest, progress: { stage: string }): Promise<void> {
        if (ctx.preferenceService) {
            await withStartStepTimeout(ctx, ctx.preferenceService.ready);
        }
        progress.stage = 'spawn-gate';
        // Bounded caller preparation (e.g. the conversation's pre-turn worktree snapshot) must
        // finish before the agent can write.
        await withStartStepTimeout(ctx, awaitQaapAgentTaskSpawnGate(request));
        // Stop can arrive while preference initialization is pending, before a child exists.
        // Do not resurrect a task that cancel() has already transitioned out of running.
        if (ctx.tasks.get(task.id)?.state !== 'running') {
            return;
        }
        const markedTask = ctx.tasks.get(task.id) ?? task;
        progress.stage = 'worktree-baseline';
        const baseline = ctx.captureWorktreeBaseline(task.cwd);
        // Private disk copy of secrets — hashes alone cannot restore a destroyed `.env`.
        progress.stage = 'sensitive-files-snapshot';
        const sensitiveSnapshotDir = path.join(path.dirname(ctx.logPath(task.id)), task.id, 'sensitive-snapshot');
        const snapshotted = snapshotSensitiveFiles(task.cwd, sensitiveSnapshotDir);
        task = {
            ...markedTask,
            ...baseline,
            ...(snapshotted.length > 0 ? { sensitiveSnapshotDir } : {}),
        };
        ctx.tasks.set(task.id, task);
        void ctx.persist();
        let prompt = (request.prompt ?? '').trim();
        if (prompt) {
            // SessionStart / UserPromptSubmit hooks (doc/qaap-agent-hooks.md): may block or extend the prompt.
            progress.stage = 'pre-turn-hooks';
            const hookedPrompt = await applyPreTurnAgentHooks(ctx, task, prompt, request.agent);
            if (hookedPrompt === undefined) {
                return;
            }
            prompt = hookedPrompt;
            // Classified on the hooked, mention-stripped prompt so it matches what buildAgentCommand sees.
            progress.stage = 'prompt-classification';
            if (isConversationalTurn(ctx.stripLeadingAgentMention(prompt), request.userQuery)) {
                task = { ...task, conversationalTurn: true };
                ctx.tasks.set(task.id, task);
            }
            // A Pro model needs a confirmed sign-in: give a pending probe its budget before the guard decides.
            progress.stage = 'sign-in-check';
            const signInAgentId = ctx.normalizeAgentId(request.agent);
            if (signInAgentId) {
                await ctx.awaitAgentSessionSettled(signInAgentId, task.ownerLogin);
            }
            progress.stage = 'agent-command';
            try {
                ctx.recordTaskLatencyMark(task.id, 'build_agent_command_start');
                const autoApprove = task.autoApprove !== false;
                const agentModel = ctx.resolveAgentModelForRequest(request, prompt, task.ownerLogin);
                // Every agent CLI gets its own preview port in the preamble (not the one in .qaap/preview.json).
                const livePreviewPortHint = buildLivePreviewPortHint(ctx.reservedDevPreviewPort?.(task));
                const { command, stdinPrompt, stdinPromptMode, agentId, promptTempDir } = ctx.buildAgentCommand(
                    prompt,
                    request.agent,
                    autoApprove,
                    agentModel,
                    task.cwd,
                    [request.contextPreamble?.trim(), livePreviewPortHint].filter(Boolean).join('\n\n'),
                    request.interactionModeId,
                    request.approvalPolicyId,
                    request.toolApprovalRules,
                    request.userQuery,
                    task.readOnlyWorkspace,
                    task.ownerLogin,
                    request.effort,
                );
                ctx.recordTaskLatencyMark(task.id, 'build_agent_command_end');
                if (stdinPrompt) {
                    ctx.stdinPrompts.set(task.id, {
                        text: stdinPrompt,
                        mode: stdinPromptMode ?? 'qaiq-stdio',
                    });
                }
                if (promptTempDir) {
                    ctx.promptTempDirs.set(task.id, promptTempDir);
                }
                const commandTask = ctx.tasks.get(task.id) ?? task;
                const next: QaapAgentTask = {
                    ...commandTask,
                    command,
                    agentId,
                    ...(request.userQuery?.trim() ? { userRequest: request.userQuery.trim().slice(0, USER_REQUEST_MAX_CHARS) } : {}),
                    // Resolved here, not by the caller: only now is the concrete backend known (an
                    // unpinned dispatch falls through to the runner's own default agent).
                    ...(task.readOnlyWorkspace
                        ? { readOnlyEnforcement: ctx.noteReadOnlyEnforcement(task.id, agentId) }
                        : {}),
                    ...(agentModel ? { agentModel, qaiqModel: agentModel } : {}),
                };
                ctx.tasks.set(task.id, next);
                void ctx.persist();
                await ctx.spawnProcess(next);
                return;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                fs.mkdirSync(path.dirname(ctx.logPath(task.id)), { recursive: true });
                fs.writeFileSync(ctx.logPath(task.id), `${message}\n`, 'utf8');
                if (error instanceof QaapAgentSignInRequiredError) {
                    // Refused before spawn for a sign-in: another model of the same agent cannot fix it either.
                    const current = ctx.tasks.get(task.id);
                    if (current) {
                        ctx.tasks.set(task.id, { ...current, preflightFailure: 'sign_in_required' });
                    }
                }
                if (error instanceof QaapQaiqProviderKeyMissingError) {
                    // Refused before spawn for a missing key: no other model of this agent can fix it.
                    const current = ctx.tasks.get(task.id);
                    if (current) {
                        ctx.tasks.set(task.id, { ...current, preflightFailure: 'provider_key_missing' });
                    }
                }
                ctx.finishTask(task.id, 'failed', 1);
                return;
            }
        }
        progress.stage = 'spawn';
        await ctx.spawnProcess(task);
}

export async function spawnProcessExtracted(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask): Promise<void> {
        console.warn(formatTaskStartLog('spawn', task.id)); // [qaap-task-start] every process start (create, drain, retry, resume)
        fs.mkdirSync(path.dirname(ctx.logPath(task.id)), { recursive: true });
        const logStream = fs.createWriteStream(ctx.logPath(task.id), { flags: 'w' });
        const stdinPromptEntry = ctx.stdinPrompts.get(task.id);
        const stdinPrompt = typeof stdinPromptEntry === 'string'
            ? { text: stdinPromptEntry, mode: 'qaiq-stdio' }
            : stdinPromptEntry;
        // Harnesses gated through an HTTP extension (Pi) ask over the gate, not over stdin: a piped stdin
        // makes Pi block waiting for input, so they keep a closed stdin even under request-approval.
        // What the harness is and how it reaches the gate is decided by its adapter, not by comparing ids here.
        const harnessAdapter = QAAP_HARNESS_ADAPTER_REGISTRY.get(ctx.resolveTaskAgentId(task));
        const requestedAdapter = QAAP_HARNESS_ADAPTER_REGISTRY.get(task.agentId);
        const stdinInteractive = (task.autoApprove === false && harnessAdapter.gateWiring !== 'pi-extension'
            // Codex asks over its PreToolUse hook too; a piped stdin would make `codex exec` wait for EOF.
            && harnessAdapter.gateWiring !== 'codex-hook')
            || stdinPrompt !== undefined;
        const agentModel = resolveTaskAgentModel(task);
        // A shared Theia backend must never rewrite one global CLI settings file while another
        // tenant is spawning. Hosted workers own their HOME; until the worker itself applies a
        // model override inside that HOME, skip the unsafe host-side mutation.
        const restoreAntigravitySettings = !isQaapHostedEnvironment()
            && agentModel?.modelId?.trim()
            && isAntigravityCliCommand(task.command)
            ? applyAntigravityModelSetting(agentModel.modelId)?.restore
            : undefined;
        const finishAntigravitySettings = (): void => {
            restoreAntigravitySettings?.();
        };
        let child: ChildProcess;
        let childEnv: NodeJS.ProcessEnv | undefined;
        let codexGateOverlay: QaapCodexGateOverlay | undefined;
        let spawnCommand = task.command;
        let delegation: QaapDelegationWiring | undefined;
        // ACP mode of this harness (per-harness flag): the turn runs through the ACP bridge, which prints Claude stream-json.
        const acpFlavor = resolveQaapAcpFlavor(ctx.resolveTaskAgentId(task));
        try {
            ctx.enforceAgentIsolationPolicy();
            await ctx.ensureAgentCwdOwnershipAsync(task.cwd);
            await ctx.acquireTaskSandbox?.(task);
            // Bail out before recording a command start for a task Stop already settled.
            if (ctx.tasks.get(task.id)?.state !== 'running') {
                throw new QaapAgentSpawnSkippedError();
            }
            ctx.recordTaskLatencyMark(task.id, 'spawn_start');
            ctx.observability?.recordAgentCommandStarted(task, 'agent-cli');
            childEnv = ctx.buildChildEnv(task);
            // Settings → Harness binary path / configuration folder (desktop app only; empty elsewhere).
            // Applied before the Codex gate overlay, which copies the sign-in from CODEX_HOME.
            const launchPlan = resolveQaapHarnessLaunchPlan(
                task.harnessInstanceId ?? ctx.resolveTaskAgentId(task),
                key => ctx.preferenceReaderForOwner(task.ownerLogin)(key),
            );
            if (launchPlan.envNames?.length && ctx.harnessEnvSecrets) {
                // Values stay in the spawn env only: never in the command line, a log or the task record.
                const harnessKey = task.harnessInstanceId ?? ctx.resolveTaskAgentId(task);
                applyQaapHarnessUserEnv(childEnv, await ctx.harnessEnvSecrets.resolve(harnessKey, launchPlan.envNames));
            }
            if (launchPlan.homeEnvVar && launchPlan.homeDir) {
                childEnv[launchPlan.homeEnvVar] = launchPlan.homeDir;
            }
            if (launchPlan.binaryPath) {
                const harnessId = ctx.resolveTaskAgentId(task);
                spawnCommand = applyQaapHarnessBinaryOverride(
                    task.command,
                    ctx.detectedAgents.get(harnessId)?.bin ?? harnessId,
                    launchPlan.binaryPath,
                    quoteShellArg,
                );
            }
            if (harnessAdapter.gateWiring === 'opencode-plugin') {
                // Prove once per OpenCode version that the gate plugin loads and sees tool calls. Without the
                // proof the plugin is not wired and OpenCode's own `ask` rules keep refusing gated tools.
                const probe = await QAAP_OPENCODE_GATE_PROBE.ensure(resolveQaapToolGateOpencodePluginPath(), childEnv, 'opencode', ctx.resolveAgentSpawnIdentity(task.cwd));
                if (!probe.ok) {
                    logStream.write(`\n[qaap] OpenCode tool gate unavailable: ${probe.reason} Gated actions (edits, shell, network) are refused for this run.\n`);
                }
            }
            // Only the harness process gets gate credentials: issuing a token revokes the previous one.
            ctx.applyToolGateEnv(childEnv, task, { acpBridge: acpFlavor !== undefined });
            // Delegation (flag-gated, writable parent turns only): a separate token and a per-task server name.
            delegation = ctx.applyAgentDelegationEnv?.(childEnv, task);
            let delegationPlacement: QaapDelegationPlacement | undefined;
            if (delegation) {
                // A re-spawn of the same task (retry, resume) starts from clean delegation directories.
                releaseQaapDelegationMcpConfigFile(task.id);
                const identity = ctx.resolveAgentSpawnIdentity(task.cwd);
                const owner = typeof identity?.uid === 'number' ? { uid: identity.uid, ...(identity.gid !== undefined ? { gid: identity.gid } : {}) } : undefined;
                try {
                    // In a task sandbox the shim and the credential file go below its shared root (same path inside).
                    delegationPlacement = resolveQaapDelegationPlacement(task.id, ctx.agentSandboxFor?.(task.cwd), owner);
                } catch (error) {
                    console.warn(`[qaap-delegation] the turn runs without delegation: ${error instanceof Error ? error.message : String(error)}`);
                    delegation = undefined;
                    delete childEnv[QAAP_AGENT_DELEGATION_URL_ENV];
                    delete childEnv[QAAP_AGENT_DELEGATION_TOKEN_ENV];
                    releaseQaapDelegationMcpConfigFile(task.id);
                }
                if (delegation?.transport === 'claude-mcp-config' && delegationPlacement) {
                    // The config (with the token) goes to a private 0600 file; only its path is on the command line.
                    const file = writeQaapDelegationMcpConfigFile(task.id, buildQaapDelegationMcpConfig(delegationPlacement.options, delegation), owner, 'mcp.json', delegationPlacement.baseDir);
                    spawnCommand = appendQaapDelegationLaunchArgs(spawnCommand, file, quoteShellArg);
                } else if (delegation?.transport === 'opencode-config' && delegationPlacement) {
                    if (opencodeGatePluginSeeded(childEnv)) {
                        // Only next to the armed gate plugin: without it OpenCode's own rules refuse the tools anyway.
                        // The token goes to a private 0600 file; the inline config (inherited by OpenCode's bash and MCP servers) holds only its path.
                        if (!applyQaapOpencodeDelegation(childEnv, task.id, delegation, owner, writeQaapDelegationTokenFile, delegationPlacement)) {
                            delegation = undefined;
                        }
                    } else {
                        delegation = undefined;
                    }
                } else if (delegation?.transport === 'pi-extension' && delegationPlacement) {
                    // Only with Pi's gate extension in the command: a Pi turn without it runs ungated and gets no delegation.
                    // In a task sandbox the config and the extension go below its shared root, like the shim.
                    const piCommand = harnessAdapter.gateWiring === 'pi-extension' && spawnCommand.includes(' -e ') && childEnv.QAAP_GATE_TOKEN
                        ? applyQaapPiDelegation(childEnv, spawnCommand, task.id, delegation, owner, quoteShellArg, writeQaapDelegationMcpConfigFile, delegationPlacement)
                        : undefined;
                    if (piCommand) {
                        spawnCommand = piCommand;
                    } else {
                        delegation = undefined;
                    }
                }
            }
            // Fails closed before any Codex process: no token while the gate is wired means no gate for its tool calls.
            assertCodexGateTokenIssued({
                agentId: ctx.resolveTaskAgentId(task),
                gateWired: ctx.toolGateWired(),
                gateToken: childEnv.QAAP_GATE_TOKEN,
            });
            if (childEnv.QAAP_GATE_TOKEN && harnessAdapter.gateWiring === 'codex-hook') {
                // Fails closed: if the overlay cannot be built or Codex does not trust its hook, nothing runs.
                codexGateOverlay = await DEFAULT_QAAP_CODEX_GATE_OVERLAY_BUILDER.create({
                    taskId: task.id,
                    cwd: task.cwd,
                    folderTrusted: ctx.isProjectFolderTrusted(task.ownerLogin, task.cwd),
                    sourceCodexHome: resolveCodexAgentHome(childEnv),
                    // A harness instance's trust check runs its own Codex binary (undefined keeps the PATH `codex`).
                    codexBin: launchPlan.binaryPath,
                    askTtlSec: Number(childEnv.QAAP_GATE_ASK_TTL_SEC) || 0,
                    agentIdentity: ctx.resolveAgentSpawnIdentity(task.cwd),
                    // In a task sandbox Codex has its own /tmp: the overlay must sit where it sees the same path.
                    overlayRoot: resolveCodexGateOverlayRoot(ctx.agentSandboxFor?.(task.cwd)),
                    ownSandboxOff: ctx.runsInTaskSandbox?.() === true,
                    ...(delegation?.transport === 'codex-config'
                        ? { delegationMcp: { ...(delegationPlacement?.options ?? currentQaapDelegationMcpConfigOptions()), serverName: delegation.mcpServerName, instructions: QAAP_AGENT_DELEGATION_GUIDANCE } }
                        : {}),
                }, childEnv);
                childEnv.CODEX_HOME = codexGateOverlay.codexHome;
                if (codexGateOverlay.delegationSkipped) {
                    // The owner's shell policy could not be merged safely: no delegation this turn, and the token
                    // must not sit in Codex's environment (its shell tool would inherit it).
                    delegation = undefined;
                    delete childEnv[QAAP_AGENT_DELEGATION_URL_ENV];
                    delete childEnv[QAAP_AGENT_DELEGATION_TOKEN_ENV];
                }
                if (ctx.runsInTaskSandbox?.() === true) {
                    console.info('[qaap-codex] task sandbox container: Codex own sandbox off (container isolates)');
                }
            }
            if (acpFlavor) {
                // After the gate and delegation env: the bridge passes them to the agent as its flavor needs.
                // Staged after the delegation placement, which releases the task's sandbox directories first.
                const identity = ctx.resolveAgentSpawnIdentity(task.cwd);
                spawnCommand = resolveQaapAcpSpawnCommand({
                    flavor: acpFlavor,
                    taskId: task.id,
                    command: task.command,
                    autoApprove: task.autoApprove,
                    readOnlyWorkspace: task.readOnlyWorkspace,
                    sandbox: ctx.agentSandboxFor?.(task.cwd),
                    ...(typeof identity?.uid === 'number' ? { owner: { uid: identity.uid, ...(identity.gid !== undefined ? { gid: identity.gid } : {}) } } : {}),
                    ...(launchPlan.binaryPath ? { agentBin: launchPlan.binaryPath } : {}),
                    env: childEnv,
                    quoteShellArg,
                    // Design 3.8: no ACP agent outside a task sandbox in a hosted deployment.
                    requireSandbox: isQaapHostedEnvironment(),
                });
            }
            if (requestedAdapter.spawnQuirks.removesStaleSnapshotLocks) {
                // A run killed mid-snapshot leaves index.lock in the tenant's persistent data dir,
                // and every later OpenCode run then fails to create its snapshot lock.
                await removeStaleOpencodeSnapshotLocks(childEnv.XDG_DATA_HOME);
            }
            // Every await above (cwd ownership, sandbox, OpenCode probe, lock cleanup, Codex overlay)
            // is a window in which Stop can land. A task Stop already settled must not get a child.
            if (ctx.tasks.get(task.id)?.state !== 'running') {
                throw new QaapAgentSpawnSkippedError();
            }
            // Pipes stay attached (no unref()), so logging and stdio approvals are unaffected.
            child = ctx.spawnAgentCommand(spawnCommand, {
                cwd: task.cwd,
                env: childEnv,
                stdio: stdinInteractive ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
                // On Windows, cmd.exe can keep a detached child waiting after its stdin is closed.
                // Plain Codex stdin prompts therefore need a non-detached shell process.
                // POSIX: the agent leads its own process group, so a Stop signals the whole tree with kill(-pid).
                detached: globalThis.process.platform === 'win32' ? (stdinPrompt?.mode === 'plain' ? false : undefined) : true,
            });
            ctx.recordTaskLatencyMark(task.id, 'spawn_end');
        } catch (error) {
            finishAntigravitySettings();
            codexGateOverlay?.dispose();
            ctx.stdinPrompts.delete(task.id);
            removeAgentPromptTempDirHelper(ctx.promptTempDirs.get(task.id));
            releaseQaapDelegationMcpConfigFile(task.id);
            ctx.promptTempDirs.delete(task.id);
            // A step that failed after Stop settled the task (e.g. the sandbox start aborted) is a
            // skipped spawn too: finishing it as `failed` would overwrite `cancelled`.
            if (error instanceof QaapAgentSpawnSkippedError || ctx.tasks.get(task.id)?.state !== 'running') {
                // Stop already settled this task as cancelled: release what the spawn path took, keep that state.
                ctx.releaseTaskSandbox?.(task.id);
                logStream.end('Stopped before the agent started.\n');
                console.warn(`[qaap-stop] spawn-skipped task=${task.id} state=${ctx.tasks.get(task.id)?.state ?? 'missing'}`);
                return;
            }
            // The stack is the only backend record of a spawn that never produced an agent process.
            console.error(`[qaap-start] task=${task.id} failed to start: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            logStream.end(`Failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
            ctx.finishTask(task.id, 'failed', undefined);
            return;
        }
        ctx.processes.set(task.id, child);
        if (stdinInteractive) {
            ctx.stdinInteractiveTasks.add(task.id);
        }
        if (stdinPrompt !== undefined) {
            ctx.stdinPrompts.delete(task.id);
            try {
                if (stdinPrompt.mode === 'plain') {
                    // Codex reads the complete instruction from stdin when its prompt argument is `-`.
                    child.stdin?.end(stdinPrompt.text);
                } else {
                    ctx.qaiqStdioTasks.add(task.id);
                    // stream-json input: the prompt travels over stdin, which stays open
                    // for control_responses until the end-of-turn `result` message.
                    child.stdin?.write(buildQaiqStdioPromptLine(stdinPrompt.text));
                }
            } catch (error) {
                logStream.write(`\n[qaap] failed to write prompt to agent stdin: ${error instanceof Error ? error.message : String(error)}\n`);
            }
        }
        let changeScopeWatch: NodeJS.Timeout | undefined;
        const clearChangeScopeWatch = (): void => {
            if (changeScopeWatch) {
                clearInterval(changeScopeWatch);
                changeScopeWatch = undefined;
            }
        };
        const changedFilesLimit = resolveAgentTaskChangedFilesLimit(process.env);
        // Without a baseline, pre-existing dirty files would count against the cap.
        if (changedFilesLimit !== undefined && task.worktreeBaselinePaths !== undefined) {
            changeScopeWatch = setInterval(() => {
                if (ctx.tasks.get(task.id)?.state !== 'running') {
                    clearChangeScopeWatch();
                    return;
                }
                if (enforceAgentTaskChangeScopeLimitExtracted(ctx, task.id, task.cwd, task.worktreeBaselinePaths, child, changedFilesLimit)) {
                    clearChangeScopeWatch();
                }
            }, CHANGE_SCOPE_WATCH_INTERVAL_MS);
            changeScopeWatch.unref?.();
        }
        let idleTimer: NodeJS.Timeout | undefined;
        const clearIdleTimer = (): void => {
            if (idleTimer) {
                clearTimeout(idleTimer);
                idleTimer = undefined;
            }
        };
        const bumpIdleTimer = (): void => {
            clearIdleTimer();
            idleTimer = setTimeout(() => {
                if (expireIdleAgentTask(ctx, task.id, child, logStream) === 'waiting-for-user') {
                    bumpIdleTimer();
                }
            }, IDLE_TASK_TIMEOUT_MS);
        };
        bumpIdleTimer();
        let stdioLineBuffer = '';
        // PreToolUse hooks hold a control request while they run; "no decision" re-feeds the line.
        const preToolUseHookGate = createQaiqPreToolUseHookGate(ctx, task, logStream, line => {
            stdioLineBuffer = `${line}\n${stdioLineBuffer}`;
            scanStdioApprovalChunk('');
        });
        // Read lazily (first control request) and once per run: the reader hits the per-tenant settings file.
        let autoApproveReadOnlyShell: boolean | undefined;
        // The agent shell keeps its cwd between calls; after any cd the classifier's cwd is stale.
        let shellCwdMayHaveMoved = false;
        const readAutoApproveReadOnlyShell = (): boolean => {
            if (shellCwdMayHaveMoved) {
                return false;
            }
            if (autoApproveReadOnlyShell === undefined) {
                try {
                    autoApproveReadOnlyShell = resolveAutoApproveReadOnlyShellPreference(
                        ctx.preferenceReaderForOwner(task.ownerLogin)(QAAP_AUTO_APPROVE_READONLY_SHELL_PREF),
                    );
                } catch {
                    autoApproveReadOnlyShell = resolveAutoApproveReadOnlyShellPreference(undefined);
                }
            }
            return autoApproveReadOnlyShell;
        };
        const scanStdioApprovalChunk = (chunk: unknown): void => {
            stdioLineBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            let newline: number;
            while ((newline = stdioLineBuffer.indexOf('\n')) >= 0) {
                const line = stdioLineBuffer.slice(0, newline);
                stdioLineBuffer = stdioLineBuffer.slice(newline + 1);
                const event = parseQaiqStdioEvent(line);
                if (!event) {
                    continue;
                }
                if (event.type === 'control-request') {
                    if (preToolUseHookGate.screen(event.request, line)) {
                        continue;
                    }
                    const gateOutcome = (ctx.toolGate ?? DEFAULT_QAAP_TOOL_GATE_SERVICE).evaluateQaiqControlRequest({
                        command: task.command,
                        autoApprove: task.autoApprove,
                        request: event.request,
                        cwd: task.cwd,
                        options: {
                            autoApproveReadOnlyShell: readAutoApproveReadOnlyShell(),
                            allowSubagentTools: harnessAdapter.spawnQuirks.allowsSubagentTools,
                            ...(delegation ? { delegationServer: delegation.mcpServerName } : {}),
                            cwd: task.cwd,
                            checkGitExecConfig: () => ctx.checkGitExecConfig(task.cwd),
                            checkPathsInsideCwd: paths => ctx.checkShellPathsInsideCwd(task.cwd, paths),
                        },
                        reservedPort: () => ctx.reservedDevPreviewPort?.(task),
                    });
                    const autoAction = gateOutcome.action;
                    if (gateOutcome.readOnlyBlockedReason) {
                        logStream.write(`\n[qaap] read-only shell command needs approval: ${gateOutcome.readOnlyBlockedReason}.\n`);
                    }
                    const command = typeof event.request.toolInput?.command === 'string'
                        ? event.request.toolInput.command
                        : undefined;
                    if (!shellCwdMayHaveMoved && commandMayChangeShellCwd(command)) {
                        shellCwdMayHaveMoved = true;
                    }
                    ctx.observability?.recordAgentToolCommand({
                        taskId: task.id,
                        tenantLogin: task.ownerLogin,
                        agentId: task.agentId,
                        requestId: event.request.requestId,
                        toolUseId: event.request.toolUseId,
                        toolName: event.request.toolName,
                        command,
                        decision: gateOutcome.observabilityDecision,
                        ...(gateOutcome.reason ? { autoApprovalReason: gateOutcome.reason } : {}),
                    });
                    if (autoAction !== 'queue') {
                        const reservedPort = gateOutcome.reservedPort;
                        const devServerDenial = gateOutcome.devServerDenial;
                        const destructiveDenial = gateOutcome.destructiveDenial;
                        const denyMessage = gateOutcome.denyMessage;
                        if (gateOutcome.reason === 'read-only-shell') {
                            logStream.write(`\n[qaap] auto-approved: read-only shell command (${gateOutcome.detail ?? 'read-only'}).\n`);
                        } else if (devServerDenial) {
                            logStream.write('\n[qaap] auto-denied long-lived dev-server shell command; Qaap manages dev servers via the preview bootstrap.\n');
                        } else if (destructiveDenial) {
                            logStream.write('\n[qaap] auto-denied destructive shell command; the agent must propose it for explicit user approval.\n');
                        }
                        const writeControlResponse = (message: string | undefined): void => {
                            try {
                                child.stdin?.write(buildQaiqControlResponseLine(
                                    event.request,
                                    autoAction === 'allow' ? 'approve' : 'reject',
                                    message ? { denyMessage: message } : {},
                                ));
                            } catch {
                                // stdin already closed — the turn is over anyway.
                            }
                        };
                        if (devServerDenial && reservedPort !== undefined) {
                            // The denial states the live preview's measured health, so it is answered once the probe settles.
                            void probeReservedDevPreviewStatus(reservedPort).then(previewStatus => {
                                writeControlResponse(findQaiqDevServerGuardDenial(event.request, { reservedPort, previewStatus }) ?? devServerDenial);
                            });
                            continue;
                        }
                        writeControlResponse(denyMessage);
                        continue;
                    }
                    const pending = ctx.pendingQaiqControlRequests.get(task.id) ?? [];
                    pending.push(event.request);
                    ctx.pendingQaiqControlRequests.set(task.id, pending);
                    // "Request approval" runs wait indefinitely; auto-approve runs get a
                    // grace window so an unattended turn still finishes.
                    if (gateOutcome.scheduleQueueTimeout) {
                        ctx.scheduleQueuedApprovalTimeout(task.id, event.request, logStream);
                    }
                } else if (event.type === 'control-cancel') {
                    preToolUseHookGate.cancel(event.requestId);
                    const pending = ctx.pendingQaiqControlRequests.get(task.id);
                    const index = pending?.findIndex(entry => entry.requestId === event.requestId) ?? -1;
                    if (pending && index >= 0) {
                        pending.splice(index, 1);
                    }
                    ctx.clearQueuedApprovalTimer(task.id, event.requestId);
                } else if (event.type === 'result') {
                    // End of turn — close stdin so the headless CLI exits.
                    try {
                        child.stdin?.end();
                    } catch {
                        // Already closed — nothing to do.
                    }
                }
            }
        };
        // Pi exits 0 after a provider error; its JSON stream is the only place the failure shows.
        const piProviderErrorWatcher = requestedAdapter.spawnQuirks.watchesProviderErrors ? createPiProviderErrorWatcher() : undefined;
        // Claude Code may take long to exit after its final `result` (telemetry / update checks behind
        // the egress allowlist) while the answer is already complete: end it after a short grace.
        // The ACP bridge ends its stream with a Claude `result` line too (and exits right after it).
        const finalResultWatcher = requestedAdapter.spawnQuirks.emitsStreamJsonFinalResult || qaapAcpFlavorPrintsStreamJson(acpFlavor)
            ? new QaapAgentFinalResultWatcher()
            : undefined;
        let exitAfterResultTimer: ReturnType<typeof setTimeout> | undefined;
        let endedAfterResult: QaapAgentFinalResult | undefined;
        // agy without a usable session waits 60 s for a pasted code: stop it on its first sign-in wait line.
        const agySignInWatcher = harnessAdapter.spawnQuirks.watchesSignInWait ? createAgySignInWaitWatcher() : undefined;
        const stopOnAgySignInWait = (chunk: unknown): void => {
            if (!agySignInWatcher?.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
                || ctx.tasks.get(task.id)?.state !== 'running') {
                return;
            }
            logStream.write('\n[qaap] Antigravity is waiting for a sign-in; stopping the run. Sign in to Antigravity and retry.\n');
            clearIdleTimer();
            ctx.killAgentProcessTree(child);
        };
        child.stdout?.on('data', chunk => {
            if (finalResultWatcher && !exitAfterResultTimer) {
                const finalResult = finalResultWatcher.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
                if (finalResult) {
                    exitAfterResultTimer = setTimeout(() => {
                        if (ctx.processes.get(task.id) !== child || child.exitCode !== null || child.signalCode !== null) {
                            return;
                        }
                        console.warn(`[qaap-agent-tasks] ${task.id}: ${task.agentId} still running ${QAAP_AGENT_EXIT_AFTER_RESULT_GRACE_MS}ms after its final result; ending it`);
                        endedAfterResult = finalResult;
                        ctx.killAgentProcessTree(child);
                    }, QAAP_AGENT_EXIT_AFTER_RESULT_GRACE_MS);
                    exitAfterResultTimer.unref?.();
                }
            }
            if (isAgentProgressChunk(chunk)) {
                bumpIdleTimer();
            }
            ctx.recordTaskLatencyMark(task.id, 'first_stdout_chunk');
            logStream.write(chunk);
            ctx.fireOutput(task.id, chunk);
            piProviderErrorWatcher?.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
            if (ctx.qaiqStdioTasks.has(task.id)) {
                scanStdioApprovalChunk(chunk);
            }
            stopOnAgySignInWait(chunk);
        });
        // OpenCode keeps running after a quota error and prints nothing on stdout: stop the run here
        // so the task settles `failed` with the provider reason in its log, not after the idle timeout.
        const opencodeFatalWatcher = requestedAdapter.spawnQuirks.watchesFatalStderr
            ? createOpencodeFatalStderrWatcher()
            : undefined;
        child.stderr?.on('data', chunk => {
            bumpIdleTimer();
            ctx.recordTaskLatencyMark(task.id, 'first_stdout_chunk');
            logStream.write(chunk);
            ctx.fireOutput(task.id, chunk);
            stopOnAgySignInWait(chunk);
            const fatalError = opencodeFatalWatcher?.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
            if (fatalError !== undefined && ctx.tasks.get(task.id)?.state === 'running') {
                logStream.write(`\n[qaap] OpenCode reported: ${fatalError}\n`);
                clearIdleTimer();
                ctx.killAgentProcessTree(child);
            }
        });
        // The gate plugin reports in at startup (`/arm`). The inline `ask` baseline keeps every gated tool
        // refused until then, so a plugin that never arms cannot let anything through: fail the task loudly.
        if (childEnv && opencodeGatePluginSeeded(childEnv)) {
            const stopArmWatch = startOpencodeArmWatch({
                isArmed: () => ctx.isToolGateArmed(task.id),
                isRunning: () => ctx.tasks.get(task.id)?.state === 'running',
                timeoutMs: resolveOpencodeArmTimeoutMs(childEnv),
                onTimeout: () => {
                    logStream.write('\n[qaap] OpenCode tool gate plugin did not start; cancelling the run (nothing was allowed without the gate).\n', () => {
                        if (ctx.tasks.get(task.id)?.state !== 'running') {
                            return;
                        }
                        clearIdleTimer();
                        ctx.killAgentProcessTree(child);
                        ctx.finishTask(task.id, 'failed', 1);
                    });
                },
            });
            child.once('exit', stopArmWatch);
        }
        child.on('error', error => {
            logStream.write(`\n[qaap] process error: ${error.message}\n`);
        });
        child.once('exit', () => {
            ctx.recordTaskLatencyMark(task.id, 'process_exit');
            logCancelExitExtracted(ctx, task.id);
            reapAgentProcessGroupOnExitExtracted(ctx, task.id, child);
            // The slot of a stopped task is held until the process is really gone.
            releaseStoppingTaskSlotOnExitExtracted(ctx, task.id);
        });
        child.on('close', exitCode => {
            clearTimeout(exitAfterResultTimer);
            // The turn's usage from its final result line, kept on the task: the conversation settle copies it to the turn verdict.
            // Only with delegation on (its cost totals read it): with the flag off the persisted task is unchanged.
            const turnUsage = isQaapAgentDelegationEnabled(process.env) ? finalResultWatcher?.result?.usage : undefined;
            const usageTask = ctx.tasks.get(task.id);
            if (turnUsage && usageTask?.state === 'running') {
                ctx.tasks.set(task.id, { ...usageTask, usage: turnUsage });
                void ctx.persist();
            }
            // Ended by Qaap after a complete result: settle on the result, not on the kill signal.
            const code = exitCode === null && endedAfterResult ? (endedAfterResult.isError ? 1 : 0) : exitCode;
            clearChangeScopeWatch();
            clearIdleTimer();
            finishAntigravitySettings();
            codexGateOverlay?.dispose();
            logStream.end();
            ctx.processes.delete(task.id);
            ctx.deletedTaskIds.delete(task.id);
            ctx.stdinInteractiveTasks.delete(task.id);
            ctx.stdinPrompts.delete(task.id);
            removeAgentPromptTempDirHelper(ctx.promptTempDirs.get(task.id));
            ctx.promptTempDirs.delete(task.id);
            ctx.pendingQaiqControlRequests.delete(task.id);
            ctx.clearQueuedApprovalTimers(task.id);
            ctx.qaiqStdioTasks.delete(task.id);
            // A SIGTERM-killed task is already marked 'cancelled' by cancel().
            if (ctx.tasks.get(task.id)?.state !== 'running') {
                return;
            }
            if (ctx.tasks.get(task.id)?.scopeLimitExceededFiles?.length) {
                ctx.finishTask(task.id, 'completed_with_warnings', code ?? undefined);
                return;
            }
            // A Pi provider error is a failed turn even though the process exited 0.
            const piProviderError = piProviderErrorWatcher?.finalError();
            const turnFailed = code !== 0 || piProviderError !== undefined;
            const settledExitCode = code === 0 && turnFailed ? 1 : code ?? undefined;
            if (!turnFailed && QAAP_AGENT_VERIFY_ENABLED && !isConversationalTurnTask(ctx.tasks.get(task.id) ?? task)) {
                void ctx.finishSuccessfulTaskAfterVerification(task, code ?? undefined);
                return;
            }
            if (turnFailed && childEnv && canProbeProviderKey(childEnv, agentModel?.vendor, agentModel?.modelId)) {
                // QAIQ blames "the selected model" for any OpenRouter 4xx: ask OpenRouter about the
                // BYOK key before settling, so the failure names the key instead of the model. A
                // global cap keeps a stuck stream or probe from leaving the task `running`.
                let capTimer: ReturnType<typeof setTimeout> | undefined;
                void Promise.race([
                    explainProviderKeyFailure(ctx, task.id, logStream, childEnv, agentModel),
                    new Promise<void>(resolve => {
                        capTimer = setTimeout(resolve, PROVIDER_KEY_EXPLAIN_TIMEOUT_MS);
                    }),
                ])
                    .finally(() => {
                        clearTimeout(capTimer);
                        if (ctx.tasks.get(task.id)?.state === 'running') {
                            ctx.finishTask(task.id, 'failed', settledExitCode);
                        }
                    });
                return;
            }
            ctx.finishTask(task.id, turnFailed ? 'failed' : 'completed', settledExitCode);
        });
}

/** Upper bound on waiting for the log flush plus the provider preflight before settling. */
const PROVIDER_KEY_EXPLAIN_TIMEOUT_MS = 10_000;

async function explainProviderKeyFailure(
    ctx: QaapAgentTaskRunnerContext,
    taskId: string,
    logStream: fs.WriteStream,
    env: NodeJS.ProcessEnv,
    agentModel: { readonly vendor?: string; readonly modelId?: string } | undefined,
): Promise<void> {
    try {
        if (logStream.errored || logStream.destroyed) {
            return;
        }
        if (!logStream.writableFinished) {
            await new Promise<void>(resolve => {
                logStream.once('finish', resolve);
                logStream.once('error', () => resolve());
            });
        }
        const logPath = ctx.logPath(taskId);
        const log = await fs.promises.readFile(logPath, 'utf8');
        const preflight = await runProviderKeyPreflight({ log, env, vendor: agentModel?.vendor, modelId: agentModel?.modelId });
        if (preflight) {
            const current = ctx.tasks.get(taskId);
            if (current?.state !== 'running') {
                return;
            }
            // Recorded on the task so a rejected key or missing credits never triggers a silent
            // fallback-model retry: every model of this agent runs on the same key.
            ctx.tasks.set(taskId, { ...current, providerKeyVerdict: preflight.verdict });
            await fs.promises.appendFile(logPath, `\n${preflight.note}\n`, 'utf8');
            ctx.fireOutput(taskId, `\n${preflight.note}\n`);
        }
    } catch {
        /* best effort: the run already failed; keep its own reason */
    }
}

export function maxConcurrentVerificationPassesExtracted(ctx: QaapAgentTaskRunnerContext): number {
        const raw = process.env.QAAP_AGENT_VERIFY_MAX_CONCURRENT?.trim();
        const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : ctx.maxConcurrentAgents();
}

export function acquireVerificationPassExtracted(ctx: QaapAgentTaskRunnerContext): Promise<void> {
        if (ctx.activeVerificationPasses < ctx.maxConcurrentVerificationPasses()) {
            ctx.activeVerificationPasses++;
            return Promise.resolve();
        }
        return new Promise(resolve => {
            ctx.verificationPassWaiters.push(resolve);
        });
}
