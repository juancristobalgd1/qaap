// @ts-nocheck
import { SHELL_AGENT_ID, QAIQ_AGENT_ID, SHELL_AGENT_ID,QAIQ_AGENT_ID, EMPTY_TURN_GATE_COMMAND,MAX_LOG_BYTES,QAAP_AGENT_FIX_PROMPT_OUTPUT_CHARS } from './qaap-agent-task-runner';
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

export function releaseVerificationPassExtracted(ctx: any): void {
        const next = ctx.verificationPassWaiters.shift();
        if (next) {
            // Transfer the occupied slot directly. Decrementing first would let a newly arriving
            // task overtake this FIFO waiter and briefly exceed the configured process budget.
            next();
            return;
        }
        ctx.activeVerificationPasses = Math.max(0, ctx.activeVerificationPasses - 1);
}

export async function finishSuccessfulTaskAfterVerificationExtracted(ctx: any, task: QaapAgentTask, exitCode: number | undefined): Promise<void> {
        // Verification/fix turns use their own bounded lane. A saturated lane waits FIFO instead of
        // silently upgrading an unverified change to `completed`. The commands inside the lane have
        // hard wall clocks, so a waiter cannot be held indefinitely by a healthy runner.
        await ctx.acquireVerificationPass();
        try {
            if (ctx.tasks.get(task.id)?.state !== 'running') {
                return;
            }
            // Empty-turn gate, BEFORE the diff-centric gates: a turn that ran no tool and said
            // nothing changed no files, so verification and review would both be skipped and a
            // clean exit would earn 'completed' on work that never happened. Observed live with a
            // free model that wrote its Edit call as plain text.
            const emptyTurn = await ctx.detectEmptyAgentTurnForTask(task);
            if (emptyTurn.empty) {
                // A backend that returns nothing is not a slow backend, it is a broken one for this
                // workload — the observed cause is a model that writes tool calls as prose. Feed the
                // health tracker so later turns route around it instead of repeating the no-op.
                ctx.agentHealth?.noteFailure(ctx.resolveTaskAgentId(task));
                const current = ctx.tasks.get(task.id);
                if (current) {
                    ctx.tasks.set(task.id, {
                        ...current,
                        verification: {
                            status: 'failed',
                            command: EMPTY_TURN_GATE_COMMAND,
                            attempts: 0,
                            summary: emptyTurn.reason ?? 'The agent turn produced no work.',
                        },
                    });
                }
                ctx.finishTask(task.id, 'completed_with_warnings', exitCode);
                return;
            }
            let verification: QaapAgentTaskVerification | undefined;
            try {
                verification = await ctx.verifySuccessfulAgentTask(task);
            } catch (error) {
                verification = {
                    status: 'failed',
                    command: 'qaap self-verification',
                    attempts: 0,
                    summary: error instanceof Error ? error.message : String(error),
                };
            }
            if (ctx.tasks.get(task.id)?.state !== 'running') {
                return;
            }
            if (verification) {
                const current = ctx.tasks.get(task.id);
                if (current) {
                    ctx.tasks.set(task.id, { ...current, verification });
                }
            }
            // Independent adversarial review (phase C): only when the deterministic gate did not
            // already flag the task — a red verification closes as warnings without paying for a
            // second agent. Runs inside the verification slot held above, so concurrency stays
            // bounded by the same cap.
            let review: QaapAgentTaskReview | undefined;
            if (verification?.status !== 'failed') {
                try {
                    review = await ctx.reviewSuccessfulAgentTask(task, verification);
                } catch (error) {
                    review = {
                        status: 'inconclusive',
                        reason: error instanceof Error ? error.message : String(error),
                    };
                }
                if (ctx.tasks.get(task.id)?.state !== 'running') {
                    return;
                }
                if (review) {
                    const current = ctx.tasks.get(task.id);
                    if (current) {
                        ctx.tasks.set(task.id, { ...current, review });
                    }
                }
            }
            // Blocking gate: a clean exit does not earn 'completed' while the repo's own checks
            // are red or the independent reviewer rejected the change — surface it as a distinct
            // terminal state instead of badge-only metadata so the conversation store and the UI
            // can react to it. An inconclusive review fails OPEN: the deterministic gates already
            // ran, and closing every reviewer timeout as a warning would erode trust in the state.
            const withWarnings = verification?.status === 'failed' || review?.status === 'failed';
            // Mechanical secrets restore (never a model): after a rejected change, put baseline
            // `.env*` back. Also runs when verification failed and skipped review — otherwise a
            // destroyed `.env` would survive behind a red typecheck.
            if (withWarnings) {
                const latest = ctx.tasks.get(task.id) ?? task;
                ctx.restoreBaselineSensitiveFiles(latest);
            }
            ctx.finishTask(task.id, withWarnings ? 'completed_with_warnings' : 'completed', exitCode);
        } finally {
            ctx.releaseVerificationPass();
        }
}

