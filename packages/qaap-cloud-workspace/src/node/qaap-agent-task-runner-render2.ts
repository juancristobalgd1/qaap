// @ts-nocheck
import { AGENT_CANDIDATES,CUSTOM_AGENTS_ENV,DEFAULT_AGENT_PREFERENCE,ENV_AGENT_ID,HELPER_BIN_DIR,HELPER_BIN_PATH,HELPER_CLI_SOURCE,INDEX_PATH,QAIQ_AGENT_ID,SHELL_AGENT_ID,TOKEN_PATH,TOKENS_PATH } from './qaap-agent-task-runner';
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
import { usesSharedAiSettingsFallback } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import type { QaapTurnLatencyMark } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import {
    QAAP_BUILTIN_AGENT_DEFINITIONS,
    QAAP_BUILTIN_AGENT_IDS,
    isUiHiddenVpsAgent,
    resolveQaapBuiltinAgentMentionId,
    resolveQaapCodexTemplate,
} from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
import { OPENCLAUDE_AGENT_ID, resolveQaapAgentMentionToken } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import {
    formatQaiqInteractionFlags,
    type QaapQaiqInteractionFlagOptions,
} from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-interaction-flags';
import type { QaapAgentApprovalPolicyId } from '@theia/qaap-mobile-shell/lib/common/qaap-sticky-composer-approval-policy';
import { agentUsesSettingsModelCatalog } from '../common/qaap-agent-native-model-catalog';
import { filterModelsForHostedPlan } from '../common/qaap-billing-plans';
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

export function initExtracted(ctx: any): void {
        ctx.detectAgents();
        ctx.ensureHelperCli();
        void ctx.restoreFromDisk();
}

export function ensureHelperCliExtracted(ctx: any): void {
        try {
            fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
            ctx.loadHelperTokens();
            fs.mkdirSync(HELPER_BIN_DIR, { recursive: true });
            fs.writeFileSync(HELPER_BIN_PATH, HELPER_CLI_SOURCE, { mode: 0o755 });
        } catch (error) {
            console.warn('[qaap-agent-tasks] failed to install helper CLI:', error);
        }
}

export function loadHelperTokensExtracted(ctx: any): void {
        try {
            const raw = fs.readFileSync(TOKENS_PATH, 'utf8');
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            for (const [owner, token] of Object.entries(parsed)) {
                if (typeof token === 'string' && token) {
                    ctx.helperTokens.set(owner, token);
                }
            }
        } catch {
            /* no prior tokens — created on demand */
        }
}

export function persistHelperTokensExtracted(ctx: any): void {
        try {
            const obj: Record<string, string> = {};
            for (const [owner, token] of ctx.helperTokens) {
                obj[owner] = token;
            }
            writeJsonAtomicSync(TOKENS_PATH, obj, { space: 0, mode: 0o600 });
        } catch {
            /* persistence is best-effort */
        }
}

export function helperTokenForOwnerExtracted(ctx: any, ownerLogin?: string): string {
        const key = ownerLogin?.trim() ?? '';
        let token = ctx.helperTokens.get(key);
        if (!token) {
            token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
            ctx.helperTokens.set(key, token);
            ctx.persistHelperTokens();
        }
        return token;
}

export function resolveHelperTokenOwnerExtracted(ctx: any, presented: string | undefined): { ownerLogin: string | undefined } | undefined {
        if (!presented) {
            return undefined;
        }
        const a = Buffer.from(presented);
        for (const [owner, token] of ctx.helperTokens) {
            const b = Buffer.from(token);
            if (a.length !== b.length) {
                continue;
            }
            let diff = 0;
            for (let i = 0; i < a.length; i++) {
                diff |= a[i] ^ b[i];
            }
            if (diff === 0) {
                return { ownerLogin: owner || undefined };
            }
        }
        return undefined;
}

export function detectAgentsExtracted(ctx: any): void {
        for (const candidate of AGENT_CANDIDATES) {
            if (ctx.isCandidateAvailable(candidate)) {
                ctx.detectedAgents.set(candidate.id, candidate);
            }
        }
        ctx.detectAntigravityAgent();
        ctx.detectCodexAgent();
        ctx.detectQaiqAgent();
        for (const candidate of ctx.readCustomAgents()) {
            if (ctx.isCandidateAvailable(candidate)) {
                ctx.detectedAgents.set(candidate.id, candidate);
            }
        }
        ctx.logDetectedAgents();
}

