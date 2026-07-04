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
    QAAP_AGENT_CONVERSATION_API_PATH,
    QaapAgentConversationAllResponse,
    QaapAgentConversationListResponse,
    QaapCreateAgentConversationRequest,
    QaapPostAgentMessageRequest,
    QaapPostAgUiTranscriptEventRequest,
    QaapPostPreviewBootstrapFailureRequest,
    QaapUpdateAgentConversationRequest,
} from '../common/qaap-agent-conversation';
import {
    QAAP_AGENT_CONVERSATION_WS_PATH,
    parseQaapAgentConversationWsClientMessage,
} from '../common/qaap-agent-conversation-ws';
import type { QaapAgentApprovalPolicyId } from '@theia/qaap-mobile-shell/lib/common/qaap-sticky-composer-approval-policy';
import type { QaapAgUiEvent } from '@theia/qaap-mobile-shell/lib/common/qaap-ag-ui-transcript-adapter';
import type { QaapAgentToolApprovalRules } from '../common/qaap-agent-conversation';
import { resolveEffectiveToolApprovalRules } from '../common/qaap-agent-approval-flags';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapConversationWorktreeService } from './qaap-conversation-worktree';
import {
    QaapGithubAuthGuard,
    type QaapGithubAuthContext,
} from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import type { QaapAgentConversation, QaapAgentConversationCwdGroup, QaapAgentConversationEvent } from '../common/qaap-agent-conversation';

const SSE_HEARTBEAT_MS = 25_000;
/** Ping interval for WebSocket connections — keeps the socket alive through proxies. */
const WS_PING_MS = 25_000;
/** Negotiate permessage-deflate so large tool-result JSON frames shrink on the wire. */
const WS_PER_MESSAGE_DEFLATE = {
    zlibDeflateOptions: { level: 6 },
    zlibInflateOptions: { chunkSize: 16 * 1024 },
    threshold: 1024,
};

