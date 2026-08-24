// @ts-nocheck
import { HELPER_BIN_DIR,STORE_DIR, INDEX_PATH,MAX_LOG_BYTES,AGENT_ENV_PREFS,QAAP_AGENT_VERIFY_OUTPUT_TAIL_CHARS,STORE_DIR_MODE,STORE_FILE_MODE } from './qaap-agent-task-runner';
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
import { billableAgentDurationMs } from '../common/qaap-billing-agent-runtime';
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

export function runGenericCommandExtracted(ctx: any, command: string,
        cwd: string,
        env: NodeJS.ProcessEnv,
        taskId: string,
        timeoutMs: number,
        options: {
            readonly header?: string;
            readonly streamOutput?: boolean;
            readonly tailOutput?: boolean;
            /** Bounds each captured stream in memory while retaining its most recent output. */
            readonly maxCaptureChars?: number;
        } = {},): Promise<QaapGenericCommandResult> {
        if (options.header) {
            ctx.appendAndFireOutput(taskId, options.header);
        }
        return new Promise(resolve => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let child: ChildProcess;
            const finish = (exitCode: number): void => {
                if (options.tailOutput) {
                    const combined = `${stdout}${stderr}`;
                    const tail = ctx.truncateHead(combined, QAAP_AGENT_VERIFY_OUTPUT_TAIL_CHARS);
                    if (tail.trim()) {
                        ctx.appendAndFireOutput(taskId, `${tail.endsWith('\n') ? tail : `${tail}\n`}`);
                    }
                }
                resolve({ exitCode, stdout, stderr, timedOut });
            };
            try {
                ctx.enforceAgentIsolationPolicy();
                ctx.ensureAgentCwdOwnership(cwd);
                child = ctx.spawnAgentCommand(command, {
                    cwd,
                    env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            } catch (error) {
                stderr = error instanceof Error ? error.message : String(error);
                finish(1);
                return;
            }
            ctx.processes.set(taskId, child);
            let killTimer: NodeJS.Timeout | undefined;
            const timeout = setTimeout(() => {
                timedOut = true;
                killTimer = ctx.killAgentProcessTree(child);
            }, Math.max(1, timeoutMs));
            child.stdout?.on('data', (chunk: Buffer | string) => {
                const text = String(chunk);
                stdout = ctx.appendBoundedCommandOutput(stdout, text, options.maxCaptureChars);
                if (options.streamOutput) {
                    ctx.appendAndFireOutput(taskId, text);
                }
            });
            child.stderr?.on('data', (chunk: Buffer | string) => {
                const text = String(chunk);
                stderr = ctx.appendBoundedCommandOutput(stderr, text, options.maxCaptureChars);
                if (options.streamOutput) {
                    ctx.appendAndFireOutput(taskId, text);
                }
            });
            child.on('error', error => {
                stderr = ctx.appendBoundedCommandOutput(stderr, `${error.message}\n`, options.maxCaptureChars);
            });
            child.once('exit', () => {
                ctx.reapAgentProcessGroupAfterExit(child);
            });
            child.on('close', code => {
                clearTimeout(timeout);
                if (killTimer) {
                    clearTimeout(killTimer);
                }
                if (ctx.processes.get(taskId) === child) {
                    ctx.processes.delete(taskId);
                }
                finish(timedOut && code === 0 ? 1 : code ?? 1);
            });
        });
}

export function appendAndFireOutputExtracted(ctx: any, taskId: string, chunk: string): void {
        if (ctx.deletedTaskIds?.has(taskId)) {
            return;
        }
        try {
            fs.appendFileSync(ctx.logPath(taskId), chunk, 'utf8');
        } catch {
            /* log append is best-effort */
        }
        ctx.fireOutput(taskId, chunk);
}

export function summarizeVerificationFailureExtracted(ctx: any, command: string, result: QaapGenericCommandResult): string {
        const timedOut = result.timedOut ? ' The command timed out.' : '';
        const output = ctx.truncateHead(`${result.stdout}\n${result.stderr}`.trim(), 1000);
        return `${command} exited with code ${result.exitCode}.${timedOut}${output ? `\n${output}` : ''}`;
}

export function fireOutputExtracted(ctx: any, taskId: string, chunk: unknown): void {
        const task = ctx.tasks.get(taskId);
        // Drop stdout after cancel/finish — otherwise a dying CLI can keep painting the
        // transcript for hundreds of ms and make Stop feel ignored.
        if (!task || task.state !== 'running') {
            return;
        }
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        const filtered = filterAgentProcessLogChunk(text);
        if (!filtered) {
            return;
        }
        ctx.onDidChangeTaskEmitter.fire({ type: 'output', task, chunk: filtered });
}

export function spawnAgentCommandExtracted(ctx: any, command: string, options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        stdio: ('pipe' | 'ignore')[];
    }): ChildProcess {
        return ctx.tenantSpawn.spawn(command, options);
}

