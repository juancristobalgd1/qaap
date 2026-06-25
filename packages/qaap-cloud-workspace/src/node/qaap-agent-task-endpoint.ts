// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import * as http from 'http';
import * as https from 'https';
import { WebSocketServer, WebSocket as WsClient } from 'ws';
import {
    QAAP_AGENT_TASK_API_PATH,
    type QaapAgentTaskAllResponse,
    type QaapAgentTaskListResponse,
    type QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import type { QaapImproveComposerPromptRequestBody } from '@theia/qaap-mobile-shell/lib/common/qaap-composer-prompt-improve';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import {
    QaapGithubAuthGuard,
    type QaapGithubAuthContext,
} from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import type { QaapAgentTask, QaapAgentTaskCwdGroup } from '../common/qaap-agent-task';

/** Keep SSE connections warm through proxies that idle-kill silent sockets. */
const SSE_HEARTBEAT_MS = 25_000;
/** Ping interval for WebSocket connections — keeps the socket alive through proxies. */
const WS_PING_MS = 25_000;
const WS_PATH = `${QAAP_AGENT_TASK_API_PATH}/ws`;

/** Header carrying the helper-CLI token when an agent calls back to spawn a sub-task. */
const HELPER_TOKEN_HEADER = 'x-qaap-task-token';

/** HTTP surface for the background agent-task runner. */
@injectable()
export class QaapAgentTaskEndpoint implements BackendApplicationContribution {

    @inject(QaapAgentTaskRunner)
    protected readonly runner: QaapAgentTaskRunner;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(`${QAAP_AGENT_TASK_API_PATH}/agent-models`, (req, res) => {
            const agent = typeof req.query.agent === 'string' ? req.query.agent.trim() : '';
            if (!agent) {
                res.status(400).json({ error: '"agent" query parameter is required.' });
                return;
            }
            res.json({ agent, models: this.runner.listModelsForAgent(agent) });
        });
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
                agents: this.runner.listAgents(),
                defaultAgent: this.runner.defaultAgent(),
                qaiqModels: this.runner.listQaiqModels(),
            } satisfies QaapAgentTaskListResponse);
        });
        // Cross-project dashboard feed — `/all` and `/stream` are static segments routed before
        // the `/:id` handler below so they never collide with a task id.
        app.get(`${QAAP_AGENT_TASK_API_PATH}/all`, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            res.json({
                groups: this.filterTaskGroups(ctx, this.runner.listAllGroupedByCwd()),
                agentConfigured: this.runner.isAgentConfigured(),
                agents: this.runner.listAgents(),
                defaultAgent: this.runner.defaultAgent(),
                qaiqModels: this.runner.listQaiqModels(),
            } satisfies QaapAgentTaskAllResponse);
        });
        app.get(`${QAAP_AGENT_TASK_API_PATH}/stream`, (req, res) => {
            this.handleStream(req, res);
        });
        app.post(`${QAAP_AGENT_TASK_API_PATH}/warm`, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            const body = (req.body ?? {}) as { cwd?: unknown };
            const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : '';
            if (!cwd) {
                res.status(400).json({ error: '"cwd" is required.' });
                return;
            }
            if (!this.auth.ownsWorkspacePath(ctx, cwd)) {
                this.auth.denyForbidden(res, req, 'agent_task', { cwd });
                return;
            }
            try {
                res.json(this.runner.warmForCwd(cwd));
            } catch (error) {
                res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
            }
        });
        app.post(`${QAAP_AGENT_TASK_API_PATH}/improve-prompt`, (req, res) => {
            void this.handleImprovePrompt(req, res);
        });
        app.post(QAAP_AGENT_TASK_API_PATH, (req, res) => {
            this.handleCreate(req, res);
        });
        app.get(`${QAAP_AGENT_TASK_API_PATH}/:id`, (req, res) => {
            void this.handleDetail(req, res);
        });
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
                groups: this.filterTaskGroups(ctx, this.runner.listAllGroupedByCwd()),
                agentConfigured: this.runner.isAgentConfigured(),
                agents: this.runner.listAgents(),
                defaultAgent: this.runner.defaultAgent(),
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

            const cleanup = (): void => {
                clearInterval(ping);
                subscription.dispose();
            };
            client.on('close', cleanup);
            client.on('error', cleanup);
        });
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
        const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : undefined;
        if (cwd && !this.auth.ownsWorkspacePath(ctx, cwd)) {
            this.auth.denyForbidden(res, req, 'agent_task', { cwd });
            return;
        }
        try {
            const improved = await this.runner.improveComposerPrompt({
                prompt,
                agentId,
                agentModel: body.agentModel,
                cwd,
            });
            res.json({ improved });
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected handleCreate(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapCreateAgentTaskRequest>;
        if (typeof body.cwd !== 'string' || (typeof body.command !== 'string' && typeof body.prompt !== 'string')) {
            res.status(400).json({ error: '"cwd" and one of "command" or "prompt" are required.' });
            return;
        }
        if (!this.auth.ownsWorkspacePath(ctx, body.cwd)) {
            this.auth.denyForbidden(res, req, 'agent_task', { cwd: body.cwd });
            return;
        }
        // Helper-CLI calls authenticate via the shared token header; ignore parentId from regular UI calls.
        const helperToken = req.header(HELPER_TOKEN_HEADER);
        const parentId = helperToken && this.runner.verifyHelperToken(helperToken)
            ? body.parentId
            : undefined;
        try {
            const task = this.runner.create({
                command: body.command,
                prompt: body.prompt,
                agent: body.agent,
                agentModel: body.agentModel ?? body.qaiqModel,
                qaiqModel: body.agentModel ?? body.qaiqModel,
                cwd: body.cwd,
                contextPreamble: body.contextPreamble,
                title: body.title,
                parentId,
                autoApprove: body.autoApprove,
                interactionModeId: body.interactionModeId,
                approvalPolicyId: body.approvalPolicyId,
            });
            res.status(201).json(task);
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
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
        res.json(detail);
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