export async function detectEmptyAgentTurnForTaskExtracted(ctx: any, task: QaapAgentTask): Promise<QaapEmptyAgentTurnResult> {
        try {
            const stat = await fsp.stat(ctx.logPath(task.id));
            if (stat.size > MAX_LOG_BYTES) {
                return { empty: false };
            }
            const log = await fsp.readFile(ctx.logPath(task.id), 'utf8');
            const detected = detectEmptyAgentTurn(log, { complete: true });
            if (!detected.empty) {
                return detected;
            }
            // Second, independent witness: if anything in the workspace moved, the turn did work
            // the log did not show, and the normal verification path must own it.
            return await ctx.hasEditedFilesForVerification(task, ctx.buildChildEnv(task))
                ? { empty: false }
                : detected;
        } catch {
            // Unreadable log or git failure: never accuse a turn we cannot inspect.
            return { empty: false };
        }
}

export async function verifySuccessfulAgentTaskExtracted(ctx: any, task: QaapAgentTask): Promise<QaapAgentTaskVerification | undefined> {
        return verifySuccessfulAgentTaskHelper(task, {
            buildChildEnv: t => ctx.buildChildEnv(t),
            hasEditedFilesForVerification: (t, e) => ctx.hasEditedFilesForVerification(t, e),
            resolveVerificationScriptsForCwd: cwd => ctx.resolveVerificationScriptsForCwd(cwd),
            isTaskStillRunning: id => ctx.isTaskStillRunning(id),
            runVerificationScripts: (t, e, s, sa) => ctx.runVerificationScripts(t, e, s, sa),
            runAgentVerificationFixTurn: (t, e, c, r, a, sa) => ctx.runAgentVerificationFixTurn(t, e, c, r, a, sa),
            summarizeVerificationFailure: (c, r) => ctx.summarizeVerificationFailure(c, r),
        });
}

export async function reviewSuccessfulAgentTaskExtracted(ctx: any, task: QaapAgentTask,
        verification: QaapAgentTaskVerification | undefined,): Promise<QaapAgentTaskReview | undefined> {
        return reviewSuccessfulAgentTaskHelper(task, verification, {
            isTaskStillRunning: id => ctx.isTaskStillRunning(id),
            resolveTaskAgentId: t => ctx.resolveTaskAgentId(t),
            buildChildEnv: t => ctx.buildChildEnv(t),
            hasEditedFilesForVerification: (t, e) => ctx.hasEditedFilesForVerification(t, e),
            runGenericCommand: (c, cwd, e, id, t, o) => ctx.runGenericCommand(c, cwd, e, id, t, o),
            changedSensitiveFiles: t => ctx.changedSensitiveFiles(t),
            resolveReviewerCandidates: t => ctx.resolveReviewerCandidates(t),
            buildAgentCommand: (p, a, ap, m, cwd, cp, im, pol) => ctx.buildAgentCommand(p, a, ap, m, cwd, cp, im, pol),
            appendAndFireOutput: (id, text) => ctx.appendAndFireOutput(id, text),
            agentHealth: ctx.agentHealth,
        });
}