export function buildChildEnvExtracted(ctx: any, task: QaapAgentTask): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = { ...process.env };
        env.PWD = task.cwd;
        // When the agent is dropped to a non-root uid (QAAP_AGENT_UID), its inherited HOME still
        // points at root's /root, which it cannot write — CLI caches/configs would fail. Point HOME
        // at a writable agent home so the non-root process has somewhere to write. In uid-per-user
        // mode this is a PER-TENANT home (the shared /home/qaap-agent is owned by uid 1001 and is
        // neither writable nor private under a tenant uid) — see resolveAgentHome.
        if (ctx.resolveAgentSpawnIdentity(task.cwd).uid !== undefined) {
            env.HOME = ctx.resolveAgentHome(task.cwd);
        }
        // Strip shared provider API keys from process.env so per-user settings
        // are the sole source. Without this, User B's agent would inherit User
        // A's keys (or operator-level keys) from the shared backend process.
        ctx.stripSharedProviderEnv(env);
        // QAIQ and OpenClaude share the hosted protocol, but OpenClaude must not inherit QAIQ's
        // Settings → AI Features credentials/base URL as an implicit model selection. Explicit
        // OpenClaude picks still receive their own binding below.
        const usesQaiqSettingsCatalog = agentUsesSettingsModelCatalog(task.agentId)
            || (!task.agentId && /\bqaiq\b/.test(task.command) && !/\bopenclaude\b/.test(task.command));
        if (usesQaiqSettingsCatalog) {
            ctx.applyProviderPreferenceEnv(env, task.ownerLogin);
        }
        const binding = ctx.resolveAgentBindingForTask(task);
        if (binding) {
            applyQaapQaiqModelEnv(env, binding);
            applyQaapQaiqCredentialEnv(env, binding, ctx.preferenceReaderForOwner(task.ownerLogin));
        }
        if (usesQaiqSettingsCatalog) {
            ctx.applyQaiqProviderEnv(env, task.command, binding);
        }
        if (ctx.isQaiqRunner(undefined, task.command)) {
            env.QAAP_HOSTED_AGENT = '1';
            // QAIQ's full-access mode bypasses its permission callbacks. Force every hosted
            // QAIQ shell through the versioned Qaap boundary so destructive commands remain
            // denied even in headless/bypass runs. The boundary loads the compiled guard and
            // fails closed when the package has not been compiled yet.
            env.CLAUDE_CODE_SHELL = path.resolve(
                __dirname,
                '../../../../scripts/qaap-guarded-bash.mjs',
            );
            // The hosted backend runs as root inside its container, where qaiq refuses
            // `--dangerously-skip-permissions` unless it detects a sandbox. The container IS the
            // sandbox, so opt in explicitly (qaiq honours IS_SANDBOX=1 as the root-bypass escape
            // hatch). Scoped to the qaiq child rather than set globally so it never leaks into
            // unrelated processes. Respect an operator override if one is already present.
            if (env.IS_SANDBOX === undefined) {
                env.IS_SANDBOX = '1';
            }
        }
        ctx.applyHelperEnv(env, task.ownerLogin, task.id, task.autoApprove);
        return env;
}

export function applyOpenAiVendorCompatEnvExtracted(ctx: any, env: NodeJS.ProcessEnv, binding: QaapQaiqModelBinding): void {
        switch (binding.vendor) {
            case 'huggingface':
                ctx.applyHuggingfaceOpenAiCompatEnv(env);
                break;
            case 'openrouter':
                ctx.applyOpenRouterOpenAiCompatEnv(env);
                break;
            case 'nvidia':
                ctx.applyNvidiaOpenAiCompatEnv(env);
                break;
            default:
                break;
        }
}

