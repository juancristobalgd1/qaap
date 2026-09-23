import {
    AGENT_CANDIDATES, CUSTOM_AGENTS_ENV, DEFAULT_AGENT_PREFERENCE, ENV_AGENT_ID, HELPER_BIN_DIR, HELPER_BIN_PATH, HELPER_CLI_SOURCE, INDEX_PATH,
    QAIQ_AGENT_ID, SHELL_AGENT_ID, TOKEN_PATH, TOKENS_PATH, type AgentCandidate, type PersistedAgentTaskIndex,
} from './qaap-agent-task-runner-constants';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
// Extracted from qaap-agent-task-runner.ts

import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { writeJsonAtomicSync } from './qaap-write-json-atomic';
import * as path from 'path';
import {
    type QaapQaiqModelOption,
    type QaapAgentTask,
    type QaapAgentTaskCwdGroup,
    type QaapAgentTaskDetail,
    type QaapCreateAgentTaskRequest,
    type QaapAgentWarmResult,
} from '../common/qaap-agent-task';
import { rememberQaapHostedRuntime } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';
import { isQaapProductionRuntime } from './qaap-agent-spawn-identity';
import { usesSharedAiSettingsFallback } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import {
    isUiHiddenVpsAgent,
    resolveQaapBuiltinAgentMentionId,
    resolveQaapCodexTemplate,
} from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
import { OPENCLAUDE_AGENT_ID, resolveQaapAgentMentionToken } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import { agentUsesSettingsModelCatalog } from '../common/qaap-agent-native-model-catalog';
import { isHostedCodexUsage } from '../common/qaap-billing-plans';
import { listNativeAgentModels } from './qaap-agent-native-models';
import { listQaiqModelsFromPreferences } from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-model-catalog';

export function initExtracted(ctx: QaapAgentTaskRunnerContext): void {
        rememberQaapHostedRuntime(isQaapProductionRuntime(process.env));
        ctx.recoveryState = 'loading';
        ctx.detectAgents();
        ctx.ensureHelperCli();
        void ctx.restoreFromDisk();
}

export function ensureHelperCliExtracted(ctx: QaapAgentTaskRunnerContext): void {
        try {
            fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
            ctx.loadHelperTokens();
            fs.mkdirSync(HELPER_BIN_DIR, { recursive: true });
            fs.writeFileSync(HELPER_BIN_PATH, HELPER_CLI_SOURCE, { mode: 0o755 });
        } catch (error) {
            console.warn('[qaap-agent-tasks] failed to install helper CLI:', error);
        }
}

