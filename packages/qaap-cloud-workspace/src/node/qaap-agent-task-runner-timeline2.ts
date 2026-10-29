import { usesToolGateExtension } from './qaap-tool-gate-pi-adapter';
import { QAAP_OPENCODE_GATE_PROBE } from './qaap-tool-gate-opencode-probe';
import {
    opencodeGatePluginSeeded,
    resolveOpencodeArmTimeoutMs,
    resolveQaapToolGateOpencodePluginPath,
    startOpencodeArmWatch,
    usesOpencodeGatePlugin,
} from './qaap-tool-gate-opencode-adapter';
import { IDLE_TASK_TIMEOUT_MS, QAAP_AGENT_VERIFY_ENABLED, QUEUED_APPROVAL_GRACE_TIMEOUT_MS, USER_REQUEST_MAX_CHARS } from './qaap-agent-task-runner-constants';
import { QaapQaiqProviderKeyMissingError } from './qaap-qaiq-provider-preflight';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { awaitQaapAgentTaskSpawnGate } from './qaap-agent-task-spawn-gate';
import { resolveAgentTaskBillingRejection } from './qaap-agent-task-billing-gate';
import { finishTaskWithPauseCause } from './qaap-agent-task-runner-streaming2';
import { createOpencodeFatalStderrWatcher } from './qaap-opencode-fatal-error';
import { removeStaleOpencodeSnapshotLocks } from './qaap-opencode-snapshot-lock';
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
} from './qaap-agent-task-runner-utils';
import { applyPreTurnAgentHooks, createQaiqPreToolUseHookGate } from './qaap-agent-task-runner-hooks';
import { canProbeProviderKey, runProviderKeyPreflight } from './qaap-provider-key-preflight';
import { isConversationalTurn, isConversationalTurnTask } from '../common/qaap-agent-conversational-turn';

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

