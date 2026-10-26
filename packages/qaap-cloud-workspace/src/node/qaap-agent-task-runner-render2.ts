import {
    AGENT_CANDIDATES, CUSTOM_AGENTS_ENV, DEFAULT_AGENT_PREFERENCE, ENV_AGENT_ID, HELPER_BIN_DIR, HELPER_BIN_PATH, HELPER_CLI_SOURCE, INDEX_PATH,
    QAIQ_AGENT_ID, SHELL_AGENT_ID, TOKEN_PATH, TOKENS_PATH, type AgentCandidate, type PersistedAgentTaskIndex,
} from './qaap-agent-task-runner-constants';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
// Extracted from qaap-agent-task-runner.ts

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { sweepOrphanedTempFiles, writeJsonAtomicSync } from './qaap-write-json-atomic';
import * as path from 'path';
import {
    type QaapQaiqModelOption,
    type QaapAgentTask,
    type QaapAgentTaskCwdGroup,
    type QaapAgentTaskDetail,
    type QaapCreateAgentTaskRequest,
    type QaapAgentWarmResult,
    type QaapAgentAccessState,
} from '../common/qaap-agent-task';
import { rememberQaapHostedRuntime } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';
import { QaapSecretCipher } from '@theia/qaap-persistence/lib/node/qaap-secret-cipher';
import { isQaapProductionRuntime } from './qaap-agent-spawn-identity';
import { mustWithholdOperatorProviderCredentials } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import {
    isUiHiddenVpsAgent,
    resolveQaapBuiltinAgentMentionId,
    resolveQaapCodexTemplate,
} from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { OPENCLAUDE_AGENT_ID, resolveQaapAgentMentionToken } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { isOpenCodeFreeModelId } from '@theia/qaap-shared-core/lib/common/qaap-opencode-model-catalog';
import { agentUsesSettingsModelCatalog } from '../common/qaap-agent-native-model-catalog';
import { isHostedCodexUsage } from '../common/qaap-billing-plans';
import { listNativeAgentModels } from './qaap-agent-native-models';
import { isHostedCodexEntitled, resolveAgentAccess } from './qaap-agent-access';
import { listQaiqModelsFromPreferences } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-model-catalog';
import { resolveTrustedExecutable } from './qaap-trusted-executable';

export function initExtracted(ctx: QaapAgentTaskRunnerContext): void {
        rememberQaapHostedRuntime(isQaapProductionRuntime(process.env));
        ctx.recoveryState = 'loading';
        ctx.detectAgents();
        ctx.ensureHelperCli();
        ctx.recoveryReady = ctx.restoreFromDisk();
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

/** AAD of a sealed helper token: bound to the owner so a token copied to another owner's entry does not open. */
function helperTokenAad(owner: string): string {
    return `task-token:${owner}`;
}

/**
 * Opens the helper tokens read from `task-tokens.json`. Legacy plain tokens are accepted (they are sealed
 * on the next persist). A token that cannot be opened is skipped and a new one is issued on demand.
 */
export function openHelperTokens(stored: Record<string, unknown>, cipher: QaapSecretCipher): Map<string, string> {
    const tokens = new Map<string, string>();
    for (const [owner, token] of Object.entries(stored)) {
        if (typeof token !== 'string' || !token) {
            continue;
        }
        try {
            tokens.set(owner, cipher.decrypt(token, helperTokenAad(owner)));
        } catch (error) {
            console.warn('[qaap-agent-tasks] could not open a sealed helper token; a new one is issued on demand:', error instanceof Error ? error.message : String(error));
        }
    }
    return tokens;
}

/**
 * Seals every helper token for `task-tokens.json`, each bound to its owner.
 *
 * An entry already on disk that is a sealed envelope this process cannot open (wrong or rotated key) is
 * never overwritten or dropped: it is copied back verbatim, and an in-memory token for that owner is not
 * persisted over it. The key can be restored later and the original envelope then opens again.
 */
export function sealHelperTokens(
    tokens: ReadonlyMap<string, string>,
    cipher: QaapSecretCipher,
    stored: Record<string, unknown> = {},
): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [owner, raw] of Object.entries(stored)) {
        if (typeof raw === 'string' && cipher.isEncrypted(raw) && !canOpenHelperToken(owner, raw, cipher)) {
            obj[owner] = raw;
        }
    }
    for (const [owner, token] of tokens) {
        if (owner in obj) {
            continue;
        }
        obj[owner] = cipher.encrypt(token, helperTokenAad(owner));
    }
    return obj;
}

function canOpenHelperToken(owner: string, sealed: string, cipher: QaapSecretCipher): boolean {
    try {
        cipher.decrypt(sealed, helperTokenAad(owner));
        return true;
    } catch {
        return false;
    }
}