export function loadHelperTokensExtracted(ctx: QaapAgentTaskRunnerContext): void {
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

export function persistHelperTokensExtracted(ctx: QaapAgentTaskRunnerContext): void {
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

export function helperTokenForOwnerExtracted(ctx: QaapAgentTaskRunnerContext, ownerLogin?: string): string {
        const key = ownerLogin?.trim() ?? '';
        let token = ctx.helperTokens.get(key);
        if (!token) {
            token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
            ctx.helperTokens.set(key, token);
            ctx.persistHelperTokens();
        }
        return token;
}

export function resolveHelperTokenOwnerExtracted(ctx: QaapAgentTaskRunnerContext, presented: string | undefined): { ownerLogin: string | undefined } | undefined {
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

export function detectAgentsExtracted(ctx: QaapAgentTaskRunnerContext): void {
        for (const candidate of AGENT_CANDIDATES) {
            if (ctx.isCandidateAvailable(candidate)) {
                ctx.detectedAgents.set(candidate.id, candidate);
            }
        }
        ctx.detectAntigravityAgent();
        ctx.detectCursorAgent();
        ctx.detectCodexAgent();
        ctx.detectQaiqAgent();
        for (const candidate of ctx.readCustomAgents()) {
            if (ctx.isCandidateAvailable(candidate)) {
                ctx.detectedAgents.set(candidate.id, candidate);
            }
        }
        ctx.logDetectedAgents();
}

export function logDetectedAgentsExtracted(ctx: QaapAgentTaskRunnerContext): void {
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

export function resolveAntigravityBinExtracted(ctx: QaapAgentTaskRunnerContext): string | undefined {
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

export function detectAntigravityAgentExtracted(ctx: QaapAgentTaskRunnerContext): void {
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

export function resolveCursorAgentBinExtracted(ctx: QaapAgentTaskRunnerContext): string | undefined {
        if (ctx.isOnPath('cursor-agent')) {
            return 'cursor-agent';
        }
        if (ctx.isOnPath('agent')) {
            return 'agent';
        }
        return undefined;
}

export function detectCursorAgentExtracted(ctx: QaapAgentTaskRunnerContext): void {
        const bin = ctx.resolveCursorAgentBin();
        if (!bin) {
            return;
        }
        ctx.detectedAgents.set('cursor', {
            id: 'cursor',
            label: 'Cursor Agent',
            bin,
            template: `${bin} -p --force --trust --approve-mcps {prompt}`,
        });
}

export function resolveQaiqBinExtracted(ctx: QaapAgentTaskRunnerContext): string | undefined {
        if (ctx.isOnPath('qaiq')) {
            return 'qaiq';
        }
        return undefined;
}

export function detectQaiqAgentExtracted(ctx: QaapAgentTaskRunnerContext): void {
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

export function detectCodexAgentExtracted(ctx: QaapAgentTaskRunnerContext): void {
        if (!ctx.isOnPath('codex')) {
            return;
        }
        const help = ctx.readCodexHelp();
        ctx.detectedAgents.set('codex', {
            id: 'codex',
            label: 'Codex',
            bin: 'codex',
            template: resolveQaapCodexTemplate(help),
            codexSupportsApproveForMe: /\B--approve-for-me\b/.test(help),
        });
}

export function resolveTaskAgentIdExtracted(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask): string {
        if (task.agentId) {
            return task.agentId;
        }
        if (/\bopenclaude\b/.test(task.command ?? '')) {
            return OPENCLAUDE_AGENT_ID;
        }
        return ctx.isQaiqRunner(undefined, task.command) ? QAIQ_AGENT_ID : SHELL_AGENT_ID;
}

export function readCustomAgentsExtracted(ctx: QaapAgentTaskRunnerContext): AgentCandidate[] {
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

export async function restoreFromDiskExtracted(ctx: QaapAgentTaskRunnerContext): Promise<void> {
        ctx.recoveryState = 'loading';
        try {
            const raw = await fsp.readFile(INDEX_PATH, 'utf8');
            ctx.restorePersistedIndex(JSON.parse(raw));
            ctx.recoveryState = 'ready';
            await ctx.persist();
            ctx.drainQueuedTasks();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                ctx.recoveryState = 'ready';
            } else {
                ctx.recoveryState = 'failed';
                console.warn('[qaap-agent-tasks] recovery failed; task creation and index writes are blocked.');
            }
        }
}

export function restorePersistedIndexExtracted(ctx: QaapAgentTaskRunnerContext, stored: unknown): void {
        const legacy = Array.isArray(stored);
        if (!legacy && (stored as Partial<PersistedAgentTaskIndex> | undefined)?.version !== 2) {
            throw new Error('Unsupported persisted agent task index version.');
        }
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
            // JSON may be damaged or from an incompatible release. Never use inherited keys
            // (e.g. __proto__) or execute a request associated with a different workspace.
            const candidate = task.state === 'queued' && queuedRequests &&
                Object.prototype.hasOwnProperty.call(queuedRequests, task.id) ? queuedRequests[task.id] : undefined;
            const queuedRequest = candidate && typeof candidate === 'object' && !Array.isArray(candidate) &&
                typeof candidate.cwd === 'string' && typeof task.cwd === 'string' &&
                path.isAbsolute(candidate.cwd) && path.resolve(candidate.cwd) === path.resolve(task.cwd) &&
                (candidate.prompt === undefined || typeof candidate.prompt === 'string') &&
                (candidate.command === undefined || typeof candidate.command === 'string') &&
                (candidate.prompt?.trim() || candidate.command?.trim())
                ? candidate : undefined;
            const state = task.state === 'running' || (task.state === 'queued' && !queuedRequest)
                ? 'interrupted' as const
                : task.state;
            ctx.tasks.set(task.id, { ...task, state, ...(state === 'interrupted' && task.state !== 'interrupted' ? { finishedAt: Date.now() } : {}) });
            if (task.clientRequestId) {
                ctx.clientRequestTaskIds ??= new Map();
                ctx.clientRequestTaskIds.set(`${task.ownerLogin?.trim() || '_'}:${task.clientRequestId}`, task.id);
            }
            if (state === 'queued' && queuedRequest) {
                ctx.queuedCreateRequests.set(task.id, queuedRequest);
            }
        }
        const queued = [...ctx.tasks.values()]
                .filter((task: QaapAgentTask) => task.state === 'queued')
                .sort(compareQueuedTasks);
        queued.forEach((task: QaapAgentTask, index: number) => {
                if (task.queuePosition !== index + 1) {
                        ctx.tasks.set(task.id, { ...task, queuePosition: index + 1 });
                }
        });
}

export function countRunningTasksExtracted(ctx: QaapAgentTaskRunnerContext): number {
        let count = 0;
        for (const task of ctx.tasks.values()) {
            if (task.state === 'running' || ctx.stoppingTaskIds?.has(task.id)) {
                count++;
            }
        }
        return count;
}

export function runningTaskCountForOwnerExtracted(ctx: QaapAgentTaskRunnerContext, ownerLogin: string): number {
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

export function ownerAtConcurrencyCapExtracted(ctx: QaapAgentTaskRunnerContext, ownerLogin: string | undefined): boolean {
        const owner = ownerLogin?.trim();
        if (!owner) {
        return false;
        }
        const cap = ctx.billingStore?.maxConcurrentAgentsForOwner?.(owner)
            ?? ctx.maxConcurrentAgentsPerUser();
        return ctx.runningTaskCountForOwner(owner) >= cap;
}

function queueOwnerKey(ownerLogin: string | undefined): string {
        return ownerLogin?.trim().toLowerCase() ?? '';
}

function queuePositionForSort(task: QaapAgentTask): number {
        return typeof task.queuePosition === 'number' && Number.isFinite(task.queuePosition)
            ? task.queuePosition
            : task.createdAt;
}

function compareQueuedTasks(left: QaapAgentTask, right: QaapAgentTask): number {
        return queuePositionForSort(left) - queuePositionForSort(right)
            || left.createdAt - right.createdAt
            || left.id.localeCompare(right.id);
}

/**
 * Reorder only tasks owned by the authenticated user. The complete queue is reindexed after the
 * move, which keeps the persisted order compact and makes recovery deterministic even for legacy
 * tasks that predate `queuePosition`.
 */
export function reorderQueuedTaskExtracted(
        ctx: QaapAgentTaskRunnerContext,
        id: string,
        direction: 'up' | 'down',
        ownerLogin?: string,
): QaapAgentTask | undefined {
        const task = ctx.tasks.get(id) as QaapAgentTask | undefined;
        if (!task || task.state !== 'queued' || queueOwnerKey(task.ownerLogin) !== queueOwnerKey(ownerLogin)) {
                return undefined;
        }
        const owned = [...ctx.tasks.values()]
            .filter((candidate: QaapAgentTask) => candidate.state === 'queued'
                && queueOwnerKey(candidate.ownerLogin) === queueOwnerKey(ownerLogin))
            .sort(compareQueuedTasks);
        const currentIndex = owned.findIndex(candidate => candidate.id === id);
        const targetIndex = currentIndex + (direction === 'up' ? -1 : 1);
        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= owned.length) {
                return undefined;
        }

        const queue = [...ctx.tasks.values()]
            .filter((candidate: QaapAgentTask) => candidate.state === 'queued')
            .sort(compareQueuedTasks);
        const ownedSlots = queue
            .map((candidate: QaapAgentTask, index: number) => ({ candidate, index }))
            .filter(({ candidate }) => queueOwnerKey(candidate.ownerLogin) === queueOwnerKey(ownerLogin));
        const reorderedOwned = [...owned];
        [reorderedOwned[currentIndex], reorderedOwned[targetIndex]] = [reorderedOwned[targetIndex], reorderedOwned[currentIndex]];
        const changed: QaapAgentTask[] = [];
        ownedSlots.forEach(({ candidate, index }, slotIndex) => {
                const replacement = reorderedOwned[slotIndex];
                const updated: QaapAgentTask = { ...replacement, queuePosition: index + 1 };
                ctx.tasks.set(updated.id, updated);
                if (updated.id !== candidate.id || updated.queuePosition !== candidate.queuePosition) {
                        changed.push(updated);
                }
        });
        // Reindex other queued tasks too. Their relative order is unchanged, but emitting the
        // update keeps every connected client in sync with the persisted position shown in detail.
        queue.forEach((candidate: QaapAgentTask, index: number) => {
                if (queueOwnerKey(candidate.ownerLogin) === queueOwnerKey(ownerLogin)) {
                        return;
                }
                const updated: QaapAgentTask = { ...candidate, queuePosition: index + 1 };
                ctx.tasks.set(updated.id, updated);
                if (updated.queuePosition !== candidate.queuePosition) {
                        changed.push(updated);
                }
        });
        void ctx.persist();
        for (const updated of changed) {
                ctx.onDidChangeTaskEmitter.fire({ type: 'reordered', task: updated });
        }
        return ctx.tasks.get(id);
}

export function drainQueuedTasksExtracted(ctx: QaapAgentTaskRunnerContext): void {
        if (ctx.recoveryState === 'loading' || ctx.recoveryState === 'failed' || ctx.storageWriteFailed) {
        return;
        }
        while (ctx.countRunningTasks() < ctx.maxConcurrentAgents()) {
            // Skip queued tasks whose owner is already at their per-user cap so one busy user can't
            // block everyone behind them in the FIFO queue — promote the next eligible tenant instead.
            const next = [...ctx.tasks.values()]
                .filter(task => task.state === 'queued' && !ctx.ownerAtConcurrencyCap(task.ownerLogin))
                .sort(compareQueuedTasks)[0];
            if (!next) {
                return;
            }
            const request = ctx.queuedCreateRequests.get(next.id);
            if (!request) {
                ctx.finishTask(next.id, 'failed', undefined);
                continue;
            }
            const running: QaapAgentTask = { ...next, state: 'running', startedAt: Date.now(), queuePosition: undefined };
            ctx.tasks.set(next.id, running);
            ctx.queuedCreateRequests.delete(next.id);
            void ctx.spawnProcessWhenReady(running, request);
            void ctx.persist();
            ctx.onDidChangeTaskEmitter.fire({ type: 'created', task: running });
        }
}

export function listForCwdExtracted(ctx: QaapAgentTaskRunnerContext, cwd: string | undefined): QaapAgentTask[] {
        const all = ctx.list();
        if (!cwd) {
            return all;
        }
        const resolved = path.resolve(cwd);
        return all.filter(task => task.cwd === resolved);
}

export function listAllGroupedByCwdExtracted(ctx: QaapAgentTaskRunnerContext): QaapAgentTaskCwdGroup[] {
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

export function warmForCwdExtracted(ctx: QaapAgentTaskRunnerContext, cwd: string): QaapAgentWarmResult {
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

export function listQaiqModelsExtracted(ctx: QaapAgentTaskRunnerContext, ownerLogin?: string): QaapQaiqModelOption[] {
        return listQaiqModelsFromPreferences(
            ctx.preferenceReaderForOwner(ownerLogin),
            usesSharedAiSettingsFallback(ownerLogin) ? (key: string) => process.env[key] : () => undefined,
        );
}

export function listModelsForAgentExtracted(
        ctx: QaapAgentTaskRunnerContext,
        agentId: string | undefined,
        ownerLogin?: string,
): QaapQaiqModelOption[] {
        // Model catalogs are requested after the agent list has already been rendered. Do not
        // make this read-only endpoint depend on the runner's detected-agent cache being an
        // exact match for the browser's canonical id: a cold hosted workspace can expose the
        // harness while that cache is still warming, which used to make the VPS return [] for
        // Codex even though its native catalog was available.
        const normalized = agentId?.trim().toLowerCase();
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
        // Keep the native catalog visible when Starter cannot use hosted Codex models.
        // The picker can then explain the lock instead of opening an empty submenu;
        // task startup still enforces the same hosted-model entitlement.
        const userSessionConnected = ctx.isAgentConnected?.(normalized, owner) === true;
        return models.map(model => {
            if (!isHostedCodexUsage(normalized, model.modelId)) {
                return model;
            }
            // A user's own Codex login is BYOK/user-session usage. It must not be locked merely
            // because the Qaap account is on Starter; only Qaap-hosted execution is plan-gated.
            if (userSessionConnected) {
                return { ...model, available: true };
            }
            return hostedModelsAllowed
                ? model
                : { ...model, available: false, unavailableReason: 'plan' as const };
        });
}

export function defaultAgentExtracted(ctx: QaapAgentTaskRunnerContext, isAgentEnabled: (agentId: string) => boolean = () => true): string {
        const configured = ctx.normalizeAgentId(process.env.QAAP_DEFAULT_AGENT);
        if (configured && ctx.detectedAgents.has(configured) && !isUiHiddenVpsAgent(configured) && isAgentEnabled(configured)) {
            return configured;
        }
        for (const id of DEFAULT_AGENT_PREFERENCE) {
            if (ctx.detectedAgents.has(id) && !isUiHiddenVpsAgent(id) && isAgentEnabled(id)) {
                return id;
            }
        }
        for (const candidate of [...ctx.detectedAgents.values()]) {
            if (
                !AGENT_CANDIDATES.some(builtIn => builtIn.id === candidate.id)
                && !isUiHiddenVpsAgent(candidate.id)
                && isAgentEnabled(candidate.id)
            ) {
                return candidate.id;
            }
        }
        if (process.env.QAAP_AGENT_COMMAND?.trim()) {
            return ENV_AGENT_ID;
        }
        return SHELL_AGENT_ID;
}

export function normalizeAgentIdExtracted(ctx: QaapAgentTaskRunnerContext, token: string | undefined): string | undefined {
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

export async function detailExtracted(ctx: QaapAgentTaskRunnerContext, id: string): Promise<QaapAgentTaskDetail | undefined> {
        const task = ctx.tasks.get(id);
        if (!task) {
            return undefined;
        }
        return { ...task, log: await ctx.readLog(id) };
}