export function logDetectedAgentsExtracted(ctx: any): void {
        const ids = [...ctx.detectedAgents.keys()];
        console.log(`[qaap-agent-tasks] detected agents: ${ids.length ? ids.join(', ') : '(none — install qaiq/openclaude or set QAAP_AGENT_COMMAND)'}`);
        if (!ctx.detectedAgents.has(QAIQ_AGENT_ID)) {
            return;
        }
        try {
            const probe = spawnSync('qaiq', ['--version'], { encoding: 'utf8' });
            const line = (probe.stdout || probe.stderr || '').trim().split('\n')[0];
            if (line) {
                console.log(`[qaap-agent-tasks] qaiq: ${line}`);
            }
        } catch {
            /* ignore */
        }
}

export function resolveAntigravityBinExtracted(ctx: any): string | undefined {
        if (ctx.isOnPath('agy')) {
            return 'agy';
        }
        if (ctx.isOnPath('antigravity')) {
            return 'antigravity';
        }
        if (ctx.isOnPath('gemini')) {
            return 'gemini';
        }
        return undefined;
}

export function detectAntigravityAgentExtracted(ctx: any): void {
        const bin = ctx.resolveAntigravityBin();
        if (!bin) {
            return;
        }
        const template = bin === 'gemini'
            ? 'gemini --approval-mode=yolo -p {prompt}'
            : `${bin} -p {prompt}`;
        ctx.detectedAgents.set('antigravity', {
            id: 'antigravity',
            label: 'Antigravity CLI',
            bin,
            template,
        });
}

export function resolveQaiqBinExtracted(ctx: any): string | undefined {
        if (ctx.isOnPath('qaiq')) {
            return 'qaiq';
        }
        return undefined;
}

export function detectQaiqAgentExtracted(ctx: any): void {
        const bin = ctx.resolveQaiqBin();
        if (!bin) {
            return;
        }
        ctx.detectedAgents.set(QAIQ_AGENT_ID, {
            id: QAIQ_AGENT_ID,
            label: 'QAIQ',
            bin,
            template: `${bin} --print --output-format stream-json --verbose --include-partial-messages {qaiq_flags} {prompt}`,
        });
}

export function detectCodexAgentExtracted(ctx: any): void {
        if (!ctx.isOnPath('codex')) {
            return;
        }
        const help = ctx.readCodexHelp();
        ctx.detectedAgents.set('codex', {
            id: 'codex',
            label: 'Codex',
            bin: 'codex',
            template: resolveQaapCodexTemplate(help),
        });
}

export function resolveTaskAgentIdExtracted(ctx: any, task: QaapAgentTask): string {
        if (task.agentId) {
            return task.agentId;
        }
        if (/\bopenclaude\b/.test(task.command ?? '')) {
            return OPENCLAUDE_AGENT_ID;
        }
        return ctx.isQaiqRunner(undefined, task.command) ? QAIQ_AGENT_ID : SHELL_AGENT_ID;
}

export function readCustomAgentsExtracted(ctx: any): AgentCandidate[] {
        const raw = process.env[CUSTOM_AGENTS_ENV]?.trim();
        if (!raw) {
            return [];
        }
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
                throw new Error(`${CUSTOM_AGENTS_ENV} must be a JSON array.`);
            }
            return parsed.flatMap((entry, index) => ctx.parseCustomAgent(entry, index));
        } catch (error) {
            console.warn(`[qaap-agent-tasks] ignored ${CUSTOM_AGENTS_ENV}:`, error instanceof Error ? error.message : error);
            return [];
        }
}

export async function restoreFromDiskExtracted(ctx: any): Promise<void> {
        try {
            const raw = await fsp.readFile(INDEX_PATH, 'utf8');
            ctx.restorePersistedIndex(JSON.parse(raw));
            await ctx.persist();
            ctx.drainQueuedTasks();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn('[qaap-agent-tasks] failed to restore task index:', error);
            }
        }
}