/** Entries currently in `task-tokens.json`, as stored (sealed or legacy plain). Empty when absent or unreadable. */
function readStoredHelperTokens(): Record<string, unknown> {
    try {
        return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
}

export function loadHelperTokensExtracted(ctx: QaapAgentTaskRunnerContext): void {
        // Built outside the try: a malformed QAAP_SECRETS_KEYS must fail loudly, not leave tokens unloaded.
        const cipher = QaapSecretCipher.fromEnvironment();
        try {
            const raw = fs.readFileSync(TOKENS_PATH, 'utf8');
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            for (const [owner, token] of openHelperTokens(parsed, cipher)) {
                ctx.helperTokens.set(owner, token);
            }
        } catch {
            /* no prior tokens — created on demand */
        }
}

export function persistHelperTokensExtracted(ctx: QaapAgentTaskRunnerContext): void {
        const cipher = QaapSecretCipher.fromEnvironment();
        try {
            writeJsonAtomicSync(TOKENS_PATH, sealHelperTokens(ctx.helperTokens, cipher, readStoredHelperTokens()), { space: 0, mode: 0o600 });
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

const QAIQ_VERSION_PROBE_TIMEOUT_MS = 15_000;

export function logDetectedAgentsExtracted(
    ctx: QaapAgentTaskRunnerContext,
    resolveQaiq: () => string | undefined = () => resolveTrustedExecutable(QAIQ_AGENT_ID),
): void {
        const ids = [...ctx.detectedAgents.keys()];
        console.log(`[qaap-agent-tasks] detected agents: ${ids.length ? ids.join(', ') : '(none — install qaiq/openclaude or set QAAP_AGENT_COMMAND)'}`);
        if (!ctx.detectedAgents.has(QAIQ_AGENT_ID)) {
            return;
        }
        // Log the version only of a qaiq the backend uid trusts; a tenant-installed one never runs here.
        const qaiq = resolveQaiq();
        if (!qaiq) {
            return;
        }
        // Asynchronous: this runs from the task runner's @postConstruct, before the backend listens.
        // `qaiq --version` boots a Node CLI (2-3.5 s on a tenant), and spawnSync held the whole
        // backend startup for it just to print this line.
        try {
            execFile(qaiq, ['--version'], { encoding: 'utf8', timeout: QAIQ_VERSION_PROBE_TIMEOUT_MS }, (_error, stdout, stderr) => {
                const line = (stdout || stderr || '').trim().split('\n')[0];
                if (line) {
                    console.log(`[qaap-agent-tasks] qaiq: ${line}`);
                }
            });
        } catch {
            /* ignore */
        }
}

export function resolveAntigravityBinExtracted(ctx: QaapAgentTaskRunnerContext): string | undefined {
        if (ctx.isOnPath('agy')) {
            return 'agy';
        }
        // Gemini CLI before the community `antigravity`/`ag` CLI: the latter drives a running
        // Antigravity desktop app and can never sign in on a server, while Gemini CLI signs in
        // with the same Google account ("Login with Google") from the Connect dialog.
        if (ctx.isOnPath('gemini')) {
            return 'gemini';
        }
        if (ctx.isOnPath('antigravity')) {
            return 'antigravity';
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
        // Remove temp files a previous boot (possibly with this same pid) left behind before the
        // first write, so a stale temp can never block index persistence.
        await sweepOrphanedTempFiles(INDEX_PATH);
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

/**
 * Tasks share a repository slot when they run in the same resolved cwd. Windows paths are
 * case-insensitive, so the key is lower-cased there to avoid two spellings escaping the cap.
 */
function repoConcurrencyKey(cwd: string | undefined): string {
        if (!cwd?.trim()) {
            return '';
        }
        const resolved = path.resolve(cwd);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function runningTaskCountForRepoExtracted(ctx: QaapAgentTaskRunnerContext, cwd: string): number {
        const repoKey = repoConcurrencyKey(cwd);
        if (!repoKey) {
            return 0;
        }
        let count = 0;
        for (const task of ctx.tasks.values()) {
            if ((task.state === 'running' || ctx.stoppingTaskIds?.has(task.id)) && repoConcurrencyKey(task.cwd) === repoKey) {
                count++;
            }
        }
        return count;
}

export function repoAtConcurrencyCapExtracted(ctx: QaapAgentTaskRunnerContext, cwd: string | undefined): boolean {
        const cap = ctx.maxConcurrentAgentsPerRepo();
        if (cap <= 0 || !cwd?.trim()) {
            return false;
        }
        return ctx.runningTaskCountForRepo(cwd) >= cap;
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

/**
 * True when another shared-working-tree task of the same owner runs (or is still stopping) in the same cwd.
 * Tasks with their own worktree never count, and neither do other owners or repositories.
 */
export function sharedWorkingTreeBusyExtracted(ctx: QaapAgentTaskRunnerContext, ownerLogin: string | undefined, cwd: string, exceptId?: string): boolean {
        const repoKey = repoConcurrencyKey(cwd);
        const ownerKey = queueOwnerKey(ownerLogin);
        for (const task of ctx.tasks.values()) {
            if (task.id === exceptId || task.sharedWorkingTree !== true) {
                continue;
            }
            if (queueOwnerKey(task.ownerLogin) !== ownerKey || repoConcurrencyKey(task.cwd) !== repoKey) {
                continue;
            }
            if (task.state === 'running' || ctx.stoppingTaskIds?.has(task.id)) {
                return true;
            }
        }
        return false;
}

export function drainQueuedTasksExtracted(ctx: QaapAgentTaskRunnerContext): void {
        if (ctx.recoveryState === 'loading' || ctx.recoveryState === 'failed' || ctx.storageWriteFailed
            || ctx.isDrainingForDeploy?.() === true) {
        return;
        }
        while (ctx.countRunningTasks() < ctx.maxConcurrentAgents()) {
            // Skip queued tasks whose owner or repository is already at its cap so one busy user or
            // repo can't block everyone behind them in the FIFO queue — promote the next eligible task.
            // A shared-working-tree task also waits while its owner has another one running in that cwd.
            const next = [...ctx.tasks.values()]
                .filter(task => task.state === 'queued'
                    && !ctx.ownerAtConcurrencyCap(task.ownerLogin)
                    && !ctx.repoAtConcurrencyCap(task.cwd)
                    && !(task.sharedWorkingTree === true && sharedWorkingTreeBusyExtracted(ctx, task.ownerLogin, task.cwd, task.id)))
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
            // Operator env credentials count only where the owner's agents would receive them (see stripSharedProviderEnv).
            mustWithholdOperatorProviderCredentials(ownerLogin) ? () => undefined : (key: string) => process.env[key],
        );
}

/**
 * OpenCode free models stay usable without a sign-in. Paid models stay visible but locked until the
 * owner is connected; an unknown (still probing) state shows no lock.
 */
function applyOpenCodePaidModelAccess(model: QaapQaiqModelOption, access: QaapAgentAccessState): QaapQaiqModelOption {
    if (isOpenCodeFreeModelId(model.modelId)) {
        return model;
    }
    if (access === 'session' || access === 'hosted') {
        return { ...model, available: true };
    }
    if (access === 'unknown') {
        return model;
    }
    return { ...model, available: false, unavailableReason: 'not-connected' as const };
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
        // Same access answer as the picker row (resolveAgentAccess), so the row and its models agree.
        // Keep the native catalog visible when the owner cannot use it yet; the picker explains the lock
        // instead of opening an empty submenu, and task startup still enforces the billing gate.
        const snapshot = ctx.agentConnectionSnapshot(normalized, owner);
        const access = resolveAgentAccess({
            agentId: normalized,
            connectionState: snapshot.connectionState,
            probeSettled: snapshot.probeSettled,
            hostedEntitled: isHostedCodexEntitled(ctx.billingStore?.peekEntitlements?.(owner)),
        });
        return models.map(model => {
            if (normalized === 'opencode') {
                return applyOpenCodePaidModelAccess(model, access);
            }
            if (!isHostedCodexUsage(normalized, model.modelId)) {
                return model;
            }
            // A user's own Codex login or Qaap-hosted entitlement unlocks the model. Only a settled
            // sign-out is locked, and it is an actionable sign-in rather than a plan restriction.
            if (access === 'session' || access === 'hosted') {
                return { ...model, available: true };
            }
            // While the probe is still pending there is no answer yet: show the model without a lock.
            if (access === 'unknown') {
                return model;
            }
            return { ...model, available: false, unavailableReason: 'not-connected' as const };
        });
}

const loggedDefaultAgentOverrides = new Set<string>();

/**
 * Operator hint (once per agent id, no owner, no secrets) when `QAAP_DEFAULT_AGENT` is skipped for an
 * owner it cannot serve, e.g. QAIQ for a user without their own provider key (keys are BYOK).
 */
export function logDefaultAgentOverriddenOnce(
    agentId: string,
    warn: (message: string) => void = message => console.warn(message),
    logged: Set<string> = loggedDefaultAgentOverrides,
): boolean {
    if (logged.has(agentId)) {
        return false;
    }
    logged.add(agentId);
    warn(`[qaap-agent-tasks] QAAP_DEFAULT_AGENT=${agentId} is not usable for at least one user (disabled, signed out, or no API key of `
        + 'their own in Settings → BYOK); they get the next usable agent instead.');
    return true;
}

/**
 * Default agent for an owner. Order: the operator's `QAAP_DEFAULT_AGENT`; then the first agent in
 * {@link DEFAULT_AGENT_PREFERENCE} that is actually usable right now (`isAgentUsable`: connected, or a
 * hosted agent the owner's plan allows); then the pre-existing "installed and not known to be
 * disconnected" preference (an agent whose auth probe has not answered yet, e.g. right after a
 * backend restart, keeps the pre-keyless behaviour instead of losing to the keyless agent); only
 * when every preferred agent is explicitly disconnected, QAIQ itself (the BYOK harness, even without
 * a key) so the composer shows the "add your API key in Settings → BYOK" prompt. The keyless hosted
 * agents (`HOSTED_KEYLESS_DEFAULT_AGENTS`) are never picked automatically; a user can still choose
 * them by hand. `isHarnessEnabled` is the admin/user enablement only, without the connection check,
 * so a disconnected QAIQ can still be the fallback.
 * An agent with no auth probe and no credential mapping (e.g. grok) never wins automatically; `QAAP_DEFAULT_AGENT` overrides.
 */
export function defaultAgentExtracted(
    ctx: QaapAgentTaskRunnerContext,
    isAgentEnabled: (agentId: string) => boolean = () => true,
    isAgentUsable: (agentId: string) => boolean = () => true,
    hasAuthSignal: (agentId: string) => boolean = () => true,
    isHarnessEnabled: (agentId: string) => boolean = () => true,
): string {
        const configured = ctx.normalizeAgentId(process.env.QAAP_DEFAULT_AGENT);
        if (configured && ctx.detectedAgents.has(configured) && !isUiHiddenVpsAgent(configured)) {
            if (isAgentEnabled(configured)) {
                return configured;
            }
            logDefaultAgentOverriddenOnce(configured);
        }
        const selectable = (id: string): boolean => ctx.detectedAgents.has(id) && !isUiHiddenVpsAgent(id) && isAgentEnabled(id);
        for (const id of DEFAULT_AGENT_PREFERENCE) {
            if (selectable(id) && isAgentUsable(id)) {
                return id;
            }
        }
        // `isAgentEnabled` already drops a known-disconnected harness, so what is left here is one
        // whose connection state is still `unknown`: keep the pre-keyless default for it. Only when
        // that state can still resolve (`hasAuthSignal`: an auth probe or Settings credentials exist);
        // a harness with neither stays `unknown` forever and would win whether or not it is signed in.
        for (const id of DEFAULT_AGENT_PREFERENCE) {
            if (selectable(id) && hasAuthSignal(id)) {
                return id;
            }
        }
        // Every preferred agent is explicitly disconnected: default to QAIQ even without a key, so the
        // composer's BYOK prompt is shown instead of silently starting a keyless hosted agent.
        if (ctx.detectedAgents.has(QAIQ_AGENT_ID) && !isUiHiddenVpsAgent(QAIQ_AGENT_ID) && isHarnessEnabled(QAIQ_AGENT_ID)) {
            return QAIQ_AGENT_ID;
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

/**
 * {@link defaultAgentExtracted} after giving the auth probes of the preferred agents up to
 * `budgetMs` to settle (`refreshConnectionState` starts or joins a probe; undefined when the cached
 * state is fresh). A probe still pending at the deadline leaves that agent `unknown`, which
 * keeps the pre-keyless default for it rather than falling through to the keyless agent; a probe
 * that failed is expected to make `isAgentEnabled` false for it (the runner treats it as signed out).
 * `isProbeWorthAwaiting` (default `isAgentEnabled`) picks the probes to await, so a caller can still
 * re-probe an agent that an earlier failed probe made unselectable.
 */
export async function defaultAgentFreshExtracted(
    ctx: QaapAgentTaskRunnerContext,
    isAgentEnabled: (agentId: string) => boolean,
    isAgentUsable: (agentId: string) => boolean,
    refreshConnectionState: (agentId: string) => Promise<unknown> | undefined,
    budgetMs: number,
    hasAuthSignal: (agentId: string) => boolean = () => true,
    isProbeWorthAwaiting: (agentId: string) => boolean = isAgentEnabled,
    isHarnessEnabled: (agentId: string) => boolean = () => true,
): Promise<string> {
    const pending = DEFAULT_AGENT_PREFERENCE
        .filter(id => ctx.detectedAgents.has(id) && !isUiHiddenVpsAgent(id) && isProbeWorthAwaiting(id))
        .map(id => refreshConnectionState(id))
        .filter((probe): probe is Promise<unknown> => !!probe);
    if (pending.length > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
            Promise.all(pending.map(probe => probe.catch(() => undefined))),
            new Promise<void>(resolve => {
                timer = setTimeout(resolve, budgetMs);
            }),
        ]);
        clearTimeout(timer);
    }
    return defaultAgentExtracted(ctx, isAgentEnabled, isAgentUsable, hasAuthSignal, isHarnessEnabled);
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