export function resolveReviewerCandidatesExtracted(ctx: any, task: QaapAgentTask): string[] {
        const own = ctx.resolveTaskAgentId(task);
        if (!ctx.workflowRouting) {
            return [own];
        }
        const picked: string[] = [];
        const excluded = new Set<string>();
        for (let attempt = 0; attempt < 2; attempt++) {
            const routed = ctx.workflowRouting.resolve(
                'judge',
                'standard',
                ref => !excluded.has(ref)
                    && ctx.agentHealth?.isCoolingDown(ref) !== true
                    && ctx.listAgents().some(agent => agent.id === ref && agent.available),
                undefined,
            );
            if (!routed.agentRef) {
                break;
            }
            excluded.add(routed.agentRef);
            picked.push(routed.agentRef);
        }
        if (!picked.includes(own)) {
            picked.push(own);
        }
        return picked.slice(0, 3);
}

export async function hasEditedFilesForVerificationExtracted(ctx: any, task: QaapAgentTask, env: NodeJS.ProcessEnv): Promise<boolean> {
        // Gitignored secrets files first: both git baselines below are blind to them, and a task
        // whose only "edit" is rewriting a .env must still enter verification and review.
        if (ctx.changedSensitiveFiles(task).length > 0) {
            return true;
        }
        // Prefer the content fingerprint when both snapshots exist — it sees untracked content edits
        // that porcelain cannot. Never fall back to "any dirty path" once a baseline was captured:
        // that re-attributes the user's pre-existing dirty files to the agent.
        if (task.worktreeBaselineFingerprint) {
            const currentFingerprint = ctx.captureWorktreeFingerprint(task.cwd);
            if (currentFingerprint) {
                return currentFingerprint !== task.worktreeBaselineFingerprint;
            }
        }
        if (task.worktreeBaselineStatus !== undefined) {
            const currentStatus = ctx.captureWorktreeStatus(task.cwd);
            if (currentStatus !== undefined) {
                return currentStatus !== task.worktreeBaselineStatus;
            }
            // Baseline existed but git status is unreadable now — do not guess via a bare dirty check.
            return false;
        }
        const result = await ctx.runGenericCommand(
            `git -C ${ctx.shellQuote(task.cwd)} status --porcelain`,
            task.cwd,
            env,
            task.id,
            10_000,
        );
        return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export function captureWorktreeBaselineExtracted(ctx: any, cwd: string): Pick<QaapAgentTask, 'worktreeBaselineFingerprint' | 'worktreeBaselineStatus' | 'sensitiveBaselineHashes'> {
        const worktreeBaselineFingerprint = ctx.captureWorktreeFingerprint(cwd);
        const worktreeBaselineStatus = ctx.captureWorktreeStatus(cwd);
        // Secrets files are gitignored, so the two git baselines above are blind to them.
        const sensitiveBaselineHashes = hashSensitiveFiles(cwd);
        return {
            ...(worktreeBaselineFingerprint ? { worktreeBaselineFingerprint } : {}),
            ...(worktreeBaselineStatus !== undefined ? { worktreeBaselineStatus } : {}),
            ...(Object.keys(sensitiveBaselineHashes).length > 0 ? { sensitiveBaselineHashes } : {}),
        };
}

export function restoreBaselineSensitiveFilesExtracted(ctx: any, task: QaapAgentTask): string[] {
        if (!task.sensitiveSnapshotDir || !task.sensitiveBaselineHashes) {
            return [];
        }
        const toRestore = ctx.changedSensitiveFiles(task)
            .filter(name => task.sensitiveBaselineHashes![name] !== undefined);
        if (toRestore.length === 0) {
            return [];
        }
        const restored = restoreSensitiveFiles(task.sensitiveSnapshotDir, task.cwd, toRestore);
        if (restored.length > 0) {
            ctx.appendAndFireOutput(
                task.id,
                `\n[qaap] Restored sensitive file(s) from task snapshot: ${restored.join(', ')}\n`,
            );
        }
        return restored;
}

export async function runVerificationScriptsExtracted(ctx: any, task: QaapAgentTask,
        env: NodeJS.ProcessEnv,
        scripts: readonly string[],
        startedAt: number,): Promise<{ command: string; result: QaapGenericCommandResult } | undefined> {
        for (const script of scripts) {
            if (!ctx.isTaskStillRunning(task.id)) {
                return undefined;
            }
            const remaining = QAAP_AGENT_VERIFY_WALL_CLOCK_MS - (Date.now() - startedAt);
            if (remaining <= 0) {
                return {
                    command: `npm run ${script}`,
                    result: { exitCode: 1, stdout: '', stderr: 'Verification timed out.', timedOut: true },
                };
            }
            const command = `npm run ${script}`;
            const result = await ctx.runGenericCommand(command, task.cwd, env, task.id, remaining, {
                header: `\n[qaap] Verifying: ${command}\n`,
                tailOutput: true,
            });
            if (result.exitCode !== 0 || result.timedOut) {
                return { command, result };
            }
        }
        return undefined;
}

export async function runAgentVerificationFixTurnExtracted(ctx: any, task: QaapAgentTask,
        env: NodeJS.ProcessEnv,
        failedCommand: string,
        failure: QaapGenericCommandResult,
        attempt: number,
        startedAt: number,): Promise<QaapGenericCommandResult | undefined> {
        // Close the cancel race: if the task was cancelled between the failed verification and here,
        // do not spawn a full (token-costing) agent fix turn.
        if (!ctx.isTaskStillRunning(task.id)) {
            return { exitCode: 1, stdout: '', stderr: 'Task no longer running; skipped fix turn.', timedOut: false };
        }
        const remaining = QAAP_AGENT_VERIFY_WALL_CLOCK_MS - (Date.now() - startedAt);
        if (remaining <= 0) {
            return { exitCode: 1, stdout: '', stderr: 'Verification timed out before fix turn.', timedOut: true };
        }
        const agentId = ctx.resolveTaskAgentId(task);
        if (agentId === SHELL_AGENT_ID) {
            // A raw shell task (or one whose original agent could not be inferred) has no coding
            // agent to re-invoke — running the fix prompt as a literal shell command would be wrong.
            ctx.appendAndFireOutput(task.id, '\n[qaap] Skipping self-verification fix turn: no coding agent to invoke.\n');
            return undefined;
        }
        const prompt = ctx.buildAgentVerificationFixPrompt(failedCommand, failure, attempt);
        let command: string;
        let stdinPrompt: string | undefined;
        let stdinPromptMode: 'qaiq-stdio' | 'plain' | undefined;
        try {
            ({ command, stdinPrompt, stdinPromptMode } = ctx.buildAgentCommand(
                prompt,
                agentId,
                true,
                resolveTaskAgentModel(task),
                task.cwd,
                undefined,
                undefined,
                'full-access',
            ));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.appendAndFireOutput(task.id, `\n[qaap] Skipping self-verification fix turn: ${message}\n`);
            return undefined;
        }
        return ctx.runGenericCommand(command, task.cwd, env, task.id, remaining, {
            header: `\n[qaap] Verification failed. Starting ${agentId} fix attempt ${attempt}/${QAAP_AGENT_VERIFY_MAX_ATTEMPTS}.\n`,
            streamOutput: true,
            ...(stdinPromptMode === 'plain' && stdinPrompt !== undefined ? { stdinPrompt } : {}),
        });
}

export function buildAgentVerificationFixPromptExtracted(ctx: any, failedCommand: string,
        failure: QaapGenericCommandResult,
        attempt: number,): string {
        const output = ctx.truncateForPrompt(`${failure.stdout}\n${failure.stderr}`.trim(), QAAP_AGENT_FIX_PROMPT_OUTPUT_CHARS);
        return [
            'The previous coding-agent turn completed and edited files, but backend self-verification failed.',
            `Fix the issue causing this command to fail: ${failedCommand}`,
            `This is fix attempt ${attempt} of ${QAAP_AGENT_VERIFY_MAX_ATTEMPTS}.`,
            'Make the smallest safe code changes needed. Do not ask questions. Do not commit.',
            'After your edits, stop; the backend will rerun verification.',
            '',
            'Captured verification output:',
            output || '(no output captured)',
        ].join('\n');
}