export function restorePersistedIndexExtracted(ctx: any, stored: unknown): void {
        const legacy = Array.isArray(stored);
        const tasks = legacy
            ? stored as QaapAgentTask[]
            : (stored as Partial<PersistedAgentTaskIndex> | undefined)?.tasks;
        const queuedRequests: Readonly<Record<string, QaapCreateAgentTaskRequest>> = legacy
            ? {}
            : (stored as Partial<PersistedAgentTaskIndex> | undefined)?.queuedRequests ?? {};
        if (!Array.isArray(tasks)) {
            throw new Error('Invalid persisted agent task index.');
        }
        for (const task of tasks) {
            if (!task?.id) {
                continue;
            }
            const queuedRequest = task.state === 'queued' ? queuedRequests[task.id] : undefined;
            const state = task.state === 'running' || (task.state === 'queued' && !queuedRequest)
                ? 'interrupted' as const
                : task.state;
            ctx.tasks.set(task.id, { ...task, state });
            if (state === 'queued' && queuedRequest) {
                ctx.queuedCreateRequests.set(task.id, queuedRequest);
            }
        }
}

export function countRunningTasksExtracted(ctx: any): number {
        let count = 0;
        for (const task of ctx.tasks.values()) {
            if (task.state === 'running' || ctx.stoppingTaskIds?.has(task.id)) {
                count++;
            }
        }
        return count;
}

export function runningTaskCountForOwnerExtracted(ctx: any, ownerLogin: string): number {
        const ownerKey = ownerLogin.trim().toLowerCase();
        if (!ownerKey) {
            return 0;
        }
        let count = 0;
        for (const task of ctx.tasks.values()) {
            const taskOwner = typeof task.ownerLogin === 'string' ? task.ownerLogin.trim().toLowerCase() : '';
            if ((task.state === 'running' || ctx.stoppingTaskIds?.has(task.id)) && taskOwner === ownerKey) {
                count++;
            }
        }
        return count;
}

export function ownerAtConcurrencyCapExtracted(ctx: any, ownerLogin: string | undefined): boolean {
        const owner = ownerLogin?.trim();
        if (!owner) {
            return false;
        }
        const cap = ctx.billingStore?.maxConcurrentAgentsForOwner?.(owner)
            ?? ctx.maxConcurrentAgentsPerUser();
        return ctx.runningTaskCountForOwner(owner) >= cap;
}

export function drainQueuedTasksExtracted(ctx: any): void {
        while (ctx.countRunningTasks() < ctx.maxConcurrentAgents()) {
            // Skip queued tasks whose owner is already at their per-user cap so one busy user can't
            // block everyone behind them in the FIFO queue — promote the next eligible tenant instead.
            const next = [...ctx.tasks.values()]
                .filter(task => task.state === 'queued' && !ctx.ownerAtConcurrencyCap(task.ownerLogin))
                .sort((left, right) => left.createdAt - right.createdAt)[0];
            if (!next) {
                return;
            }
            const request = ctx.queuedCreateRequests.get(next.id);
            if (!request) {
                ctx.finishTask(next.id, 'failed', undefined);
                continue;
            }
            const running: QaapAgentTask = { ...next, state: 'running' };
            ctx.tasks.set(next.id, running);
            ctx.queuedCreateRequests.delete(next.id);
            void ctx.spawnProcessWhenReady(running, request);
            void ctx.persist();
            ctx.onDidChangeTaskEmitter.fire({ type: 'created', task: running });
        }
}

export function listForCwdExtracted(ctx: any, cwd: string | undefined): QaapAgentTask[] {
        const all = ctx.list();
        if (!cwd) {
            return all;
        }
        const resolved = path.resolve(cwd);
        return all.filter(task => task.cwd === resolved);
}

export function listAllGroupedByCwdExtracted(ctx: any): QaapAgentTaskCwdGroup[] {
        const buckets = new Map<string, QaapAgentTask[]>();
        for (const task of ctx.list()) {
            const bucket = buckets.get(task.cwd);
            if (bucket) {
                bucket.push(task);
            } else {
                buckets.set(task.cwd, [task]);
            }
        }
        const groups: QaapAgentTaskCwdGroup[] = [];
        for (const [cwd, tasks] of buckets) {
            groups.push({
                cwd,
                projectName: ctx.resolveProjectName(cwd),
                activeCount: tasks.reduce((n, task) => n + (task.state === 'running' ? 1 : 0), 0),
                tasks,
            });
        }
        // `list()` already returns newest-first, so tasks[0] is the most recent in each group.
        groups.sort((a, b) => (b.tasks[0]?.createdAt ?? 0) - (a.tasks[0]?.createdAt ?? 0));
        return groups;
}