export function killAgentProcessTreeExtracted(ctx: QaapAgentTaskRunnerContext, child: ChildProcess,
        options?: { readonly escalateAfterMs?: number; readonly onGracePeriodElapsed?: () => void },): NodeJS.Timeout | undefined {
        const pid = child.pid;
        if (!pid) {
            options?.onGracePeriodElapsed?.();
            return undefined;
        }
        const sendSignal = (signal: NodeJS.Signals): void => {
            if (globalThis.process.platform === 'win32') {
                spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
                return;
            }
            try {
                globalThis.process.kill(-pid, signal);
                return;
            } catch { /* process group already gone; try the leader below */ }
            try {
                child.kill(signal);
            } catch { /* already gone */ }
        };
        sendSignal('SIGTERM');
        const escalateAfterMs = options?.escalateAfterMs ?? 5_000;
        const sendKill = (): void => {
            try {
                sendSignal('SIGKILL');
            } finally {
                options?.onGracePeriodElapsed?.();
            }
        };
        if (escalateAfterMs <= 0) {
            sendKill();
            return undefined;
        }
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

export async function spawnProcessWhenReadyExtracted(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask, request: QaapCreateAgentTaskRequest): Promise<void> {
        if (ctx.preferenceService) {
            await ctx.preferenceService.ready;
        }
        // Bounded caller preparation (e.g. the conversation's pre-turn worktree snapshot) must
        // finish before the agent can write.
        await awaitQaapAgentTaskSpawnGate(request);
        // Stop can arrive while preference initialization is pending, before a child exists.
        // Do not resurrect a task that cancel() has already transitioned out of running.
        if (ctx.tasks.get(task.id)?.state !== 'running') {
            return;
        }
        // Fail-open only for BYOK turns on a billing outage; hosted Codex fails closed (billing gate).
        const billingRejection = await resolveAgentTaskBillingRejection(ctx, task, request);
        // The billing read is async: a stop that landed meanwhile already settled the task as
        // `cancelled`. Neither fail it (that would overwrite `cancelled`) nor spawn it.
        if (ctx.tasks.get(task.id)?.state !== 'running') {
            return;
        }
        if (billingRejection !== undefined) {
            fs.mkdirSync(path.dirname(ctx.logPath(task.id)), { recursive: true });
            fs.writeFileSync(ctx.logPath(task.id), `${billingRejection}\n`, 'utf8');
            ctx.finishTask(task.id, 'failed', 1);
            return;
        }
        const markedTask = ctx.tasks.get(task.id) ?? task;
        const baseline = ctx.captureWorktreeBaseline(task.cwd);
        // Private disk copy of secrets — hashes alone cannot restore a destroyed `.env`.
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
            const hookedPrompt = await applyPreTurnAgentHooks(ctx, task, prompt, request.agent);
            if (hookedPrompt === undefined) {
                return;
            }
            prompt = hookedPrompt;
            // Classified on the hooked, mention-stripped prompt so it matches what buildAgentCommand sees.
            if (isConversationalTurn(ctx.stripLeadingAgentMention(prompt), request.userQuery)) {
                task = { ...task, conversationalTurn: true };
                ctx.tasks.set(task.id, task);
            }
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
        await ctx.spawnProcess(task);
}

export async function spawnProcessExtracted(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask): Promise<void> {
        fs.mkdirSync(path.dirname(ctx.logPath(task.id)), { recursive: true });
        const logStream = fs.createWriteStream(ctx.logPath(task.id), { flags: 'w' });
        const stdinPromptEntry = ctx.stdinPrompts.get(task.id);
        const stdinPrompt = typeof stdinPromptEntry === 'string'
            ? { text: stdinPromptEntry, mode: 'qaiq-stdio' }
            : stdinPromptEntry;
        // Harnesses gated through an HTTP extension (Pi) ask over the gate, not over stdin: a piped stdin
        // makes Pi block waiting for input, so they keep a closed stdin even under request-approval.
        const stdinInteractive = (task.autoApprove === false && !usesToolGateExtension(ctx.resolveTaskAgentId(task)))
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
        try {
            ctx.enforceAgentIsolationPolicy();
            await ctx.ensureAgentCwdOwnershipAsync(task.cwd);
            await ctx.acquireTaskSandbox?.(task);
            ctx.recordTaskLatencyMark(task.id, 'spawn_start');
            ctx.observability?.recordAgentCommandStarted(task, 'agent-cli');
            childEnv = ctx.buildChildEnv(task);
            if (usesOpencodeGatePlugin(ctx.resolveTaskAgentId(task))) {
                // Prove once per OpenCode version that the gate plugin loads and sees tool calls. Without the
                // proof the plugin is not wired and OpenCode's own `ask` rules keep refusing gated tools.
                const probe = await QAAP_OPENCODE_GATE_PROBE.ensure(resolveQaapToolGateOpencodePluginPath(), childEnv, 'opencode', ctx.resolveAgentSpawnIdentity(task.cwd));
                if (!probe.ok) {
                    logStream.write(`\n[qaap] OpenCode tool gate unavailable: ${probe.reason} Gated actions (edits, shell, network) are refused for this run.\n`);
                }
            }
            // Only the harness process gets gate credentials: issuing a token revokes the previous one.
            ctx.applyToolGateEnv(childEnv, task);
            if (task.agentId?.trim().toLowerCase() === 'opencode') {
                // A run killed mid-snapshot leaves index.lock in the tenant's persistent data dir,
                // and every later OpenCode run then fails to create its snapshot lock.
                await removeStaleOpencodeSnapshotLocks(childEnv.XDG_DATA_HOME);
            }
            // Pipes stay attached (no unref()), so logging and stdio approvals are unaffected.
            child = ctx.spawnAgentCommand(task.command, {
                cwd: task.cwd,
                env: childEnv,
                stdio: stdinInteractive ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
                // On Windows, cmd.exe can keep a detached child waiting after its stdin is closed.
                // Plain Codex stdin prompts therefore need a non-detached shell process.
                detached: stdinPrompt?.mode === 'plain' ? false : undefined,
            });
            ctx.recordTaskLatencyMark(task.id, 'spawn_end');
        } catch (error) {
            finishAntigravitySettings();
            ctx.stdinPrompts.delete(task.id);
            removeAgentPromptTempDirHelper(ctx.promptTempDirs.get(task.id));
            ctx.promptTempDirs.delete(task.id);
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
        child.stdout?.on('data', chunk => {
            if (isAgentProgressChunk(chunk)) {
                bumpIdleTimer();
            }
            ctx.recordTaskLatencyMark(task.id, 'first_stdout_chunk');
            logStream.write(chunk);
            ctx.fireOutput(task.id, chunk);
            if (ctx.qaiqStdioTasks.has(task.id)) {
                scanStdioApprovalChunk(chunk);
            }
        });
        // OpenCode keeps running after a quota error and prints nothing on stdout: stop the run here
        // so the task settles `failed` with the provider reason in its log, not after the idle timeout.
        const opencodeFatalWatcher = task.agentId?.trim().toLowerCase() === 'opencode'
            ? createOpencodeFatalStderrWatcher()
            : undefined;
        child.stderr?.on('data', chunk => {
            bumpIdleTimer();
            ctx.recordTaskLatencyMark(task.id, 'first_stdout_chunk');
            logStream.write(chunk);
            ctx.fireOutput(task.id, chunk);
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
        child.once('exit', () => reapAgentProcessGroupOnExitExtracted(ctx, task.id, child));
        child.on('close', code => {
            clearChangeScopeWatch();
            clearIdleTimer();
            finishAntigravitySettings();
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
            if (code === 0 && QAAP_AGENT_VERIFY_ENABLED && !isConversationalTurnTask(ctx.tasks.get(task.id) ?? task)) {
                void ctx.finishSuccessfulTaskAfterVerification(task, code ?? undefined);
                return;
            }
            if (code !== 0 && childEnv && canProbeProviderKey(childEnv, agentModel?.vendor, agentModel?.modelId)) {
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
                            ctx.finishTask(task.id, 'failed', code ?? undefined);
                        }
                    });
                return;
            }
            ctx.finishTask(task.id, code === 0 ? 'completed' : 'failed', code ?? undefined);
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
