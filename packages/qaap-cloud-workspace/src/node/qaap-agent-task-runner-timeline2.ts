// @ts-nocheck
import { STORE_DIR, IDLE_TASK_TIMEOUT_MS,QAAP_AGENT_VERIFY_ENABLED,QUEUED_APPROVAL_GRACE_TIMEOUT_MS } from './qaap-agent-task-runner';
// Extracted from qaap-agent-task-runner.ts

import { Emitter, Event } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { ChildProcess, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { writeJsonAtomic, writeJsonAtomicSync } from './qaap-write-json-atomic';
import * as os from 'os';
import * as path from 'path';
import {
    buildImproveComposerPromptRequest,
} from '@theia/qaap-mobile-shell/lib/common/qaap-composer-prompt-improve';
import {
    isQaapAgentTaskFinished,
    type QaapAgentDescriptor,
    type QaapCreateAgentTaskQaiqModel,
    type QaapQaiqModelOption,
    type QaapAgentTask,
    type QaapAgentTaskCwdGroup,
    type QaapAgentTaskDetail,
    type QaapAgentTaskEvent,
    type QaapAgentTaskReview,
    type QaapAgentTaskState,
    type QaapAgentTaskVerification,
    type QaapCreateAgentTaskRequest,
    type QaapAgentWarmResult,
} from '../common/qaap-agent-task';
import { isQaapWorkspaceContainerPath, QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import type { QaapTurnLatencyMark } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import {
    QAAP_BUILTIN_AGENT_DEFINITIONS,
    QAAP_BUILTIN_AGENT_IDS,
    isUiHiddenVpsAgent,
    resolveQaapBuiltinAgentMentionId,
    resolveQaapCodexTemplate,
} from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
import { LEGACY_OPENCLAUDE_AGENT_ID, resolveQaapAgentMentionToken } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import {
    formatQaiqInteractionFlags,
    type QaapQaiqInteractionFlagOptions,
} from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-interaction-flags';
import type { QaapAgentApprovalPolicyId } from '@theia/qaap-mobile-shell/lib/common/qaap-sticky-composer-approval-policy';
import { agentUsesSettingsModelCatalog } from '../common/qaap-agent-native-model-catalog';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { listNativeAgentModels } from './qaap-agent-native-models';
import { canStartNewAgentJob, hostedModelDenialReason, isHostedCodexUsage } from '../common/qaap-billing-plans';
import { listQaiqModelsFromPreferences } from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-model-catalog';
import {
    applyAgentApprovalPolicyToCommand,
    shouldUseQaiqStdioApprovals,
} from '../common/qaap-agent-approval-flags';
import {
    type QaapAgentReadOnlyEnforcement,
} from '../common/qaap-agent-readonly-workspace';
import {
    QAIQ_STDIO_APPROVAL_FLAGS,
    buildQaiqControlResponseLine,
    buildQaiqStdioPromptLine,
    parseQaiqStdioEvent,
    type QaapQaiqPendingControlRequest,
} from '../common/qaap-qaiq-stdio-approvals';
import { findQaiqDestructiveCommandGuardDenial } from '../common/qaap-agent-destructive-command-guard';
import { findQaiqDevServerGuardDenial } from '../common/qaap-agent-dev-server-guard';
import { detectEmptyAgentTurn, type QaapEmptyAgentTurnResult } from '../common/qaap-agent-empty-turn';
import {
    buildQaiqAutoDeniedToolMessage,
    buildQaiqQueuedApprovalTimeoutMessage,
    resolveQaiqControlRequestAutoAction,
} from '../common/qaap-qaiq-control-auto-response';
import {
    resolveAgentAutoApprove,
} from '../common/qaap-agent-auto-approve';
import { filterAgentProcessLogChunk } from '../common/qaap-agent-log-filter';
import { formatModelFlagsForAgent } from '../common/qaap-agent-model-flags';
import {
    applyQaapQaiqCredentialEnv,
    applyQaapQaiqModelEnv,
    bindingFromQaiqModelSelection,
    formatQaiqProviderFlags,
    normalizeQaiqModelBinding,
    resolveQaapQaiqModelBinding,
    type QaapQaiqModelBinding,
} from '../common/qaap-qaiq-model-binding';
import { resolveRequestAgentModel, resolveTaskAgentModel } from '../common/qaap-agent-task';
import { resolveEffectiveRequestAgentModel } from '../common/qaap-agent-task-model-routing';
import {
    parseQaapNativeModelRoutingTable,
    QAAP_AGENT_TASK_MODELS_ENV,
    type QaapNativeModelRoutingTable,
} from '../common/qaap-agent-native-model-routing';
import { appendAgentDefaultWorkflowToPrompt } from '../common/qaap-agent-default-workflow';
import { prependAgentTaskContextToPrompt, type QaapAgentRepoContext } from '../common/qaap-agent-task-context';
import {
    applyAntigravityModelSetting,
    isAntigravityCliCommand,
} from './qaap-antigravity-settings';
import { QaapWebPushService } from './qaap-web-push-service';
import { QaapWorkflowRoutingPolicy } from '../common/qaap-workflow-routing';
import { QaapAgentHealthTracker } from './qaap-agent-health';
import { hashSensitiveFiles, restoreSensitiveFiles, snapshotSensitiveFiles } from './qaap-sensitive-files';
import { buildQaapAgentRepoProfile } from './qaap-agent-repo-profile';
import {
    readCodexHelp as readCodexHelpHelper,
    isQaiqRunner as isQaiqRunnerHelper,
    isOnPath as isOnPathHelper,
    applyTemplateVars as applyTemplateVarsHelper,
    shellQuote as shellQuoteHelper,
    applyTemplate as applyTemplateHelper,
    applyTemplateWithoutPrompt as applyTemplateWithoutPromptHelper,
    truncateForPrompt as truncateForPromptHelper,
    truncateHead as truncateHeadHelper,
    loadProjectInfoFromDisk as loadProjectInfoFromDiskHelper,
    loadAgentInstructionsFromDisk as loadAgentInstructionsFromDiskHelper,
    readRepoMemory as readRepoMemoryHelper,
    readResearchLedger as readResearchLedgerHelper,
    isDirectory as isDirectoryHelper,
    resolveQaiqProviderFlagsFromEnv as resolveQaiqProviderFlagsFromEnvHelper,
    applyOpenRouterOpenAiCompatEnv as applyOpenRouterOpenAiCompatEnvHelper,
    applyNvidiaOpenAiCompatEnv as applyNvidiaOpenAiCompatEnvHelper,
    applyHuggingfaceOpenAiCompatEnv as applyHuggingfaceOpenAiCompatEnvHelper,
    noteReadOnlyEnforcement as noteReadOnlyEnforcementHelper,
    changedSensitiveFiles as changedSensitiveFilesHelper,
    findPendingControlRequestEntry as findPendingControlRequestEntryHelper,
    removeAgentPromptTempDir as removeAgentPromptTempDirHelper,
} from './qaap-agent-task-runner-utils';
import {
    parseCustomAgent as parseCustomAgentHelper,
    maxConcurrentAgents as maxConcurrentAgentsHelper,
    maxConcurrentAgentsPerUser as maxConcurrentAgentsPerUserHelper,
    buildRepoTree as buildRepoTreeHelper,
    buildRecentlyChangedFiles as buildRecentlyChangedFilesHelper,
    readGitStatusSnapshot as readGitStatusSnapshotHelper,
    captureWorktreeStatus as captureWorktreeStatusHelper,
    captureWorktreeFingerprint as captureWorktreeFingerprintHelper,
    resolveVerificationScriptsForCwd as resolveVerificationScriptsForCwdHelper,
    appendBoundedCommandOutput as appendBoundedCommandOutputHelper,
    readUserSettingsFromDisk as readUserSettingsFromDiskHelper,
    stripSharedProviderEnv as stripSharedProviderEnvHelper,
} from './qaap-agent-task-runner-utils2';
import {
    readRelevantFiles as readRelevantFilesHelper,
    reapAgentProcessGroupAfterExit as reapAgentProcessGroupAfterExitHelper,
    resolveProjectName as resolveProjectNameHelper,
    listAgents as listAgentsHelper,
    probeAgentBinOnce as probeAgentBinOnceHelper,
    recordTaskLatencyMark as recordTaskLatencyMarkHelper,
    reviewSuccessfulAgentTask as reviewSuccessfulAgentTaskHelper,
    runOneShotCommand as runOneShotCommandHelper,
    verifySuccessfulAgentTask as verifySuccessfulAgentTaskHelper,
    QAAP_AGENT_VERIFY_MAX_ATTEMPTS,
    QAAP_AGENT_VERIFY_WALL_CLOCK_MS,
} from './qaap-agent-task-runner-utils3';

export function killAgentProcessTreeExtracted(ctx: any, child: ChildProcess,
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

export function getApprovalChannelExtracted(ctx: any, taskId: string): 'qaiq-stdio' | 'stdin' | 'none' {
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

export function respondToApprovalPromptExtracted(ctx: any, taskId: string, action: 'approve' | 'reject', toolUseId?: string): boolean {
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

export function findPendingControlRequestEntryExtracted(ctx: any, pending: QaapQaiqPendingControlRequest[],
        idFromApproval?: string,): QaapQaiqPendingControlRequest | undefined {
        return findPendingControlRequestEntryHelper(pending, idFromApproval);
}

export function scheduleQueuedApprovalTimeoutExtracted(ctx: any, taskId: string,
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

export function clearQueuedApprovalTimerExtracted(ctx: any, taskId: string, requestId: string): void {
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

export function clearQueuedApprovalTimersExtracted(ctx: any, taskId: string): void {
        const timers = ctx.queuedApprovalTimers.get(taskId);
        if (timers) {
            for (const timer of timers.values()) {
                clearTimeout(timer);
            }
            ctx.queuedApprovalTimers.delete(taskId);
        }
}

export async function spawnProcessWhenReadyExtracted(ctx: any, task: QaapAgentTask, request: QaapCreateAgentTaskRequest): Promise<void> {
        if (ctx.preferenceService) {
            await ctx.preferenceService.ready;
        }
        // Stop can arrive while preference initialization is pending, before a child exists.
        // Do not resurrect a task that cancel() has already transitioned out of running.
        if (ctx.tasks.get(task.id)?.state !== 'running') {
            return;
        }
        if (task.ownerLogin && ctx.billingStore) {
            try {
                const account = await ctx.billingStore.getOrCreateAccount(task.ownerLogin);
                if (!canStartNewAgentJob(account)) {
                    fs.mkdirSync(STORE_DIR, { recursive: true });
                    fs.writeFileSync(
                        ctx.logPath(task.id),
                        'Agent runtime allowance is used up for this billing period. The current turn was not started. Top up hours or wait for the next cycle.\n',
                        'utf8',
                    );
                    ctx.finishTask(task.id, 'failed', 1);
                    return;
                }
                const agentModel = ctx.resolveAgentModelForRequest(request, (request.prompt ?? '').trim(), task.ownerLogin);
                const modelId = agentModel?.modelId ?? task.agentModel?.modelId ?? task.qaiqModel?.modelId;
                const agentId = ctx.resolveAgentId?.(request.prompt ?? '', request.agent, task.ownerLogin) ?? request.agent ?? task.agentId;
                const hostedDenial = isHostedCodexUsage(agentId, modelId)
                    ? hostedModelDenialReason(account, modelId)
                    : undefined;
                if (hostedDenial) {
                    fs.mkdirSync(STORE_DIR, { recursive: true });
                    fs.writeFileSync(ctx.logPath(task.id), `${hostedDenial}\n`, 'utf8');
                    ctx.finishTask(task.id, 'failed', 1);
                    return;
                }
            } catch (error) {
                // Fail closed for authenticated owners: a billing outage must not silently grant Pro quotas.
                fs.mkdirSync(STORE_DIR, { recursive: true });
                const message = error instanceof Error ? error.message : 'Billing check failed';
                fs.writeFileSync(
                    ctx.logPath(task.id),
                    `Could not verify billing entitlements for this turn. ${message}\n`,
                    'utf8',
                );
                ctx.finishTask(task.id, 'failed', 1);
                return;
            }
        }
        const markedTask = ctx.tasks.get(task.id) ?? task;
        const baseline = ctx.captureWorktreeBaseline(task.cwd);
        // Private disk copy of secrets — hashes alone cannot restore a destroyed `.env`.
        const sensitiveSnapshotDir = path.join(STORE_DIR, task.id, 'sensitive-snapshot');
        const snapshotted = snapshotSensitiveFiles(task.cwd, sensitiveSnapshotDir);
        task = {
            ...markedTask,
            ...baseline,
            ...(snapshotted.length > 0 ? { sensitiveSnapshotDir } : {}),
        };
        ctx.tasks.set(task.id, task);
        void ctx.persist();
        const prompt = (request.prompt ?? '').trim();
        if (prompt) {
            try {
                ctx.recordTaskLatencyMark(task.id, 'build_agent_command_start');
                const autoApprove = task.autoApprove !== false;
                const agentModel = ctx.resolveAgentModelForRequest(request, prompt, task.ownerLogin);
                const { command, stdinPrompt, stdinPromptMode, agentId, promptTempDir } = ctx.buildAgentCommand(
                    prompt,
                    request.agent,
                    autoApprove,
                    agentModel,
                    task.cwd,
                    request.contextPreamble,
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
                    // Resolved here, not by the caller: only now is the concrete backend known (an
                    // unpinned dispatch falls through to the runner's own default agent).
                    ...(task.readOnlyWorkspace
                        ? { readOnlyEnforcement: ctx.noteReadOnlyEnforcement(task.id, agentId) }
                        : {}),
                    ...(agentModel ? { agentModel, qaiqModel: agentModel } : {}),
                };
                ctx.tasks.set(task.id, next);
                void ctx.persist();
                ctx.spawnProcess(next);
                return;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                fs.mkdirSync(STORE_DIR, { recursive: true });
                fs.writeFileSync(ctx.logPath(task.id), `${message}\n`, 'utf8');
                ctx.finishTask(task.id, 'failed', 1);
                return;
            }
        }
        ctx.spawnProcess(task);
}

export function spawnProcessExtracted(ctx: any, task: QaapAgentTask): void {
        fs.mkdirSync(STORE_DIR, { recursive: true });
        const logStream = fs.createWriteStream(ctx.logPath(task.id), { flags: 'w' });
        const stdinPromptEntry = ctx.stdinPrompts.get(task.id);
        const stdinPrompt = typeof stdinPromptEntry === 'string'
            ? { text: stdinPromptEntry, mode: 'qaiq-stdio' }
            : stdinPromptEntry;
        const stdinInteractive = task.autoApprove === false || stdinPrompt !== undefined;
        const agentModel = resolveTaskAgentModel(task);
        const restoreAntigravitySettings = agentModel?.modelId?.trim()
            && isAntigravityCliCommand(task.command)
            ? applyAntigravityModelSetting(agentModel.modelId)?.restore
            : undefined;
        const finishAntigravitySettings = (): void => {
            restoreAntigravitySettings?.();
        };
        let child: ChildProcess;
        try {
            ctx.enforceAgentIsolationPolicy();
            ctx.ensureAgentCwdOwnership(task.cwd);
            ctx.recordTaskLatencyMark(task.id, 'spawn_start');
            // Pipes stay attached (no unref()), so logging and stdio approvals are unaffected.
            child = ctx.spawnAgentCommand(task.command, {
                cwd: task.cwd,
                env: ctx.buildChildEnv(task),
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
                if (ctx.tasks.get(task.id)?.state !== 'running') {
                    return;
                }
                // A run paused on a permission approval is waiting for the user,
                // not hung — keep it alive until someone responds.
                if (ctx.pendingQaiqControlRequests.get(task.id)?.length) {
                    bumpIdleTimer();
                    return;
                }
                logStream.write(`\n[qaap] task timed out after ${Math.round(IDLE_TASK_TIMEOUT_MS / 1000)}s without output.\n`);
                ctx.killAgentProcessTree(child);
                ctx.finishTask(task.id, 'failed', undefined);
            }, IDLE_TASK_TIMEOUT_MS);
        };
        bumpIdleTimer();
        let stdioLineBuffer = '';
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
                    const autoAction = resolveQaiqControlRequestAutoAction(
                        task.command,
                        task.autoApprove,
                        event.request,
                    );
                    if (autoAction !== 'queue') {
                        const devServerDenial = findQaiqDevServerGuardDenial(event.request);
                        const destructiveDenial = findQaiqDestructiveCommandGuardDenial(event.request);
                        const denyMessage = devServerDenial
                            ?? destructiveDenial
                            ?? (autoAction === 'deny' && event.request.toolName
                                ? buildQaiqAutoDeniedToolMessage(event.request.toolName, event.request.toolInput)
                                : undefined);
                        if (devServerDenial) {
                            logStream.write('\n[qaap] auto-denied long-lived dev-server shell command; Qaap manages dev servers via the preview bootstrap.\n');
                        } else if (destructiveDenial) {
                            logStream.write('\n[qaap] auto-denied destructive shell command; the agent must propose it for explicit user approval.\n');
                        }
                        try {
                            child.stdin?.write(buildQaiqControlResponseLine(
                                event.request,
                                autoAction === 'allow' ? 'approve' : 'reject',
                                denyMessage ? { denyMessage } : {},
                            ));
                        } catch {
                            // stdin already closed — the turn is over anyway.
                        }
                        continue;
                    }
                    const pending = ctx.pendingQaiqControlRequests.get(task.id) ?? [];
                    pending.push(event.request);
                    ctx.pendingQaiqControlRequests.set(task.id, pending);
                    // "Request approval" runs wait indefinitely; auto-approve runs get a
                    // grace window so an unattended turn still finishes.
                    if (task.autoApprove !== false) {
                        ctx.scheduleQueuedApprovalTimeout(task.id, event.request, logStream);
                    }
                } else if (event.type === 'control-cancel') {
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
            bumpIdleTimer();
            ctx.recordTaskLatencyMark(task.id, 'first_stdout_chunk');
            logStream.write(chunk);
            ctx.fireOutput(task.id, chunk);
            if (ctx.qaiqStdioTasks.has(task.id)) {
                scanStdioApprovalChunk(chunk);
            }
        });
        child.stderr?.on('data', chunk => {
            bumpIdleTimer();
            ctx.recordTaskLatencyMark(task.id, 'first_stdout_chunk');
            logStream.write(chunk);
            ctx.fireOutput(task.id, chunk);
        });
        child.on('error', error => {
            logStream.write(`\n[qaap] process error: ${error.message}\n`);
        });
        child.once('exit', () => {
            // User cancellation owns a longer grace window so active tools can finish cleanup.
            if (ctx.tasks.get(task.id)?.state !== 'cancelled') {
                ctx.reapAgentProcessGroupAfterExit(child);
            }
        });
        child.on('close', code => {
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
            if (code === 0 && QAAP_AGENT_VERIFY_ENABLED) {
                void ctx.finishSuccessfulTaskAfterVerification(task, code ?? undefined);
                return;
            }
            ctx.finishTask(task.id, code === 0 ? 'completed' : 'failed', code ?? undefined);
        });
}

export function maxConcurrentVerificationPassesExtracted(ctx: any): number {
        const raw = process.env.QAAP_AGENT_VERIFY_MAX_CONCURRENT?.trim();
        const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : ctx.maxConcurrentAgents();
}

export function acquireVerificationPassExtracted(ctx: any): Promise<void> {
        if (ctx.activeVerificationPasses < ctx.maxConcurrentVerificationPasses()) {
            ctx.activeVerificationPasses++;
            return Promise.resolve();
        }
        return new Promise(resolve => {
            ctx.verificationPassWaiters.push(resolve);
        });
}