export function warmForCwdExtracted(ctx: any, cwd: string): QaapAgentWarmResult {
        const resolved = path.resolve(cwd);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Workspace directory does not exist: ${resolved}`);
        }
        ctx.readProjectInfo(resolved);
        ctx.readAgentInstructions(resolved);
        ctx.readRepoMap(resolved);
        ctx.resolveProjectName(resolved);
        const qaiqProbed = ctx.probeAgentBinOnce(QAIQ_AGENT_ID, () => ctx.resolveQaiqBin());
        return {
            cwd: resolved,
            agentsReady: ctx.isAgentConfigured(),
            projectInfoCached: ctx.projectInfoCache.has(resolved),
            projectNameCached: ctx.projectNameCache.has(resolved),
            qaiqProbed,
        };
}

export function listQaiqModelsExtracted(ctx: any, ownerLogin?: string): QaapQaiqModelOption[] {
        return listQaiqModelsFromPreferences(
            ctx.preferenceReaderForOwner(ownerLogin),
            usesSharedAiSettingsFallback(ownerLogin) ? (key: string) => process.env[key] : () => undefined,
        );
}

export function listModelsForAgentExtracted(
        ctx: any,
        agentId: string | undefined,
        ownerLogin?: string,
): QaapQaiqModelOption[] {
        const normalized = ctx.normalizeAgentId(agentId ?? '');
        if (!normalized || agentUsesSettingsModelCatalog(normalized)) {
            return [];
        }
        const models = listNativeAgentModels(normalized);
        const owner = ownerLogin?.trim();
        if (!owner) {
            return models;
        }
        // Cold cache → treat as Starter (no hosted) so the picker never offers Pro-only models by default.
        const hostedModelsAllowed = ctx.billingStore?.peekEntitlements?.(owner)?.hostedModels === true;
        return filterModelsForHostedPlan(normalized, models, hostedModelsAllowed);
}

export function defaultAgentExtracted(ctx: any): string {
        const configured = ctx.normalizeAgentId(process.env.QAAP_DEFAULT_AGENT);
        if (configured && ctx.detectedAgents.has(configured) && !isUiHiddenVpsAgent(configured)) {
            return configured;
        }
        for (const id of DEFAULT_AGENT_PREFERENCE) {
            if (ctx.detectedAgents.has(id) && !isUiHiddenVpsAgent(id)) {
                return id;
            }
        }
        for (const candidate of [...ctx.detectedAgents.values()]) {
            if (
                !AGENT_CANDIDATES.some(builtIn => builtIn.id === candidate.id)
                && !isUiHiddenVpsAgent(candidate.id)
            ) {
                return candidate.id;
            }
        }
        if (process.env.QAAP_AGENT_COMMAND?.trim()) {
            return ENV_AGENT_ID;
        }
        return SHELL_AGENT_ID;
}

export function normalizeAgentIdExtracted(ctx: any, token: string | undefined): string | undefined {
        const normalized = token?.trim().toLowerCase();
        if (!normalized) {
            return undefined;
        }
        const canonical = resolveQaapAgentMentionToken(normalized);
        if (canonical === SHELL_AGENT_ID) {
            return SHELL_AGENT_ID;
        }
        if (canonical === ENV_AGENT_ID && process.env.QAAP_AGENT_COMMAND?.trim()) {
            return ENV_AGENT_ID;
        }
        if (ctx.detectedAgents.has(canonical)) {
            return canonical;
        }
        const builtin = resolveQaapBuiltinAgentMentionId(canonical);
        if (builtin && ctx.detectedAgents.has(builtin)) {
            return builtin;
        }
        return undefined;
}

export async function detailExtracted(ctx: any, id: string): Promise<QaapAgentTaskDetail | undefined> {
        const task = ctx.tasks.get(id);
        if (!task) {
            return undefined;
        }
        return { ...task, log: await ctx.readLog(id) };
}