/** HTTP surface for the persistent agent-conversation store. */
@injectable()
export class QaapAgentConversationEndpoint implements BackendApplicationContribution {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapConversationWorktreeService)
    protected readonly worktrees: QaapConversationWorktreeService;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        // List for one cwd (or all).
        app.get(QAAP_AGENT_CONVERSATION_API_PATH, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            const cwd = typeof req.query.cwd === 'string' ? req.query.cwd : undefined;
            if (cwd && !this.auth.ownsWorkspacePath(ctx, cwd)) {
                this.auth.denyForbidden(res, req, 'agent_conversation', { cwd });
                return;
            }
            const conversations = this.store.list(cwd).filter(summary => this.auth.ownsWorkspacePath(ctx, summary.cwd));
            res.json({ conversations } satisfies QaapAgentConversationListResponse);
        });
        // Cross-project dashboard feed — static segments before the `:id` handler.
        app.get(`${QAAP_AGENT_CONVERSATION_API_PATH}/all`, (req, res) => {
            const ctx = this.requireAuth(req, res);
            if (!ctx) {
                return;
            }
            res.json({
                groups: this.filterGroups(ctx, this.store.listAllGroupedByCwd()),
            } satisfies QaapAgentConversationAllResponse);
        });
        app.get(`${QAAP_AGENT_CONVERSATION_API_PATH}/stream`, (req, res) => {
            this.handleStream(req, res);
        });
        app.post(QAAP_AGENT_CONVERSATION_API_PATH, (req, res) => {
            void this.handleCreate(req, res);
        });
        app.get(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id`, (req, res) => {
            const conv = this.getConversationIfOwned(req, res, req.params.id);
            if (!conv) {
                return;
            }
            res.json(conv);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/messages`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            this.handlePostMessage(req, res);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/ag-ui/events`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            this.handlePostAgUiEvent(req, res);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/preview-bootstrap-failure`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            this.handlePostPreviewBootstrapFailure(req, res);
        });
        app.patch(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            this.handleUpdate(req, res);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/fork`, (req, res) => {
            const conv = this.getConversationIfOwned(req, res, req.params.id);
            if (!conv) {
                return;
            }
            const forked = this.store.fork(req.params.id);
            if (!forked) {
                res.status(404).json({ error: 'Conversation not found.' });
                return;
            }
            res.status(201).json(forked);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/cancel`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            const conv = this.store.cancel(req.params.id);
            if (!conv) {
                res.status(404).json({ error: 'Conversation not found.' });
                return;
            }
            res.json(conv);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/retry`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            try {
                const conv = this.store.retry(req.params.id);
                res.json(conv);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const status = message.includes('not found') ? 404 : 400;
                res.status(status).json({ error: message });
            }
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/checkpoints/:checkpointId/restore`, (req, res) => {
            void (async () => {
                if (!this.getConversationIfOwned(req, res, req.params.id)) {
                    return;
                }
                try {
                    const conv = await this.store.restoreCheckpoint(req.params.id, req.params.checkpointId);
                    if (!conv) {
                        res.status(404).json({ error: 'Conversation not found.' });
                        return;
                    }
                    res.json(conv);
                } catch (error) {
                    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
                }
            })();
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/messages/:messageId/rewind`, (req, res) => {
            void (async () => {
                if (!this.getConversationIfOwned(req, res, req.params.id)) {
                    return;
                }
                try {
                    const conv = await this.store.rewindToMessage(req.params.id, req.params.messageId);
                    if (!conv) {
                        res.status(404).json({ error: 'Conversation not found.' });
                        return;
                    }
                    res.json(conv);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const status = message === 'Message not found.' ? 404 : 400;
                    res.status(status).json({ error: message });
                }
            })();
        });
        app.delete(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            const ok = this.store.delete(req.params.id);
            res.status(ok ? 204 : 404).end();
        });
    }

    onStart(server: http.Server | https.Server): void {
        this.attachWebSocketServer(server);
    }

    /**
     * Bidirectional WebSocket at {@link QAAP_AGENT_CONVERSATION_WS_PATH}. The server sends a
     * `snapshot` on connect (equivalent to GET `/all`) and then streams the same
     * {@link QaapAgentConversationEvent} payloads as SSE. Clients may send `cancel` for
     * instant turn interruption without an extra HTTP round-trip.
     */
    protected attachWebSocketServer(server: http.Server | https.Server): void {
        const wss = new WebSocketServer({ noServer: true, perMessageDeflate: WS_PER_MESSAGE_DEFLATE });

        server.on('upgrade', (request, socket, head) => {
            try {
                const pathname = new URL(request.url ?? '', `http://${request.headers.host}`).pathname;
                if (pathname === QAAP_AGENT_CONVERSATION_WS_PATH) {
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
                groups: this.filterGroups(ctx, this.store.listAllGroupedByCwd()),
            };
            client.send(JSON.stringify(snapshot));

            const subscription = this.store.onDidChange(event => {
                if (client.readyState !== WsClient.OPEN) {
                    return;
                }
                if (!this.eventIsOwned(ctx, event)) {
                    return;
                }
                client.send(JSON.stringify(event));
            });

            client.on('message', data => {
                try {
                    const parsed = parseQaapAgentConversationWsClientMessage(JSON.parse(String(data)));
                    if (!parsed) {
                        return;
                    }
                    if (parsed.op === 'cancel') {
                        const conv = this.store.get(parsed.conversationId);
                        if (conv && this.auth.ownsWorkspacePath(ctx, conv.cwd)) {
                            this.store.cancel(parsed.conversationId);
                        }
                        return;
                    }
                    if (parsed.op === 'ping' && client.readyState === WsClient.OPEN) {
                        client.send(JSON.stringify({ type: 'pong' }));
                    }
                } catch {
                    /* drop malformed client frames */
                }
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

    protected async handleCreate(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapCreateAgentConversationRequest>;
        if (typeof body.cwd !== 'string' || !body.cwd) {
            res.status(400).json({ error: '"cwd" is required.' });
            return;
        }
        if (!this.auth.ownsWorkspacePath(ctx, body.cwd)) {
            this.auth.denyForbidden(res, req, 'agent_conversation', { cwd: body.cwd });
            return;
        }
        if (this.auth.isWorkspaceContainerPath(ctx, body.cwd)) {
            // Defense in depth for the "no project selected → workspace root"
            // client bug: a container cwd would hand the agent every repo at
            // once (wrong scope, massive LLM context). The client must send a
            // repository path.
            res.status(400).json({ error: 'Select a project first — this path is the workspace container, not a repository.' });
            return;
        }
        try {
            // "New Worktree" destination: run the conversation in an isolated git worktree,
            // grouped under the originating repository via parallelBaseCwd.
            let cwd = body.cwd;
            let baseCwd: string | undefined;
            let worktreeBranch: string | undefined;
            if (body.worktree === true) {
                const worktreeOwnerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
                const worktree = await this.worktrees.create(body.cwd, worktreeOwnerLogin);
                baseCwd = body.cwd;
                cwd = worktree.worktreePath;
                worktreeBranch = worktree.branch;
            }
            const approvalPolicyId = typeof body.approvalPolicyId === 'string' ? body.approvalPolicyId.trim() : undefined;
            const toolApprovalRules = parseRequestToolApprovalRules(body.toolApprovalRules, approvalPolicyId);
            const ownerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
            const conv = this.store.create({
                cwd,
                ...(baseCwd ? { parallelBaseCwd: baseCwd } : {}),
                ...(worktreeBranch ? { worktreeBranch } : {}),
                agent: body.agent,
                title: body.title,
                message: body.message,
                agentModel: body.agentModel ?? body.qaiqModel,
                qaiqModel: body.agentModel ?? body.qaiqModel,
                autoApprove: body.autoApprove,
                contextPreamble: body.contextPreamble,
                interactionModeId: body.interactionModeId,
                approvalPolicyId,
                ...(toolApprovalRules ? { toolApprovalRules } : {}),
            }, ownerLogin);
            res.status(201).json(conv);
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected handlePostMessage(req: Request, res: Response): void {
        const body = (req.body ?? {}) as Partial<QaapPostAgentMessageRequest>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) {
            res.status(400).json({ error: '"content" must be a non-empty string.' });
            return;
        }
        const agent = typeof body.agent === 'string' ? body.agent.trim() : undefined;
        const agentModel = body.agentModel ?? body.qaiqModel;
        try {
            const autoApprove = typeof body.autoApprove === 'boolean' ? body.autoApprove : undefined;
            const interactionModeId = typeof body.interactionModeId === 'string' ? body.interactionModeId.trim() : undefined;
            const approvalPolicyId = typeof body.approvalPolicyId === 'string' ? body.approvalPolicyId.trim() : undefined;
            const toolApprovalRules = parseRequestToolApprovalRules(body.toolApprovalRules, approvalPolicyId);
            const conv = this.store.postUserMessage(
                req.params.id,
                content,
                agent || undefined,
                agentModel,
                autoApprove,
                interactionModeId,
                approvalPolicyId,
                toolApprovalRules,
            );
            res.status(202).json(conv);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(message === 'Conversation not found.' ? 404 : 400).json({ error: message });
        }
    }

    protected handlePostAgUiEvent(req: Request, res: Response): void {
        const body = (req.body ?? {}) as Partial<QaapPostAgUiTranscriptEventRequest>;
        const event = body.event;
        if (!event || typeof event !== 'object' || typeof (event as { type?: unknown }).type !== 'string') {
            res.status(400).json({ error: '"event" must be an AG-UI event object with a string "type".' });
            return;
        }
        const conv = this.store.applyAgUiTranscriptEvent(req.params.id, event as QaapAgUiEvent);
        if (!conv) {
            res.status(404).json({ error: 'Conversation not found.' });
            return;
        }
        res.status(202).json({ ok: true, conversationId: conv.id, status: conv.status });
    }

    protected handlePostPreviewBootstrapFailure(req: Request, res: Response): void {
        const body = (req.body ?? {}) as Partial<QaapPostPreviewBootstrapFailureRequest>;
        const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
        if (!reason) {
            res.status(400).json({ error: '"reason" must be a non-empty string.' });
            return;
        }
        const conv = this.store.reportPreviewBootstrapFailure(req.params.id, reason);
        if (!conv) {
            res.status(404).json({ error: 'Conversation not found or preview failure cannot be recorded yet.' });
            return;
        }
        res.json(conv);
    }

    protected handleUpdate(req: Request, res: Response): void {
        const body = (req.body ?? {}) as Partial<QaapUpdateAgentConversationRequest>;
        const patch: { -readonly [K in keyof QaapUpdateAgentConversationRequest]: QaapUpdateAgentConversationRequest[K] } = {};
        if (typeof body.title === 'string') {
            const title = body.title.trim();
            if (!title) {
                res.status(400).json({ error: '"title" must be a non-empty string.' });
                return;
            }
            patch.title = title;
        }
        if (typeof body.priority === 'boolean') {
            patch.priority = body.priority;
        }
        if (typeof body.paused === 'boolean') {
            patch.paused = body.paused;
        }
        if (typeof body.autoApprove === 'boolean') {
            patch.autoApprove = body.autoApprove;
        }
        if (typeof body.agent === 'string' && body.agent.trim()) {
            patch.agent = body.agent.trim();
        }
        const agentModel = body.agentModel ?? body.qaiqModel;
        if (agentModel && typeof agentModel === 'object' && typeof agentModel.modelId === 'string') {
            patch.agentModel = agentModel;
        }
        if (typeof body.interactionModeId === 'string') {
            patch.interactionModeId = body.interactionModeId;
        }
        if (typeof body.approvalPolicyId === 'string') {
            patch.approvalPolicyId = body.approvalPolicyId;
        }
        if (body.toolApprovalRules && typeof body.toolApprovalRules === 'object') {
            const approvalPolicyId = typeof body.approvalPolicyId === 'string'
                ? body.approvalPolicyId.trim()
                : undefined;
            patch.toolApprovalRules = parseRequestToolApprovalRules(body.toolApprovalRules, approvalPolicyId);
        }
        if (body.linkedPullRequest !== undefined) {
            patch.linkedPullRequest = body.linkedPullRequest;
        }
        if (Object.keys(patch).length === 0) {
            res.status(400).json({ error: 'No mutable fields supplied.' });
            return;
        }
        const conv = this.store.update(req.params.id, patch);
        if (!conv) {
            res.status(404).json({ error: 'Conversation not found.' });
            return;
        }
        res.json(conv);
    }

    /** SSE feed of conversation events used by every connected client for live updates. */
    protected handleStream(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        res.status(200).set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();
        res.write(': qaap-agent-conversations stream\n\n');

        const subscription = this.store.onDidChange(event => {
            if (!this.eventIsOwned(ctx, event)) {
                return;
            }
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
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

    protected getConversationIfOwned(req: Request, res: Response, conversationId: string): QaapAgentConversation | undefined {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return undefined;
        }
        const conv = this.store.get(conversationId);
        if (!conv) {
            res.status(404).json({ error: 'Conversation not found.' });
            return undefined;
        }
        if (!this.auth.ownsWorkspacePath(ctx, conv.cwd)) {
            this.auth.denyForbidden(res, req, 'agent_conversation', { conversationId });
            return undefined;
        }
        return conv;
    }

    protected filterGroups(ctx: QaapGithubAuthContext, groups: QaapAgentConversationCwdGroup[]): QaapAgentConversationCwdGroup[] {
        return groups
            .filter(group => this.auth.ownsWorkspacePath(ctx, group.cwd))
            .map(group => ({
                ...group,
                conversations: group.conversations.filter(summary => this.auth.ownsWorkspacePath(ctx, summary.cwd)),
            }))
            .filter(group => group.conversations.length > 0);
    }

    protected eventIsOwned(ctx: QaapGithubAuthContext, event: QaapAgentConversationEvent): boolean {
        if (event.type === 'created' || event.type === 'updated') {
            return this.auth.ownsWorkspacePath(ctx, event.conversation.cwd);
        }
        if (event.type === 'deleted' || event.type === 'message' || event.type === 'message_delta') {
            return this.auth.ownsWorkspacePath(ctx, event.cwd);
        }
        // 'parallel-run' events don't carry a cwd — broadcast to all.
        return true;
    }
}

function parseRequestToolApprovalRules(
    body: unknown,
    approvalPolicyId: string | undefined,
): QaapAgentToolApprovalRules | undefined {
    if (!body || typeof body !== 'object') {
        return undefined;
    }
    const rules = body as { shell?: unknown; network?: unknown };
    const policy = isAgentApprovalPolicyId(approvalPolicyId) ? approvalPolicyId : undefined;
    return resolveEffectiveToolApprovalRules(policy, {
        shell: rules.shell === true ? true : rules.shell === false ? false : undefined,
        network: rules.network === true ? true : rules.network === false ? false : undefined,
    });
}

function isAgentApprovalPolicyId(value: string | undefined): value is QaapAgentApprovalPolicyId {
    return value === 'request-approval' || value === 'approve-for-me' || value === 'full-access';
}