export function applyQaiqProviderEnvExtracted(ctx: any, env: NodeJS.ProcessEnv, command: string, binding?: QaapQaiqModelBinding): void {
        if (!ctx.isQaiqRunner(undefined, command)) {
            return;
        }
        const usesThirdPartyProvider = (binding !== undefined && binding.provider !== 'anthropic')
            || command.includes('--provider openai')
            || command.includes('--provider gemini')
            || command.includes('--provider ollama')
            || command.includes('--provider mistral');
        if (usesThirdPartyProvider) {
            delete env.ANTHROPIC_API_KEY;
        }
        if (binding?.vendor === 'openrouter' || (!binding && command.includes('--provider openai') && env.OPENROUTER_API_KEY?.trim())) {
            ctx.applyOpenRouterOpenAiCompatEnv(env);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (binding?.vendor === 'nvidia' || (!binding && command.includes('--provider openai') && env.NVIDIA_API_KEY?.trim() && !env.OPENROUTER_API_KEY?.trim())) {
            ctx.applyNvidiaOpenAiCompatEnv(env);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (binding?.vendor === 'huggingface') {
            ctx.applyHuggingfaceOpenAiCompatEnv(env);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (!binding && command.includes('--provider openai') && env.OPENAI_API_KEY?.trim()) {
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (binding?.provider === 'openai') {
            ctx.applyOpenAiVendorCompatEnv(env, binding);
            env.CLAUDE_CODE_USE_OPENAI = '1';
        } else {
            // Gemini, Ollama, Anthropic, Mistral — profile files must not force OpenAI mode.
            env.CLAUDE_CODE_USE_OPENAI = '0';
        }
}

export function applyProviderPreferenceEnvExtracted(ctx: any, env: NodeJS.ProcessEnv, ownerLogin?: string): void {
        const readPref = ctx.preferenceReaderForOwner(ownerLogin);
        for (const mapping of AGENT_ENV_PREFS) {
            if (env[mapping.env]?.trim()) {
                continue;
            }
            const value = readPref(mapping.pref);
            if (typeof value === 'string' && value.trim()) {
                env[mapping.env] = value.trim();
            }
        }
        ctx.applyOpenRouterOpenAiCompatEnv(env);
}

export function applyHelperEnvExtracted(ctx: any, env: NodeJS.ProcessEnv, ownerLogin?: string, parentTaskId?: string, autoApprove?: boolean): boolean {
        if (!ctx.helperApiUrl) {
            return false;
        }
        // Seed the token bound to this task's owner so a spawned agent can only fan out
        // sub-tasks as its own user (the endpoint resolves the owner from the token).
        env.QAAP_TASK_TOKEN = ctx.helperTokenForOwner(ownerLogin);
        env.QAAP_TASK_API_URL = ctx.helperApiUrl;
        if (parentTaskId) {
            env.QAAP_TASK_PARENT_ID = parentTaskId;
        }
        if (autoApprove !== false) {
            env.QAAP_TASK_AUTO_APPROVE = '1';
        }
        env.PATH = `${HELPER_BIN_DIR}${path.delimiter}${env.PATH ?? ''}`;
        return true;
}

export function markTaskBlockedExtracted(ctx: any, id: string): QaapAgentTask | undefined {
        const task = ctx.tasks.get(id);
        if (!task || (task.state !== 'completed' && task.state !== 'completed_with_warnings')) {
            return undefined;
        }
        const blocked: QaapAgentTask = { ...task, state: 'blocked' };
        ctx.tasks.set(id, blocked);
        void ctx.persist();
        return blocked;
}

export function finishTaskExtracted(ctx: any, id: string, state: QaapAgentTaskState, exitCode: number | undefined): QaapAgentTask | undefined {
        const task = ctx.tasks.get(id);
        if (!task) {
            return undefined;
        }
        const finished: QaapAgentTask = { ...task, state, exitCode, finishedAt: Date.now() };
        ctx.tasks.set(id, finished);
        void ctx.persist();
        const durationMs = billableAgentDurationMs(finished);
        if (durationMs > 0 && finished.ownerLogin && ctx.billingStore) {
            void ctx.billingStore.debitRuntime(finished.ownerLogin, durationMs).catch(() => undefined);
        }
        // 'completed'/'failed'/'interrupted' map to 'completed' for subscribers; 'cancelled' stays distinct.
        ctx.onDidChangeTaskEmitter.fire({
            type: state === 'cancelled' ? 'cancelled' : 'completed',
            task: finished,
        });
        if (isQaapAgentTaskFinished(state) && state !== 'cancelled') {
            void ctx.notifyCompletion(finished);
        }
        // A cancelled running process retains its concurrency slot through the graceful-stop
        // window; cancel() drains after that window. Queued cancellations drain immediately there.
        if (state !== 'cancelled') {
            ctx.drainQueuedTasks();
        }
        return finished;
}

export async function notifyCompletionExtracted(ctx: any, task: QaapAgentTask): Promise<void> {
        // Deep-link target: the Work Hub session that spawned this task (when known),
        // so tapping the notification lands on the agent conversation, not a generic surface.
        const conversationId = ctx.conversationIdForTask?.(task.id);
        const link = { route: 'conversation', conversationId, cwd: task.cwd, userLogin: task.ownerLogin };
        if (task.state === 'completed_with_warnings') {
            try {
                await ctx.webPush.notify({
                    title: 'Task finished — checks failing',
                    body: `${task.title} completed, but verification checks are still failing.`,
                    tag: `qaap-agent-task-${task.id}`,
                    ...link,
                });
            } catch {
                /* push failure must not crash the runner */
            }
            return;
        }
        const ok = task.state === 'completed';
        try {
            await ctx.webPush.notify({
                title: ok ? 'Task finished' : 'Task failed',
                body: `${task.title}${ok ? ' completed.' : ` exited with code ${task.exitCode ?? 'unknown'}.`}`,
                tag: `qaap-agent-task-${task.id}`,
                ...link,
            });
        } catch {
            /* push failure must not crash the runner */
        }
}

export async function readLogExtracted(ctx: any, id: string): Promise<string> {
        try {
            const logPath = ctx.logPath(id);
            const stat = await fsp.stat(logPath);
            const handle = await fsp.open(logPath, 'r');
            try {
                const start = Math.max(0, stat.size - MAX_LOG_BYTES);
                const { buffer, bytesRead } = await handle.read({
                    buffer: Buffer.alloc(Math.min(stat.size, MAX_LOG_BYTES)),
                    position: start,
                });
                const text = buffer.subarray(0, bytesRead).toString('utf8');
                const raw = start > 0 ? `…(truncated)\n${text}` : text;
                return filterAgentProcessLogChunk(raw);
            } finally {
                await handle.close();
            }
        } catch {
            return '';
        }
}

export function persistExtracted(ctx: any): Promise<void> {
        const queuedRequests: Record<string, QaapCreateAgentTaskRequest> = {};
        for (const [taskId, request] of ctx.queuedCreateRequests) {
            if (ctx.tasks.get(taskId)?.state === 'queued') {
                queuedRequests[taskId] = request;
            }
        }
        const index: PersistedAgentTaskIndex = {
            version: 2,
            tasks: [...ctx.tasks.values()],
            queuedRequests,
        };
        const previous = ctx.persistChain ?? Promise.resolve();
        ctx.persistChain = previous
            .catch(() => undefined)
            .then(async () => {
                await fsp.mkdir(STORE_DIR, { recursive: true, mode: STORE_DIR_MODE });
                await fsp.chmod(STORE_DIR, STORE_DIR_MODE).catch(() => undefined);
                await writeJsonAtomic(INDEX_PATH, index, { mode: STORE_FILE_MODE });
            })
            .catch(error => {
                console.warn('[qaap-agent-tasks] failed to persist task index:', error);
            });
        return ctx.persistChain;
}

export async function improveComposerPromptExtracted(ctx: any, options: {
        readonly prompt: string;
        readonly agentId: string;
        readonly agentModel?: QaapCreateAgentTaskQaiqModel;
        readonly cwd?: string;
    }): Promise<string> {
        if (ctx.preferenceService) {
            await ctx.preferenceService.ready;
        }
        const trimmed = options.prompt.trim();
        if (!trimmed) {
            throw new Error('Composer prompt is empty.');
        }
        const improveText = buildImproveComposerPromptRequest(trimmed);
        const agentId = ctx.resolveAgentId(improveText, options.agentId);
        ctx.assertQaiqConfigured(agentId);
        const detected = ctx.detectedAgents.get(agentId);
        if (!detected) {
            throw new Error(`Agent "${agentId}" is not available for prompt improvement.`);
        }
        const vars = ctx.buildTemplateVars(agentId, options.agentModel, {
            autoApprove: true,
            approvalPolicyId: 'approve-for-me',
        });
        let template = detected.template
            .replace(/--output-format\s+\S+/g, '')
            .replace(/--include-partial-messages/g, '')
            .replace(/--verbose/g, '');
        const command = applyAgentApprovalPolicyToCommand(
            ctx.applyTemplate(template, improveText, vars),
            {
                agentId,
                approvalPolicyId: 'approve-for-me',
                autoApprove: true,
            },
        );
        const cwd = options.cwd?.trim() || process.cwd();
        const task: QaapAgentTask = {
            id: 'composer-improve-prompt',
            title: 'Improve prompt',
            command,
            cwd,
            state: 'running',
            createdAt: Date.now(),
            autoApprove: true,
            ...(options.agentModel ? { agentModel: options.agentModel, qaiqModel: options.agentModel } : {}),
        };
        return ctx.runOneShotCommand(command, cwd, ctx.buildChildEnv(task), agentId);
}
