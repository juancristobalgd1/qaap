// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import * as http from 'http';
import * as https from 'https';
import { WebSocketServer, WebSocket as WsClient } from 'ws';
import { nls } from '@theia/core/lib/common/nls';
import {
    QAAP_AGENT_TASK_API_PATH,
    QaapAgentTaskKind,
    type QaapAgentHarnessStatusResponse,
    type QaapAgentTaskAllResponse,
    type QaapAgentTaskListResponse,
    type QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import {
    ComposerPromptImproveTimeoutError,
    type QaapImproveComposerPromptRequestBody,
} from '@theia/qaap-composer/lib/common/qaap-composer-prompt-improve';
import { describeAgentTurnFailure, type QaapAgentFailureReasonKind } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { resolveAgentBrand } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';
import { QAAP_AGENT_CONNECTION_REFRESH_BUDGET_MS, QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapAgentQueueFullError } from './qaap-agent-queue-policy';
import { QaapAgentStorageUnavailableError } from './qaap-agent-storage-unavailable-error';
import { QaapAgentCliUpdateService } from './qaap-agent-cli-update-service';
import { isQaapProductionRuntime } from './qaap-agent-spawn-identity';
import type { QaapAgentCliUpdateResult } from '@theia/qaap-agents-ui/lib/common/qaap-agent-cli-update';
import { QaapBillingStore } from './qaap-billing-store';
import { QaapStandaloneTaskModelFallback } from './qaap-standalone-task-model-fallback';
import { antigravityBinFor, listNativeAgentModels, prepareNativeAgentModels } from './qaap-agent-native-models';
import { annotateModelsForAgent } from './qaap-agent-task-runner-render2';
import {
    QaapGithubAuthGuard,
    type QaapGithubAuthContext,
} from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import {
    QAAP_REPOSITORY_CLONE_UNAVAILABLE_CODE,
    QaapMissingCloneRecovery,
} from '@theia/qaap-shared-core/lib/node/qaap-missing-clone-recovery';
import { QAAP_BUILTIN_AGENT_IDS, resolveQaapBuiltinAgentMentionId } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import {
    checkQaapHarnessEnvName,
    isQaapHarnessSettingsId,
    QAAP_HARNESS_ENV_VALUE_MAX_LENGTH,
    QAAP_HARNESS_SETTINGS_PREF,
    readQaapHarnessSettingsFor,
    resolveQaapHarnessBaseId,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';
import { QaapHarnessEnvSecretStore } from './qaap-harness-env-secret-store';
import { checkQaapHarnessBinaryPath, checkQaapHarnessHomeDir, isQaapHarnessLaunchOverrideRuntime } from './qaap-harness-launch-overrides';
import type { QaapAgentTask, QaapAgentTaskCwdGroup } from '../common/qaap-agent-task';
import { QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { QaapAsyncRoute } from '@theia/qaap-shared-core/lib/node/qaap-async-route';
import { QaapAgentEffort } from '@theia/qaap-shared-core/lib/common/qaap-agent-effort';
import {
    isQaapSessionAttestationAgent,
    QAAP_AGENT_SESSION_ATTEST_ROUTE,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-session-attestation';
import { QAAP_HARNESS_SIGN_OUT_ROUTE } from '@theia/qaap-shared-core/lib/common/qaap-harness-sign-out';
import { QaapHarnessSignOutService } from './qaap-harness-sign-out-service';

/** Keep SSE connections warm through proxies that idle-kill silent sockets. */
const SSE_HEARTBEAT_MS = 25_000;
/** Ping interval for WebSocket connections — keeps the socket alive through proxies. */
const WS_PING_MS = 25_000;
const WS_PATH = `${QAAP_AGENT_TASK_API_PATH}/ws`;
/** How long the picker's model request waits for a cold native CLI model discovery. */
const QAAP_NATIVE_MODEL_DISCOVERY_BUDGET_MS = 1_200;
/**
 * `fresh=1` (right after a sign-in or a provider was connected): wait for the CLI's own listing instead of
 * answering with the previous catalog. `pi --list-models` takes 1-2 s on an idle tenant, so the regular
 * budget answered with the old list, the browser cached it and the new provider's models only showed
 * after a reload.
 */
const QAAP_NATIVE_MODEL_FRESH_DISCOVERY_BUDGET_MS = 12_000;
/** How long the picker's model request waits for the billing account before answering without it. */
const QAAP_AGENT_MODELS_BILLING_BUDGET_MS = 800;

/** Header carrying the helper-CLI token when an agent calls back to spawn a sub-task. */
const HELPER_TOKEN_HEADER = 'x-qaap-task-token';

/**
 * Wire cap for `task.command` in the WebSocket snapshot. Commands carry the FULL agent prompt
 * (100KB+ observed), the history spans thousands of tasks, and the UI only reads the first ~80
 * chars as a title fallback — ship a generous prefix instead of the whole prompt.
 */
const TASK_COMMAND_WIRE_MAX_CHARS = 2048;

function trimTaskGroupCommandsForWire(group: QaapAgentTaskCwdGroup): QaapAgentTaskCwdGroup {
    return {
        ...group,
        tasks: group.tasks.map(task => task.command.length > TASK_COMMAND_WIRE_MAX_CHARS
            ? { ...task, command: task.command.slice(0, TASK_COMMAND_WIRE_MAX_CHARS) }
            : task),
    };
}

/** HTTP surface for the background agent-task runner. */
/** HTTP status and short reason for a failed improve-prompt CLI run; the raw stderr never leaves the server. */
export interface QaapImprovePromptFailure {
    readonly status: number;
    readonly error: string;
    readonly kind: QaapAgentFailureReasonKind | 'unknown';
}

const IMPROVE_PROMPT_FAILURE_STATUS: Partial<Record<QaapAgentFailureReasonKind, number>> = {
    usage_limit: 429,
    rate_limit: 429,
    sign_in: 401,
    api_key: 401,
    provider_key: 401,
    network: 502,
    model: 502,
    model_access: 502,
    provider_policy: 502,
    provider_rejected: 502,
};

/**
 * Classifies the CLI failure behind a prompt improvement with the shared failure classifier. Only the
 * localized reason label is returned; the raw error text (which may echo prompts, paths or tokens)
 * stays out of the response.
 */
export function describeImprovePromptFailure(error: unknown, agentId: string): QaapImprovePromptFailure {
    const reason = describeAgentTurnFailure(error instanceof Error ? error.message : undefined, {
        agentLabel: resolveAgentBrand(agentId)?.label,
    });
    if (!reason || reason.kind === 'stopped') {
        return {
            status: 500,
            error: nls.localize('qaap/agentTasks/improvePromptFailed', 'Could not improve the prompt. Try again.'),
            kind: 'unknown',
        };
    }
    return {
        status: IMPROVE_PROMPT_FAILURE_STATUS[reason.kind] ?? 500,
        error: reason.label,
        kind: reason.kind,
    };
}

@injectable()
export class QaapAgentTaskEndpoint implements BackendApplicationContribution {

    @inject(QaapAgentTaskRunner)
    protected readonly runner: QaapAgentTaskRunner;

    @inject(QaapAgentCliUpdateService)
    protected readonly cliUpdates: QaapAgentCliUpdateService;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapBillingStore) @optional()
    protected readonly billingStore: QaapBillingStore | undefined;

    /** Clones a project again when its clone is missing from disk; absent, a missing clone is denied. */
    @inject(QaapMissingCloneRecovery) @optional()
    protected readonly cloneRecovery: QaapMissingCloneRecovery | undefined;

    /** Re-runs a failed standalone task on the agent's next fallback model; absent, tasks never fall back. */
    /** Values of the Settings → Harness environment variables (desktop app routes only). */
    @inject(QaapHarnessEnvSecretStore) @optional()
    protected readonly harnessEnvSecrets: QaapHarnessEnvSecretStore | undefined;

    @inject(QaapStandaloneTaskModelFallback) @optional()
    protected readonly modelFallback: QaapStandaloneTaskModelFallback | undefined;

    @inject(QaapHarnessSignOutService) @optional()
    protected readonly harnessSignOut: QaapHarnessSignOutService | undefined;

    configure(app: Application): void {
        app.get(`${QAAP_AGENT_TASK_API_PATH}/storage-health`, (req, res) => {
            this.handleStorageHealth(req, res);
        });
        app.post(`${QAAP_AGENT_TASK_API_PATH}/storage-retry`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleStorageRetry(req, res)));
        app.get(`${QAAP_AGENT_TASK_API_PATH}/agent-models`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleListAgentModels(req, res)));
        app.get(`${QAAP_AGENT_TASK_API_PATH}/harness-status`, (req, res) => {
            this.handleListHarnessStatuses(req, res);
        });
        app.post(`${QAAP_AGENT_TASK_API_PATH}/harness-settings/check`, (req, res) => {
            this.handleCheckHarnessLaunchSettings(req, res);
        });
        app.get(`${QAAP_AGENT_TASK_API_PATH}/harness-settings/env`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleListHarnessEnv(req, res)));
        app.post(`${QAAP_AGENT_TASK_API_PATH}/harness-settings/env`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleSetHarnessEnv(req, res)));
        app.post(`${QAAP_AGENT_TASK_API_PATH}/harness-settings/env/delete`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleDeleteHarnessEnv(req, res)));
        // Static `/cli-updates` segments must register before `/:id` below.
        app.get(`${QAAP_AGENT_TASK_API_PATH}/cli-updates`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleListCliUpdates(req, res)));
        app.post(`${QAAP_AGENT_TASK_API_PATH}/cli-updates/:agentId`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleInstallCliUpdate(req, res)));
        app.get(QAAP_AGENT_TASK_API_PATH, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            const cwd = typeof req.query.cwd === 'string' ? req.query.cwd : undefined;
            if (cwd && !this.auth.ownsWorkspacePath(ctx, cwd)) {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd });
                return;
            }
            res.json({
                tasks: this.filterTasks(ctx, this.runner.listForCwd(cwd)),
                agentConfigured: this.runner.isAgentConfigured(),
                qaiqInstalled: this.runner.isQaiqInstalled(),
                agents: this.runner.listAgents(this.auth.resolveUserLogin(ctx)),
                defaultAgent: this.runner.defaultAgent(this.auth.resolveUserLogin(ctx)),
                qaiqModels: this.runner.listQaiqModels(this.auth.resolveUserLogin(ctx)),
            } satisfies QaapAgentTaskListResponse);
        });
        // Cross-project dashboard feed — `/all` and `/stream` are static segments routed before
        // the `/:id` handler below so they never collide with a task id.
        app.get(`${QAAP_AGENT_TASK_API_PATH}/all`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleListAll(req, res)));
        app.get(`${QAAP_AGENT_TASK_API_PATH}/stream`, (req, res) => {
            this.handleStream(req, res);
        });
        app.delete(`${QAAP_AGENT_TASK_API_PATH}/project`, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            const cwd = typeof req.query.cwd === 'string' ? req.query.cwd.trim() : '';
            if (!cwd) {
                res.status(400).json({ error: '"cwd" is required.' });
                return;
            }
            if (!this.auth.ownsWorkspacePath(ctx, cwd)) {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd });
                return;
            }
            res.json({ removed: this.runner.deleteForCwd(cwd) });
        });
        app.post(`${QAAP_AGENT_TASK_API_PATH}/warm`, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            const body = (req.body ?? {}) as { cwd?: unknown };
            const rawCwd = typeof body.cwd === 'string' ? body.cwd.trim() : '';
            if (!rawCwd) {
                res.status(400).json({ error: '"cwd" is required.' });
                return;
            }
            const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, rawCwd);
            if (resolved.kind === 'needs-project') {
                // A container path (`/workspace`, `.../repos/users/{login}`, …) means "no project
                // selected" — there is nothing to warm and it is NOT an ownership violation, so
                // answer benignly instead of stamping ownership_denied into the security log
                // (the hosted IDE workspace is the container, so this fired on every reload).
                res.status(400).json({ error: QAAP_CONTAINER_CWD_ERROR });
                return;
            }
            if (resolved.kind !== 'ok') {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd: rawCwd });
                return;
            }
            try {
                res.json(this.runner.warmForCwd(resolved.cwd));
            } catch (error) {
                res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
            }
        });
        app.post(`${QAAP_AGENT_TASK_API_PATH}/${QAAP_AGENT_SESSION_ATTEST_ROUTE}`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleAttestAgentSession(req, res)));
        app.post(`${QAAP_AGENT_TASK_API_PATH}/${QAAP_HARNESS_SIGN_OUT_ROUTE}`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleHarnessSignOut(req, res)));
        app.post(`${QAAP_AGENT_TASK_API_PATH}/improve-prompt`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleImprovePrompt(req, res)));
        app.post(QAAP_AGENT_TASK_API_PATH, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleCreate(req, res)));
        app.get(`${QAAP_AGENT_TASK_API_PATH}/:id`, QaapAsyncRoute.wrap('qaap-agent-task', (req, res) => this.handleDetail(req, res)));
        app.post(`${QAAP_AGENT_TASK_API_PATH}/:id/cancel`, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            const existing = this.runner.listForCwd(undefined).find(task => task.id === req.params.id);
            if (!existing) {
                res.status(404).json({ error: 'Task not found.' });
                return;
            }
            if (!this.auth.ownsWorkspacePath(ctx, existing.cwd)) {
                this.auth.denyForbidden(res, req, 'agent_task', { taskId: req.params.id });
                return;
            }
            const task = this.runner.cancel(req.params.id);
            if (!task) {
                res.status(404).json({ error: 'Task not found.' });
                return;
            }
            res.json(task);
        });
        // Single-task delete. Same authentication and owner check as cancel; another owner's task is
        // reported as unknown so the id does not reveal that it exists.
        app.delete(`${QAAP_AGENT_TASK_API_PATH}/:id`, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            const existing = this.runner.listForCwd(undefined).find(task => task.id === req.params.id);
            if (!existing || !this.auth.ownsWorkspacePath(ctx, existing.cwd)) {
                res.status(404).json({ error: 'Task not found.' });
                return;
            }
            if (existing.state === 'running' || existing.state === 'queued') {
                this.runner.cancel(req.params.id);
            }
            if (!this.runner.deleteTask(req.params.id)) {
                res.status(404).json({ error: 'Task not found.' });
                return;
            }
            res.json({ ok: true });
        });
        app.post(`${QAAP_AGENT_TASK_API_PATH}/:id/reorder`, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            const direction = (req.body as { readonly direction?: unknown } | undefined)?.direction;
            if (direction !== 'up' && direction !== 'down') {
                res.status(400).json({ error: nls.localize('qaap/agentTasks/reorderDirectionRequired', 'Direction must be "up" or "down".') });
                return;
            }
            const existing = this.runner.listForCwd(undefined).find(task => task.id === req.params.id);
            if (!existing) {
                res.status(404).json({ error: 'Task not found.' });
                return;
            }
            if (!this.auth.ownsWorkspacePath(ctx, existing.cwd)) {
                this.auth.denyForbidden(res, req, 'agent_task', { taskId: req.params.id });
                return;
            }
            const ownerLogin = this.auth.resolveUserLogin(ctx);
            const taskOwner = existing.ownerLogin?.trim().toLowerCase() ?? '';
            const requester = ownerLogin?.trim().toLowerCase() ?? '';
            if (taskOwner !== requester) {
                this.auth.denyForbidden(res, req, 'agent_task', { taskId: req.params.id, action: 'reorder' });
                return;
            }
            const task = this.runner.reorderQueuedTask(req.params.id, direction, ownerLogin);
            if (!task) {
                res.status(409).json({ error: nls.localize('qaap/agentTasks/reorderUnavailable', 'Only queued tasks with a task in that direction can be reordered.') });
                return;
            }
            res.json(task);
        });
        app.post(`${QAAP_AGENT_TASK_API_PATH}/:id/retry`, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            const existing = this.runner.listForCwd(undefined).find(task => task.id === req.params.id);
            if (!existing) {
                res.status(404).json({ error: 'Task not found.' });
                return;
            }
            if (!this.auth.ownsWorkspacePath(ctx, existing.cwd)) {
                this.auth.denyForbidden(res, req, 'agent_task', { taskId: req.params.id });
                return;
            }
            const task = this.runner.retry(req.params.id, this.auth.resolveUserLogin(ctx));
            if (!task) {
                res.status(409).json({ error: nls.localize('qaap/agentTasks/retryUnavailable', 'Only failed or interrupted tasks can be retried.') });
                return;
            }
            res.status(201).json(task);
        });
        app.post(`${QAAP_AGENT_TASK_API_PATH}/:id/resume`, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            const existing = this.runner.listForCwd(undefined).find(task => task.id === req.params.id);
            if (!existing) {
                res.status(404).json({ error: 'Task not found.' });
                return;
            }
            if (!this.auth.ownsWorkspacePath(ctx, existing.cwd)) {
                this.auth.denyForbidden(res, req, 'agent_task', { taskId: req.params.id });
                return;
            }
            const task = this.runner.resume(req.params.id, this.auth.resolveUserLogin(ctx));
            if (!task) {
                res.status(409).json({ error: nls.localize('qaap/agentTasks/resumeUnavailable', 'Only interrupted tasks can be continued.') });
                return;
            }
            res.status(201).json(task);
        });
    }

    /** Capture the port the backend is listening on so spawned agents can call back via HTTP. */
    onStart(server: http.Server | https.Server): void {
        const address = server.address();
        if (address && typeof address === 'object') {
            this.runner.bindHelperApiUrl(address.port);
        }
        this.attachWebSocketServer(server);
    }

    /**
     * WebSocket endpoint at `WS_PATH`. On connect the server immediately sends a `snapshot`
     * message (equivalent to GET `/all`) so the client never needs a separate HTTP prime request.
     * Incremental task-change messages follow using the same `QaapAgentTaskEvent` shapes.
     */
    protected attachWebSocketServer(server: http.Server | https.Server): void {
        const wss = new WebSocketServer({ noServer: true });

        server.on('upgrade', (request, socket, head) => {
            try {
                const pathname = new URL(request.url ?? '', `http://${request.headers.host}`).pathname;
                if (pathname === WS_PATH) {
                    wss.handleUpgrade(request, socket as import('net').Socket, head, client => {
                        wss.emit('connection', client, request);
                    });
                }
            } catch {
                socket.destroy();
            }
        });

        wss.on('connection', (client: WsClient, request: import('http').IncomingMessage) => {
            const ctx = this.auth.authenticate(request as unknown as Request);
            if (ctx.kind === 'unauthorized') {
                client.close(4401, 'Not signed in');
                return;
            }
            const snapshot = {
                type: 'snapshot',
                groups: this.filterTaskGroups(ctx, this.runner.listAllGroupedByCwd()).map(trimTaskGroupCommandsForWire),
                agentConfigured: this.runner.isAgentConfigured(),
                qaiqInstalled: this.runner.isQaiqInstalled(),
                agents: this.runner.listAgents(this.auth.resolveUserLogin(ctx)),
                defaultAgent: this.runner.defaultAgent(this.auth.resolveUserLogin(ctx)),
            };
            client.send(JSON.stringify(snapshot));

            const subscription = this.runner.onDidChangeTask(event => {
                if (client.readyState !== WsClient.OPEN) {
                    return;
                }
                if (!this.auth.ownsWorkspacePath(ctx, event.task.cwd)) {
                    return;
                }
                const msg = event.type === 'output'
                    ? { type: event.type, task: event.task, chunk: event.chunk }
                    : { type: event.type, task: event.task };
                client.send(JSON.stringify(msg));
            });

            const ping = setInterval(() => {
                if (client.readyState === WsClient.OPEN) {
                    client.ping();
                } else {
                    clearInterval(ping);
                }
            }, WS_PING_MS);
            const heartbeat = setInterval(() => {
                if (client.readyState === WsClient.OPEN) {
                    client.send(JSON.stringify({ type: 'heartbeat' }));
                } else {
                    clearInterval(heartbeat);
                }
            }, WS_PING_MS);

            const cleanup = (): void => {
                clearInterval(ping);
                clearInterval(heartbeat);
                subscription.dispose();
            };
            client.on('close', cleanup);
            client.on('error', cleanup);
        });
    }

    protected async handleListAgentModels(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const requestedAgent = typeof req.query.agent === 'string' ? req.query.agent.trim() : '';
        if (!requestedAgent) {
            res.status(400).json({ error: '"agent" query parameter is required.' });
            return;
        }
        // Keep the endpoint tolerant of the mention form used by some hosted composer paths.
        // The native catalogs are keyed by canonical ids (`codex`, `claude`, ...), while a
        // client may send `@codex` or a builtin alias when it drills into the same picker.
        const normalizedAgent = requestedAgent.replace(/^@/, '').trim().toLowerCase();
        // A harness instance (`codex#2`) offers its base harness's catalog; its own switch decides.
        const baseAgent = resolveQaapHarnessBaseId(normalizedAgent);
        const agent = resolveQaapBuiltinAgentMentionId(baseAgent) ?? baseAgent;
        const login = this.auth.resolveUserLogin(ctx);
        // A harness the owner turned off in Settings offers no models, not even its Free ones.
        if (!this.runner.isAgentEnabled(normalizedAgent === baseAgent ? agent : normalizedAgent, login)) {
            res.setHeader('Cache-Control', 'no-store');
            res.json({ agent: requestedAgent, models: [] });
            return;
        }
        const startedAt = Date.now();
        let billingStartedAt = startedAt;
        let billingMs = 0;
        if (this.billingStore && login) {
            // Creating the account is only a side effect here: the picker answers from the native catalog
            // and never reads it. Past the budget the request continues without waiting for the billing store.
            const billingStore = this.billingStore;
            billingStartedAt = Date.now();
            try {
                await this.withinBudget(billingStore.getOrCreateAccount(login), QAAP_AGENT_MODELS_BILLING_BUDGET_MS);
            } catch {
                // Account creation failures are not picker data; the native catalog below still answers.
            }
            billingMs = Date.now() - billingStartedAt;
        }
        // A freshly-created hosted runner can briefly have an empty detected-agent cache even
        // though the native catalog is already available. Keep the read-only picker endpoint
        // useful during that window instead of turning a valid native harness into `models: []`.
        // Give a cold CLI model discovery (`cursor-agent models`) a moment; past the budget the
        // curated catalog answers and the discovered one is cached for the next request.
        const discoveryStartedAt = Date.now();
        // The Antigravity catalog follows the CLI this host resolved (gemini ids or agy's live list).
        const antigravityBin = antigravityBinFor(this.runner, agent);
        // An instance has its own catalog (discovered with its binary and folder); the base answers for itself.
        const isInstance = normalizedAgent !== baseAgent;
        const catalogAgent = isInstance ? normalizedAgent : agent;
        const spawner = isInstance
            ? await this.runner.instanceNativeModelSpawner(normalizedAgent, login)
            : this.runner.nativeModelDiscoverySpawner(login);
        const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
        await this.withinBudget(prepareNativeAgentModels(catalogAgent, {
            ownerLogin: login,
            spawner,
            antigravityBin,
        }), fresh ? QAAP_NATIVE_MODEL_FRESH_DISCOVERY_BUDGET_MS : QAAP_NATIVE_MODEL_DISCOVERY_BUDGET_MS);
        const discoveryMs = Date.now() - discoveryStartedAt;
        if (res.headersSent || res.writableEnded) {
            return;
        }
        const runnerModels = isInstance ? [] : this.runner.listModelsForAgent(agent, login);
        const nativeModels = listNativeAgentModels(catalogAgent, login, antigravityBin);
        const models = runnerModels.length > 0 ? runnerModels : annotateModelsForAgent(this.runner, agent, login, nativeModels);
        res.setHeader('Server-Timing', `billing;dur=${billingMs}, discovery;dur=${discoveryMs}, total;dur=${Date.now() - startedAt}`);
        res.setHeader('Cache-Control', 'no-store');
        res.json({ agent: requestedAgent, models });
    }

    protected async withinBudget(work: Promise<unknown>, budgetMs: number): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
            work.then(() => undefined, () => undefined),
            new Promise<void>(resolve => {
                timer = setTimeout(resolve, budgetMs);
            }),
        ]);
        clearTimeout(timer);
    }

    protected async handleListAll(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
        // `groups` intentionally omitted: the only HTTP consumer reads agents/models and the
        // full task history (with whole prompts in `command`) multiplies into tens of MB per call. Live
        // task groups arrive over the WebSocket snapshot instead.
        const ownerLogin = this.auth.resolveUserLogin(ctx);
        if (refresh) {
            // `agent`: the Connect dialog confirming one harness's sign-in re-probes only that harness.
            const agent = typeof req.query.agent === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(req.query.agent) ? req.query.agent : undefined;
            this.runner.refreshAgentCatalog(ownerLogin, agent);
        }
        // An explicit refresh (the Connect dialog confirming a sign-in) needs the probe's real
        // answer; the regular picker load answers within the short default budget.
        const agents = await (refresh
            ? this.runner.listAgentsFresh(ownerLogin, QAAP_AGENT_CONNECTION_REFRESH_BUDGET_MS)
            : this.runner.listAgentsFresh(ownerLogin));
        if (res.headersSent || res.writableEnded) {
            return;
        }
        res.json({
            agentConfigured: this.runner.isAgentConfigured(),
            qaiqInstalled: this.runner.isQaiqInstalled(),
            agents,
            defaultAgent: this.runner.defaultAgent(ownerLogin),
            qaiqModels: this.runner.listQaiqModels(ownerLogin),
            installSupported: this.cliUpdates.isInstallSupported(),
        } satisfies QaapAgentTaskAllResponse);
    }

    protected handleListHarnessStatuses(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const ownerLogin = this.auth.resolveUserLogin(ctx);
        const installTarget = this.runner.resolveAgentCliInstallTarget(ownerLogin);
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            harnesses: this.runner.listHarnessStatuses(
                ownerLogin,
                agentId => this.cliUpdates.isAgentInstallSupported(agentId, installTarget),
            ).map(harness => ({ ...harness, installPackageAvailable: this.cliUpdates.hasInstallablePackage(resolveQaapHarnessBaseId(harness.id)) })),
            launchOverridesSupported: isQaapHarnessLaunchOverrideRuntime(),
        } satisfies QaapAgentHarnessStatusResponse);
    }

    /**
     * Checks a binary path / configuration folder typed in Settings → Harness. Desktop app only: anywhere
     * else the fields are ignored by the runner and this route answers 404, so it never probes the server's
     * file system for a web user.
     */
    /**
     * Shared gate of the harness-variable routes: authenticated, desktop app only (404 elsewhere, like
     * `/harness-settings/check`), a store bound and a known harness or instance id.
     */
    protected requireHarnessEnvRoute(req: Request, res: Response, rawHarnessId: unknown): { harnessId: string; ownerLogin: string | undefined } | undefined {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return undefined;
        }
        if (!isQaapHarnessLaunchOverrideRuntime() || !this.harnessEnvSecrets) {
            res.status(404).json({ error: 'Harness variables are only available in the desktop app.' });
            return undefined;
        }
        const harnessId = typeof rawHarnessId === 'string' ? rawHarnessId.trim().toLowerCase() : '';
        if (!harnessId || !isQaapHarnessSettingsId(harnessId, QAAP_BUILTIN_AGENT_IDS)) {
            res.status(400).json({ error: 'Unknown harness.' });
            return undefined;
        }
        res.setHeader('Cache-Control', 'no-store');
        return { harnessId, ownerLogin: this.auth.resolveUserLogin(ctx) };
    }

    /** Names and whether a value is stored; never a value. */
    protected async handleListHarnessEnv(req: Request, res: Response): Promise<void> {
        const route = this.requireHarnessEnvRoute(req, res, req.query.harnessId);
        if (!route || !this.harnessEnvSecrets) {
            return;
        }
        const readPref = this.runner.preferenceReaderForOwner(route.ownerLogin);
        const names = readQaapHarnessSettingsFor(readPref(QAAP_HARNESS_SETTINGS_PREF), route.harnessId).envNames ?? [];
        const variables: { name: string; hasValue: boolean }[] = [];
        for (const name of names) {
            variables.push({ name, hasValue: await this.harnessEnvSecrets.has(route.harnessId, name) });
        }
        res.json({ variables });
    }

    protected async handleSetHarnessEnv(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as { harnessId?: unknown; name?: unknown; value?: unknown };
        const route = this.requireHarnessEnvRoute(req, res, body.harnessId);
        if (!route || !this.harnessEnvSecrets) {
            return;
        }
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const issue = checkQaapHarnessEnvName(name);
        if (issue) {
            res.status(400).json({ error: issue === 'denied' ? 'This variable is managed by Qaap and cannot be set.' : 'Invalid variable name.', issue });
            return;
        }
        const value = body.value;
        if (typeof value !== 'string' || value.length === 0 || value.length > QAAP_HARNESS_ENV_VALUE_MAX_LENGTH || value.includes('\0')) {
            res.status(400).json({ error: 'Invalid variable value.' });
            return;
        }
        try {
            await this.harnessEnvSecrets.set(route.harnessId, name, value);
        } catch {
            res.status(500).json({ error: 'The harness variable could not be saved.' });
            return;
        }
        res.json({ ok: true, name, hasValue: true });
    }

    /** Deletes one value (`name`) or every value of the harness (no `name`: Restore defaults, Delete harness). */
    protected async handleDeleteHarnessEnv(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as { harnessId?: unknown; name?: unknown };
        const route = this.requireHarnessEnvRoute(req, res, body.harnessId);
        if (!route || !this.harnessEnvSecrets) {
            return;
        }
        try {
            if (typeof body.name === 'string' && body.name.trim()) {
                await this.harnessEnvSecrets.delete(route.harnessId, body.name.trim());
            } else {
                await this.harnessEnvSecrets.deleteAll(route.harnessId);
            }
        } catch {
            res.status(500).json({ error: 'The harness variable could not be deleted.' });
            return;
        }
        res.json({ ok: true });
    }

    protected handleCheckHarnessLaunchSettings(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        if (!isQaapHarnessLaunchOverrideRuntime()) {
            res.status(404).json({ error: 'Harness binary and configuration folder overrides are only available in the desktop app.' });
            return;
        }
        const body = (req.body ?? {}) as { binaryPath?: unknown; homeDir?: unknown };
        const binaryPath = typeof body.binaryPath === 'string' ? body.binaryPath.trim() : '';
        const homeDir = typeof body.homeDir === 'string' ? body.homeDir.trim() : '';
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            ...(binaryPath ? { binaryPathIssue: checkQaapHarnessBinaryPath(binaryPath) ?? undefined } : {}),
            ...(homeDir ? { homeDirIssue: checkQaapHarnessHomeDir(homeDir) ?? undefined } : {}),
        });
    }

    protected async handleListCliUpdates(req: Request, res: Response): Promise<void> {
        const authContext = this.requireAuth(req, res);
        if (!authContext) {
            return;
        }
        const ownerLogin = this.auth.resolveUserLogin(authContext);
        const installTarget = this.runner.resolveAgentCliInstallTarget(ownerLogin);
        if (!this.cliUpdates.isInstallSupportedForTarget(installTarget)) {
            res.json({ updates: [] });
            return;
        }
        try {
            const payload = await this.cliUpdates.listOutdated(installTarget);
            res.json({
                updates: payload.updates
                    .filter(update => this.runner.isAgentEnabled(update.id, ownerLogin))
                    .map(update => ({
                        ...update,
                        updateSupported: this.cliUpdates.isAgentInstallSupported(update.id, installTarget),
                    })),
            });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    /** 409 while another install for the user runs, 429 when rate limited, 403 for policy refusals, 502 for npm failures. */
    protected cliInstallStatusCode(result: QaapAgentCliUpdateResult): number {
        if (result.ok) {
            return 200;
        }
        switch (result.reason) {
            case 'busy': return 409;
            case 'rate-limited': return 429;
            case 'refused': return 403;
            case 'failed': return 502;
            default: return 400;
        }
    }

    protected async handleInstallCliUpdate(req: Request, res: Response): Promise<void> {
        const authContext = this.requireAuth(req, res);
        if (!authContext) {
            return;
        }
        const agentId = typeof req.params.agentId === 'string' ? req.params.agentId.trim() : '';
        if (!agentId) {
            res.status(400).json({ error: '"agentId" is required.' });
            return;
        }
        const ownerLogin = this.auth.resolveUserLogin(authContext)?.trim();
        // A hosted install always belongs to a signed-in user: their prefix, their lock, their rate limit.
        if (!ownerLogin && isQaapProductionRuntime(process.env)) {
            res.status(403).json({ ok: false, id: agentId, reason: 'refused', message: 'Sign in to install harnesses.' });
            return;
        }
        try {
            const installTarget = this.runner.resolveAgentCliInstallTarget(ownerLogin);
            const result = await this.cliUpdates.installUpdate(agentId, installTarget, { userKey: ownerLogin?.toLowerCase() });
            if (result.ok) {
                this.runner.refreshAgentCatalog(ownerLogin);
            }
            res.status(this.cliInstallStatusCode(result)).json(result);
        } catch (error) {
            res.status(500).json({
                ok: false,
                id: agentId,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * The sign-in dialog saw the CLI's own success line for a harness without an auth probe (Copilot,
     * Grok): remember it for the session owner so the picker unlocks its Pro models. The owner comes
     * only from the authenticated session; the body names the agent and nothing else. See
     * QaapAgentSessionAttestationStore for the threat model and how a false attestation is revoked.
     */
    protected async handleAttestAgentSession(req: Request, res: Response): Promise<void> {
        // Same guard as the other cookie-authenticated mutations (qaap-tenant-update-endpoint.ts): browsers
        // always send Sec-Fetch-Site; a request without it must be JSON, which a cross-site form cannot send.
        const fetchSite = req.headers['sec-fetch-site'];
        if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
            res.status(403).json({ error: 'Cross-site request refused.' });
            return;
        }
        if (fetchSite === undefined && !/^application\/json\s*(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
            res.status(415).json({ error: 'Send the request as application/json.' });
            return;
        }
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const ownerLogin = this.auth.resolveUserLogin(ctx)?.trim();
        if (!ownerLogin && isQaapProductionRuntime(process.env)) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const body = (req.body ?? {}) as { agentId?: unknown };
        const agentId = typeof body.agentId === 'string' ? body.agentId.trim().toLowerCase() : '';
        if (!agentId || !isQaapSessionAttestationAgent(agentId)) {
            res.status(400).json({ error: 'Only harnesses without a sign-in status check accept an attestation.' });
            return;
        }
        if (!this.runner.attestAgentSession(agentId, ownerLogin)) {
            res.status(400).json({ error: 'The sign-in could not be recorded.' });
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ok: true, agentId });
    }

    /**
     * Signs the authenticated owner out of one built-in harness using only the declared strategy in
     * `QAAP_BUILTIN_AGENT_DEFINITIONS`. The owner comes strictly from the session cookie/token.
     */
    protected async handleHarnessSignOut(req: Request, res: Response): Promise<void> {
        const fetchSite = req.headers['sec-fetch-site'];
        if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
            res.status(403).json({ error: 'Cross-site request refused.' });
            return;
        }
        if (fetchSite === undefined && !/^application\/json\s*(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
            res.status(415).json({ error: 'Send the request as application/json.' });
            return;
        }
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const ownerLogin = this.auth.resolveUserLogin(ctx)?.trim();
        if (!ownerLogin && isQaapProductionRuntime(process.env)) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const body = (req.body ?? {}) as { harnessId?: unknown };
        const harnessId = typeof body.harnessId === 'string' ? body.harnessId.trim().toLowerCase() : '';
        if (!harnessId || !isQaapHarnessSettingsId(harnessId, QAAP_BUILTIN_AGENT_IDS)) {
            res.status(400).json({
                ok: false,
                harnessId,
                connectionState: 'unknown',
                reason: 'unsupported',
                error: 'Unknown harness.',
            });
            return;
        }
        if (!this.harnessSignOut) {
            res.status(503).json({
                ok: false,
                harnessId,
                connectionState: 'unknown',
                reason: 'unavailable',
                error: 'Harness sign out is unavailable.',
            });
            return;
        }
        const result = await this.harnessSignOut.signOut(harnessId, ownerLogin);
        res.setHeader('Cache-Control', 'no-store');
        const status = result.ok
            ? 200
            : result.reason === 'unsupported'
                ? 400
                : result.reason === 'unavailable'
                    ? 503
                    : 502;
        res.status(status).json(result);
    }

    protected async handleImprovePrompt(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapImproveComposerPromptRequestBody>;
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
        if (!prompt || !agentId) {
            res.status(400).json({ error: '"prompt" and "agentId" are required.' });
            return;
        }
        let cwd = typeof body.cwd === 'string' ? body.cwd.trim() : undefined;
        if (cwd) {
            const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, cwd);
            if (resolved.kind !== 'ok') {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd });
                return;
            }
            cwd = resolved.cwd;
        }
        try {
            const improved = await this.runner.improveComposerPrompt({
                prompt,
                agentId,
                agentModel: body.agentModel,
                cwd,
                ownerLogin: this.auth.resolveUserLogin(ctx),
            });
            res.json({ improved });
        } catch (error) {
            const timedOut = error instanceof ComposerPromptImproveTimeoutError;
            console.error('[qaap-agent-tasks] Improve prompt failed.', {
                agentId,
                errorType: error instanceof Error ? error.name : typeof error,
                timedOut,
            });
            if (timedOut) {
                res.status(504).json({
                    error: nls.localize('qaap/agentTasks/improvePromptTimeout', 'Prompt improvement timed out. Try again.'),
                    kind: 'timeout',
                });
                return;
            }
            const failure = describeImprovePromptFailure(error, agentId);
            res.status(failure.status).json({ error: failure.error, kind: failure.kind });
        }
    }

    protected handleStorageHealth(req: Request, res: Response): void {
        if (!this.requireAuth(req, res)) {
            return;
        }
        const health = this.runner.storageHealth();
        res.set('Cache-Control', 'no-store');
        res.status(health.ready ? 200 : 503).json(health);
    }

    protected async handleStorageRetry(req: Request, res: Response): Promise<void> {
        if (!this.requireAuth(req, res)) {
            return;
        }
        const health = await this.runner.retryStorage();
        res.set('Cache-Control', 'no-store');
        res.status(health.ready ? 200 : 503).json(health);
    }

    /**
     * Approval policy for a sub-task created through the helper token: never above the parent's.
     * A parent that requires approval (or an unknown / foreign parent) yields `request-approval`;
     * otherwise the child gets the default auto-approve level, never `full-access`.
     */
    protected inheritedHelperApproval(parentId: string | undefined, ownerLogin: string | undefined): Pick<QaapCreateAgentTaskRequest, 'autoApprove' | 'approvalPolicyId'> {
        const parent = parentId ? this.runner.list().find(task => task.id === parentId) : undefined;
        if (parent && parent.ownerLogin === ownerLogin && parent.autoApprove !== false) {
            return { autoApprove: undefined, approvalPolicyId: undefined };
        }
        return { autoApprove: false, approvalPolicyId: 'request-approval' };
    }

    protected async handleCreate(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as Partial<QaapCreateAgentTaskRequest>;
        if (typeof body.cwd !== 'string' || (typeof body.command !== 'string' && typeof body.prompt !== 'string')) {
            res.status(400).json({ error: '"cwd" and one of "command" or "prompt" are required.' });
            return;
        }
        // Two authentication paths:
        //  1. A signed-in browser session (cookie/header) — the normal UI path.
        //  2. The `qaap-task` helper CLI spawned inside an agent, which carries a per-user token
        //     but no session. The token resolves to exactly one owner, so we authenticate as that
        //     owner and scope the sub-task to them. This prevents cross-user task spawning.
        const helperToken = req.header(HELPER_TOKEN_HEADER);
        const helperOwner = helperToken ? this.runner.resolveHelperTokenOwner(helperToken) : undefined;
        const ctx = this.auth.authenticate(req);

        let ownerLogin: string | undefined;
        let parentId: string | undefined;
        // Normalized to the owner's canonical per-user repository path (see resolveOwnedRepositoryCwd).
        let cwd = body.cwd;
        if (ctx.kind === 'authenticated') {
            const resolved = this.cloneRecovery
                ? await this.cloneRecovery.resolveOwnedRepositoryCwd(ctx, body.cwd)
                : this.auth.resolveOwnedRepositoryCwd(ctx, body.cwd);
            if (resolved.kind === 'needs-project') {
                res.status(400).json({ error: 'Select a project first — this path is the workspace container, not a repository.' });
                return;
            }
            if (resolved.kind === 'clone-failed') {
                res.status(422).json({ error: resolved.error, code: QAAP_REPOSITORY_CLONE_UNAVAILABLE_CODE });
                return;
            }
            if (resolved.kind !== 'ok') {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd: body.cwd });
                return;
            }
            cwd = resolved.cwd;
            ownerLogin = ctx.userLogin;
            // Only honor parentId when the helper token belongs to this same user.
            parentId = helperOwner?.ownerLogin === ctx.userLogin ? body.parentId : undefined;
        } else if (ctx.kind === 'skip') {
            // Skip-auth leaves paths unmanaged, but a managed container must still be refused —
            // the resolver's skip branch does exactly that, so route through it instead of
            // trusting `body.cwd` verbatim.
            const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, body.cwd);
            if (resolved.kind === 'needs-project') {
                res.status(400).json({ error: 'Select a project first — this path is the workspace container, not a repository.' });
                return;
            }
            if (resolved.kind !== 'ok') {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd: body.cwd });
                return;
            }
            cwd = resolved.cwd;
            ownerLogin = ctx.userLogin;
            parentId = helperOwner ? body.parentId : undefined;
        } else if (helperOwner) {
            // Helper-CLI callback authenticated purely by its per-user token.
            ownerLogin = helperOwner.ownerLogin;
            const resolved = this.auth.resolveOwnedRepositoryCwdForLogin(ownerLogin, body.cwd);
            if (resolved.kind !== 'ok') {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd: body.cwd });
                return;
            }
            cwd = resolved.cwd;
            parentId = body.parentId;
        } else {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        try {
            if (ownerLogin && this.billingStore) {
                try {
                    await this.billingStore.getOrCreateAccount(ownerLogin);
                } catch {
                    // Peek stays on Starter until the store recovers.
                }
            }
            if (!(typeof body.agent === 'string' && body.agent.trim())) {
                // See QaapAgentTaskRunner.defaultAgentFresh: never default to the keyless agent just
                // because the auth probes of a freshly started backend have not answered yet.
                await this.runner.defaultAgentFresh(ownerLogin);
            }
            // SEC: a sub-task created with the agent helper token runs model-controlled code; it must never
            // choose a more permissive approval policy than its parent. The token maps to the owner only,
            // so the body's autoApprove/approvalPolicyId are ignored and the policy is derived from the
            // parent task (same owner) or, without one, the safest policy (request-approval).
            const approval = helperOwner
                ? this.inheritedHelperApproval(parentId, ownerLogin)
                : { autoApprove: body.autoApprove, approvalPolicyId: body.approvalPolicyId };
            const request: QaapCreateAgentTaskRequest = {
                clientRequestId: typeof body.clientRequestId === 'string' ? body.clientRequestId.trim() : undefined,
                command: body.command,
                prompt: body.prompt,
                agent: body.agent,
                agentModel: body.agentModel ?? body.qaiqModel,
                qaiqModel: body.agentModel ?? body.qaiqModel,
                cwd,
                contextPreamble: body.contextPreamble,
                title: body.title,
                parentId,
                autoApprove: approval.autoApprove,
                interactionModeId: body.interactionModeId,
                effort: QaapAgentEffort.parse(body.effort),
                approvalPolicyId: approval.approvalPolicyId,
                // Part of the request type, so a caller may legitimately send it; this handler
                // builds its argument field by field and was dropping it on the floor, which made
                // the hint look ineffective from outside the process. Validated rather than
                // forwarded raw: the body is untyped JSON, and an unknown value would reach the
                // routing switch and silently take the default branch.
                taskKind: QaapAgentTaskKind.is(body.taskKind) ? body.taskKind : undefined,
                // Same field-by-field hazard as `taskKind` above. Only ever narrows what the turn
                // may do, so honouring it from a caller is safe; dropping it silently is not, since
                // a caller asking for a restricted turn would get an unrestricted one and no word
                // of it. Coerced strictly: anything other than a literal `true` leaves the turn
                // unrestricted rather than guessing from a truthy value.
                readOnlyWorkspace: body.readOnlyWorkspace === true ? true : undefined,
                // Server-only: decided from the conversation's worktree (buildTaskCreateRequest). A client
                // must never claim its own worktree to skip the shared-working-tree queue, so it is never read here.
                ownWorkingTree: undefined,
                // Server-only: decided from the conversation (buildTaskCreateRequest). A client claiming `parent`
                // would ask for the delegation tools; one claiming `child` would skip the shared-tree queue.
                delegationRole: undefined,
            };
            // A failed write blocks every new task until something persists again. Retry once here
            // so a transient failure (for example a temp-file collision) clears on the next user
            // request; if it still fails, create() below answers 503 as before.
            const health = this.runner.storageHealth();
            if (health.writeFailed && health.recovery === 'ready') {
                await this.runner.retryStorage();
            }
            const task = this.runner.create(request, ownerLogin);
            // Only tasks created HERE are standalone: conversation turns call the runner directly
            // and fall back inside the conversation store, so they must never be retried twice.
            this.modelFallback?.track(task, request, ownerLogin);
            res.status(201).json(task);
        } catch (error) {
            const status = error instanceof QaapAgentStorageUnavailableError ? 503 : error instanceof QaapAgentQueueFullError ? 429 : 400;
            res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected async handleDetail(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const detail = await this.runner.detail(req.params.id);
        if (!detail) {
            res.status(404).json({ error: 'Task not found.' });
            return;
        }
        if (!this.auth.ownsWorkspacePath(ctx, detail.cwd)) {
            this.auth.denyForbidden(res, req, 'agent_task', { taskId: req.params.id });
            return;
        }
        res.set('Cache-Control', 'no-store');
        res.json(req.query.verifySnapshot === '1'
            ? { ...detail, workspaceSnapshot: this.runner.checkTaskWorkspaceSnapshot(detail) }
            : detail);
    }

    /**
     * Server-Sent Events feed of task state changes. The cross-project dashboard subscribes here
     * to refresh card status live without polling each project.
     */
    protected handleStream(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        res.status(200).set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            // Disable proxy buffering (nginx) so events flush immediately.
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();
        // Initial comment-line primes the connection on some clients.
        res.write(': qaap-agent-tasks stream\n\n');

        const subscription = this.runner.onDidChangeTask(event => {
            if (!this.auth.ownsWorkspacePath(ctx, event.task.cwd)) {
                return;
            }
            const data = event.type === 'output' ? { ...event.task, chunk: event.chunk } : event.task;
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
        });
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), SSE_HEARTBEAT_MS);

        const cleanup = (): void => {
            clearInterval(heartbeat);
            subscription.dispose();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
    }

    protected requireAuth(req: Request, res: Response): QaapGithubAuthContext | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return ctx;
    }

    protected filterTasks(ctx: QaapGithubAuthContext, tasks: QaapAgentTask[]): QaapAgentTask[] {
        return tasks.filter(task => this.auth.ownsWorkspacePath(ctx, task.cwd));
    }

    protected filterTaskGroups(ctx: QaapGithubAuthContext, groups: QaapAgentTaskCwdGroup[]): QaapAgentTaskCwdGroup[] {
        return groups
            .filter(group => this.auth.ownsWorkspacePath(ctx, group.cwd))
            .map(group => ({
                ...group,
                tasks: group.tasks.filter(task => this.auth.ownsWorkspacePath(ctx, task.cwd)),
            }))
            .filter(group => group.tasks.length > 0);
    }
}
