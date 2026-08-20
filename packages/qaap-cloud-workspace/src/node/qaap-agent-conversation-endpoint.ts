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
import {
    QAAP_AGENT_CONVERSATION_API_PATH,
    QAAP_DEFAULT_DELIVERY_MODE,
    QaapAgentConversationAllResponse,
    QaapAgentConversationListResponse,
    QaapApplyConversationWorktreeRequest,
    QaapApplyConversationWorktreeResponse,
    QaapCreateAgentConversationRequest,
    QaapMessageDeliveryMode,
    QaapPostAgentMessageRequest,
    QaapPostAgUiTranscriptEventRequest,
    QaapPostPreviewBootstrapFailureRequest,
    QaapUpdateAgentConversationRequest,
    QaapWorktreeApplyAction,
} from '../common/qaap-agent-conversation';
import {
    QAAP_AGENT_CONVERSATION_WS_PATH,
    parseQaapAgentConversationWsClientMessage,
} from '../common/qaap-agent-conversation-ws';
import type { QaapAgentApprovalPolicyId } from '@theia/qaap-mobile-shell/lib/common/qaap-sticky-composer-approval-policy';
import type { QaapAgUiEvent } from '@theia/qaap-mobile-shell/lib/common/qaap-ag-ui-transcript-adapter';
import type { QaapTurnLatencyMark } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import type { QaapAgentToolApprovalRules } from '../common/qaap-agent-conversation';
import { resolveEffectiveToolApprovalRules } from '../common/qaap-agent-approval-flags';
import { QaapAgentConversationStore, QaapMaxConcurrentRunsError } from './qaap-agent-conversation-store';
import { QaapBillingStore } from './qaap-billing-store';
import { QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION } from './qaap-agent-conversation-store-constants';
import { QaapConversationWorktreeService } from './qaap-conversation-worktree';
import {
    QaapGithubAuthGuard,
    type QaapGithubAuthContext,
} from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import type { QaapAgentConversation, QaapAgentConversationCwdGroup, QaapAgentConversationEvent } from '../common/qaap-agent-conversation';
import {
    normalizeQaapVisualPreviewUrl,
    type QaapPreviewVisualValidationResult,
} from '@theia/qaap-mobile-shell/lib/common/qaap-visual-verification';

const SSE_HEARTBEAT_MS = 25_000;
const VISUAL_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
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

    @inject(QaapBillingStore) @optional()
    protected readonly billingStore: QaapBillingStore | undefined;

    /**
     * Idempotency guard for conversation creation: `${ownerLogin}:${clientRequestId}` → the id of the
     * conversation that request already created. A create POST can take >60s under load; the client
     * gives up (its bounded submit times out) but the backend still creates the conversation, and a
     * user retry would spawn a DUPLICATE. When the retry carries the same client-generated
     * `clientRequestId`, we return the already-created conversation instead of making another. Bounded
     * to the newest {@link CLIENT_REQUEST_DEDUP_MAX} entries so it can never grow without limit.
     */
    protected readonly clientRequestDedup = new Map<string, string>();
    /** Dedup keys whose create is in progress (reserved before the first await) to block a concurrent fan-out. */
    protected readonly clientRequestInFlight = new Set<string>();
    protected static readonly CLIENT_REQUEST_DEDUP_MAX = 512;

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
            const groups = this.filterGroups(ctx, this.store.listAllGroupedByCwd());
            if (req.query.peek === '1') {
                // Existence/count probe (onboarding guards) — skips serializing the full
                // conversation summaries (~340KB) just to answer a boolean.
                res.json({
                    groups: groups.map(group => ({
                        cwd: group.cwd,
                        streamingCount: group.streamingCount,
                        conversationCount: group.conversations.length,
                    })),
                });
                return;
            }
            res.json({
                groups,
            } satisfies QaapAgentConversationAllResponse);
        });
        app.get(`${QAAP_AGENT_CONVERSATION_API_PATH}/stream`, (req, res) => {
            this.handleStream(req, res);
        });
        app.post(QAAP_AGENT_CONVERSATION_API_PATH, (req, res) => {
            void this.handleCreate(req, res);
        });
        app.get(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/visual-verifications/:evidenceId`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            const file = this.store.resolveVisualVerificationFile(req.params.id, req.params.evidenceId);
            if (!file) {
                res.sendStatus(404);
                return;
            }
            // Evidence files are immutable per id; res.sendFile handles Range requests, which
            // Safari requires before it will play <video> sources at all.
            res.set({
                'Cache-Control': 'private, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff',
                'Content-Type': file.contentType,
            });
            res.sendFile(file.path, { acceptRanges: true }, error => {
                if (error && !res.headersSent) {
                    res.sendStatus(404);
                }
            });
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
            void this.handlePostMessage(req, res);
        });
        app.delete(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/queued-messages/:queuedMessageId`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            this.handleCancelQueuedMessage(req, res);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/queued-messages/:queuedMessageId/dispatch`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            void this.handleDispatchQueuedMessage(req, res);
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
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/visual-verifications`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            void this.handlePostVisualVerification(req, res);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/visual-verification-failures`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            void this.handlePostVisualVerificationFailure(req, res);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/git-actions`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            this.handlePostGitAction(req, res);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/visual-evidence-images`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            void this.handlePostVisualEvidenceImage(req, res);
        });
        app.patch(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id`, (req, res) => {
            if (!this.getConversationIfOwned(req, res, req.params.id)) {
                return;
            }
            this.handleUpdate(req, res);
        });
        app.post(`${QAAP_AGENT_CONVERSATION_API_PATH}/:id/worktree/apply`, (req, res) => {
            void this.handleApplyWorktree(req, res);
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
            // `userMessageId` narrows the cancel to ONE run of a multitasking session; without
            // it Stop stays session-wide (every live run), which is what the composer Stop does.
            const body = (req.body ?? {}) as { userMessageId?: unknown };
            const userMessageId = typeof body.userMessageId === 'string' ? body.userMessageId.trim() : '';
            const conv = userMessageId
                ? this.store.cancelRun(req.params.id, userMessageId)
                : this.store.cancel(req.params.id);
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
                    // App-level heartbeat: browser JS never sees WS protocol pings, so also send a
                    // visible frame the client can use to keep its transport-liveness clock fresh
                    // while the model is slow to produce its first token.
                    client.send(JSON.stringify({ type: 'heartbeat' }));
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
        // Normalize the client-supplied cwd to the caller's canonical per-user repository path.
        // Legacy/flat, bare-name, and container-root cwds are resolved (or rejected) here so the
        // agent always runs under `/workspace/repos/users/{login}/{owner}/{repo}` in production.
        const resolvedCwd = this.auth.resolveOwnedRepositoryCwd(ctx, body.cwd);
        if (resolvedCwd.kind === 'needs-project') {
            // A container cwd would hand the agent every repo at once (wrong scope, massive LLM
            // context). The client must send a repository path.
            res.status(400).json({ error: 'Select a project first — this path is the workspace container, not a repository.' });
            return;
        }
        if (resolvedCwd.kind !== 'ok') {
            this.auth.denyForbidden(res, req, 'agent_conversation', { cwd: body.cwd });
            return;
        }
        const ownerLogin = this.auth.resolveUserLogin(ctx);
        // Idempotency: if this exact client submit (same clientRequestId) already produced a
        // conversation, return it instead of creating a duplicate + a second worktree/task.
        const clientRequestId = typeof (req.body as { clientRequestId?: unknown }).clientRequestId === 'string'
            ? (req.body as { clientRequestId: string }).clientRequestId.trim()
            : undefined;
        const dedupKey = clientRequestId ? `${ownerLogin ?? '_'}:${clientRequestId}` : undefined;
        if (dedupKey) {
            const priorId = this.clientRequestDedup.get(dedupKey);
            const prior = priorId ? this.store.get(priorId) : undefined;
            if (prior) {
                res.status(201).json(prior);
                return;
            }
            // Reserve the key SYNCHRONOUSLY, before the first await (worktree.create / store.create).
            // Otherwise two concurrent requests with the same key both see the map empty and each
            // creates a worktree + conversation (fan-out). A concurrent duplicate is told the create is
            // already in progress rather than spawning a second one.
            if (this.clientRequestInFlight.has(dedupKey)) {
                res.status(409).json({ error: 'A conversation for this request is already being created.' });
                return;
            }
            this.clientRequestInFlight.add(dedupKey);
        }
        try {
            // "New Worktree" destination: run the conversation in an isolated git worktree,
            // grouped under the originating repository via parallelBaseCwd.
            let cwd = resolvedCwd.cwd;
            let baseCwd: string | undefined;
            let worktreeBranch: string | undefined;
            if (body.worktree === true) {
                const worktreeOwnerLogin = this.auth.resolveUserLogin(ctx);
                const worktree = await this.worktrees.create(cwd, worktreeOwnerLogin);
                baseCwd = cwd;
                cwd = worktree.worktreePath;
                worktreeBranch = worktree.branch;
            }
            const approvalPolicyId = typeof body.approvalPolicyId === 'string' ? body.approvalPolicyId.trim() : undefined;
            const toolApprovalRules = parseRequestToolApprovalRules(body.toolApprovalRules, approvalPolicyId);
            await this.warmBilling(ownerLogin);
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
                latencyMarks: sanitizeLatencyMarks(body.latencyMarks),
            }, ownerLogin);
            if (dedupKey) {
                this.rememberClientRequest(dedupKey, conv.id);
            }
            res.status(201).json(conv);
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        } finally {
            if (dedupKey) {
                this.clientRequestInFlight.delete(dedupKey);
            }
        }
    }

    /** Record a client request → conversation mapping, evicting the oldest entry past the cap. */
    protected rememberClientRequest(dedupKey: string, conversationId: string): void {
        this.clientRequestDedup.set(dedupKey, conversationId);
        while (this.clientRequestDedup.size > QaapAgentConversationEndpoint.CLIENT_REQUEST_DEDUP_MAX) {
            const oldest = this.clientRequestDedup.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.clientRequestDedup.delete(oldest);
        }
    }

    protected conversationHasLiveRun(conversationId: string, conv: QaapAgentConversation): boolean {
        return conv.status === 'streaming' && this.store.getActiveTaskIdsForConversation(conversationId).length > 0;
    }

    /**
     * Delivery mode `'parallel'`: new conversation in an isolated git worktree. The parent
     * turn is left running. If isolation is unavailable (cap, not a git repo), queue on the parent.
     */
    protected async spawnIsolatedParallelConversation(
        parent: QaapAgentConversation,
        input: {
            readonly content: string;
            readonly agent?: string;
            readonly agentModel?: QaapPostAgentMessageRequest['agentModel'];
            readonly autoApprove?: boolean;
            readonly interactionModeId?: string;
            readonly approvalPolicyId?: string;
            readonly toolApprovalRules?: QaapAgentToolApprovalRules;
            readonly latencyMarks?: QaapPostAgentMessageRequest['latencyMarks'];
            readonly clientMessageId?: string;
        },
    ): Promise<QaapAgentConversation> {
        const dedupKey = input.clientMessageId
            ? `${parent.ownerLogin ?? '_'}:parallel:${parent.id}:${input.clientMessageId}`
            : undefined;
        if (dedupKey) {
            const priorId = this.clientRequestDedup.get(dedupKey);
            const prior = priorId ? this.store.get(priorId) : undefined;
            if (prior) {
                return prior;
            }
        }
        const queueOnParent = (): QaapAgentConversation => this.store.postUserMessage(
            parent.id,
            input.content,
            input.agent,
            input.agentModel,
            input.autoApprove,
            input.interactionModeId,
            input.approvalPolicyId,
            input.toolApprovalRules,
            sanitizeLatencyMarks(input.latencyMarks),
            input.clientMessageId ? { clientMessageId: input.clientMessageId } : undefined,
            'queue',
        );
        if (this.store.countStreamingForks(parent.id) >= QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION) {
            return queueOnParent();
        }
        try {
            const worktree = await this.worktrees.create(parent.cwd, parent.ownerLogin);
            const spawned = this.store.create({
                cwd: worktree.worktreePath,
                parallelBaseCwd: parent.parallelBaseCwd ?? parent.cwd,
                worktreeBranch: worktree.branch,
                forkedFromId: parent.id,
                agent: input.agent || parent.agentId,
                title: input.content,
                message: input.content,
                agentModel: input.agentModel ?? parent.agentModel,
                qaiqModel: input.agentModel ?? parent.qaiqModel,
                autoApprove: input.autoApprove,
                interactionModeId: input.interactionModeId ?? parent.interactionModeId,
                approvalPolicyId: input.approvalPolicyId ?? parent.approvalPolicyId,
                ...(input.toolApprovalRules ?? parent.toolApprovalRules
                    ? { toolApprovalRules: input.toolApprovalRules ?? parent.toolApprovalRules }
                    : {}),
                latencyMarks: sanitizeLatencyMarks(input.latencyMarks),
            }, parent.ownerLogin);
            if (dedupKey) {
                this.rememberClientRequest(dedupKey, spawned.id);
            }
            return spawned;
        } catch {
            return queueOnParent();
        }
    }

    protected async handlePostMessage(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as Partial<QaapPostAgentMessageRequest>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) {
            res.status(400).json({ error: '"content" must be a non-empty string.' });
            return;
        }
        const agent = typeof body.agent === 'string' ? body.agent.trim() : undefined;
        const agentModel = body.agentModel ?? body.qaiqModel;
        const rawClientMessageId = typeof body.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
        const clientMessageId = /^[A-Za-z0-9._:-]{1,160}$/.test(rawClientMessageId)
            ? rawClientMessageId
            : undefined;
        try {
            const autoApprove = typeof body.autoApprove === 'boolean' ? body.autoApprove : undefined;
            const interactionModeId = typeof body.interactionModeId === 'string' ? body.interactionModeId.trim() : undefined;
            const approvalPolicyId = typeof body.approvalPolicyId === 'string' ? body.approvalPolicyId.trim() : undefined;
            const toolApprovalRules = parseRequestToolApprovalRules(body.toolApprovalRules, approvalPolicyId);
            const deliveryMode: QaapMessageDeliveryMode =
                body.deliveryMode === 'queue' || body.deliveryMode === 'parallel' || body.deliveryMode === 'interrupt'
                    ? body.deliveryMode
                    : QAAP_DEFAULT_DELIVERY_MODE;
            const parent = this.store.get(req.params.id);
            const ctx = this.auth.authenticate(req);
            await this.warmBilling(this.auth.resolveUserLogin(ctx) ?? parent?.ownerLogin);
            if (deliveryMode === 'parallel' && parent && this.conversationHasLiveRun(req.params.id, parent)) {
                const spawned = await this.spawnIsolatedParallelConversation(parent, {
                    content,
                    agent: agent || undefined,
                    agentModel,
                    autoApprove,
                    interactionModeId,
                    approvalPolicyId,
                    toolApprovalRules,
                    latencyMarks: body.latencyMarks,
                    clientMessageId,
                });
                res.status(202).json(spawned);
                return;
            }
            const conv = this.store.postUserMessage(
                req.params.id,
                content,
                agent || undefined,
                agentModel,
                autoApprove,
                interactionModeId,
                approvalPolicyId,
                toolApprovalRules,
                sanitizeLatencyMarks(body.latencyMarks),
                clientMessageId ? { clientMessageId } : undefined,
                deliveryMode,
            );
            res.status(202).json(conv);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof QaapMaxConcurrentRunsError) {
                // Not a failed send: the session is already running the maximum number of agents,
                // so the client queues the message instead of reporting an error to the user.
                res.status(429).json({ error: message, code: error.code });
                return;
            }
            res.status(message === 'Conversation not found.' ? 404 : 400).json({ error: message });
        }
    }

    protected handleCancelQueuedMessage(req: Request, res: Response): void {
        const queuedMessageId = req.params.queuedMessageId;
        if (!queuedMessageId) {
            res.status(400).json({ error: '"queuedMessageId" is required.' });
            return;
        }
        const conv = this.store.cancelQueuedMessage(req.params.id, queuedMessageId);
        if (!conv) {
            res.status(404).json({ error: 'Conversation not found.' });
            return;
        }
        res.status(200).json(conv);
    }

    protected async handleDispatchQueuedMessage(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as Partial<{ deliveryMode?: string }>;
        const queuedMessageId = req.params.queuedMessageId;
        if (!queuedMessageId) {
            res.status(400).json({ error: '"queuedMessageId" is required.' });
            return;
        }
        const deliveryMode = body.deliveryMode === 'queue' || body.deliveryMode === 'parallel' || body.deliveryMode === 'interrupt'
            ? body.deliveryMode
            : QAAP_DEFAULT_DELIVERY_MODE;
        try {
            const parent = this.store.get(req.params.id);
            if (deliveryMode === 'parallel' && parent) {
                const pending = parent.pendingUserMessages?.find(message => message.id === queuedMessageId);
                if (!pending) {
                    res.status(202).json(parent);
                    return;
                }
                this.store.cancelQueuedMessage(req.params.id, queuedMessageId);
                const liveParent = this.store.get(req.params.id) ?? parent;
                if (this.conversationHasLiveRun(req.params.id, liveParent)) {
                    const spawned = await this.spawnIsolatedParallelConversation(liveParent, {
                        content: pending.content,
                        agent: pending.turnAgentId,
                        agentModel: pending.turnAgentModel,
                        clientMessageId: pending.clientMessageId,
                    });
                    res.status(202).json(spawned);
                    return;
                }
                const conv = this.store.postUserMessage(
                    req.params.id,
                    pending.content,
                    pending.turnAgentId,
                    pending.turnAgentModel,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    pending.clientMessageId ? { clientMessageId: pending.clientMessageId } : undefined,
                );
                res.status(202).json(conv);
                return;
            }
            const conv = this.store.dispatchQueuedMessage(req.params.id, queuedMessageId, deliveryMode);
            if (!conv) {
                res.status(404).json({ error: 'Conversation not found.' });
                return;
            }
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

    /** Clamped validation shared by the single-shot header and the per-step flow payload. */
    protected sanitizeVisualResult(parsed: Partial<QaapPreviewVisualValidationResult> | undefined): QaapPreviewVisualValidationResult | undefined {
        if (!parsed
            || (parsed.status !== 'passed' && parsed.status !== 'warning' && parsed.status !== 'failed')
            || typeof parsed.summary !== 'string'
            || !Array.isArray(parsed.issues)
            || !parsed.issues.every(issue => typeof issue === 'string')) {
            return undefined;
        }
        // A client cannot label the evidence `passed` while explicitly declaring it non-ready.
        // Normalize the contradictory payload to a hard failure so transport reachability (HTTP
        // 200) can never bypass the render gate or the automatic repair loop.
        const status = parsed.status === 'passed' && parsed.readiness === 'failed'
            ? 'failed'
            : parsed.status;
        return {
            status,
            readiness: status === 'passed'
                ? 'render_ready'
                : 'failed',
            summary: parsed.summary.slice(0, 500),
            issues: parsed.issues.slice(0, 10).map(issue => issue.slice(0, 300)),
        };
    }

    /** Streams and validates an image/png request body; writes the error response on failure. */
    protected async readPngBody(req: Request, res: Response): Promise<Buffer | undefined> {
        if (req.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'image/png') {
            res.status(415).json({ error: 'Visual evidence must be an image/png body.' });
            return undefined;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        try {
            for await (const raw of req) {
                const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
                total += chunk.length;
                if (total > VISUAL_EVIDENCE_MAX_BYTES) {
                    res.status(413).json({ error: 'Visual evidence exceeds the 5 MB limit.' });
                    return undefined;
                }
                chunks.push(chunk);
            }
        } catch {
            res.status(400).json({ error: 'Could not read visual evidence.' });
            return undefined;
        }
        const png = Buffer.concat(chunks);
        if (png.length < 8 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
            res.status(400).json({ error: 'Visual evidence is not a valid PNG.' });
            return undefined;
        }
        return png;
    }

    protected async handlePostVisualEvidenceImage(req: Request, res: Response): Promise<void> {
        const png = await this.readPngBody(req, res);
        if (!png) {
            return;
        }
        try {
            const evidenceId = await this.store.saveVisualEvidenceImage(req.params.id, png);
            if (!evidenceId) {
                res.status(409).json({ error: 'Evidence could not be stored (conversation missing or storage cap reached).' });
                return;
            }
            res.status(201).json({ evidenceId });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    /** JSON finalize of a walked flow: attach the already-uploaded step images in one block. */
    protected async handlePostVisualVerificationFlow(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as { targetMessageId?: unknown; steps?: unknown; previewUrl?: unknown };
        const targetMessageId = typeof body.targetMessageId === 'string' ? body.targetMessageId.trim() : '';
        const previewUrl = normalizeQaapVisualPreviewUrl(typeof body.previewUrl === 'string' ? body.previewUrl : undefined);
        const rawSteps = Array.isArray(body.steps) ? body.steps as Partial<{
            label: unknown; evidenceId: unknown; result: unknown;
        }>[] : [];
        const steps: { label: string; evidenceId: string; result: QaapPreviewVisualValidationResult }[] = [];
        for (const raw of rawSteps.slice(0, 6)) {
            const result = this.sanitizeVisualResult(raw.result as Partial<QaapPreviewVisualValidationResult> | undefined);
            if (typeof raw.label !== 'string' || !raw.label.trim() || typeof raw.evidenceId !== 'string' || !result) {
                res.status(400).json({ error: 'Each step needs label, evidenceId, and a valid result.' });
                return;
            }
            steps.push({ label: raw.label.trim().slice(0, 80), evidenceId: raw.evidenceId.trim(), result });
        }
        if (!targetMessageId || steps.length === 0) {
            res.status(400).json({ error: 'targetMessageId and at least one step are required.' });
            return;
        }
        try {
            const conv = await this.store.recordVisualVerificationFlow(req.params.id, steps, targetMessageId, previewUrl);
            if (!conv) {
                res.status(404).json({ error: 'Conversation, agent response, or evidence not found.' });
                return;
            }
            res.status(201).json(conv);
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected async handlePostVisualVerification(req: Request, res: Response): Promise<void> {
        if (req.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'application/json') {
            await this.handlePostVisualVerificationFlow(req, res);
            return;
        }
        const encoded = req.get('x-qaap-visual-result');
        let result: QaapPreviewVisualValidationResult | undefined;
        try {
            result = this.sanitizeVisualResult(
                JSON.parse(decodeURIComponent(encoded ?? '')) as Partial<QaapPreviewVisualValidationResult>,
            );
        } catch {
            /* validated below */
        }
        if (!result) {
            res.status(400).json({ error: 'Missing or invalid x-qaap-visual-result metadata.' });
            return;
        }
        const png = await this.readPngBody(req, res);
        if (!png) {
            return;
        }
        try {
            const target = req.get('x-qaap-visual-target')?.trim() || undefined;
            const previewUrl = normalizeQaapVisualPreviewUrl(req.get('x-qaap-visual-preview'));
            const conv = await this.store.recordVisualVerification(req.params.id, result, png, target, previewUrl);
            if (!conv) {
                res.status(404).json({ error: 'Conversation or agent response not found.' });
                return;
            }
            res.status(201).json(conv);
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected async handlePostVisualVerificationFailure(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as { reason?: unknown; targetMessageId?: unknown };
        const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
        const targetMessageId = typeof body.targetMessageId === 'string' ? body.targetMessageId.trim() : '';
        if (!reason || !targetMessageId) {
            res.status(400).json({ error: 'reason and targetMessageId are required.' });
            return;
        }
        const conv = await this.store.recordVisualVerificationFailure(req.params.id, reason, targetMessageId);
        if (!conv) {
            res.status(404).json({ error: 'Conversation or agent response not found.' });
            return;
        }
        res.json(conv);
    }

    protected handlePostGitAction(req: Request, res: Response): void {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const metadata = this.sanitizeGitActionMetadata(body);
        if (!metadata) {
            res.status(400).json({ error: 'action and label are required.' });
            return;
        }
        const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : undefined;
        const replaceMessageId = typeof body.replaceMessageId === 'string' ? body.replaceMessageId.trim() : undefined;
        const conv = this.store.recordGitAction(req.params.id, metadata, { messageId, replaceMessageId });
        if (!conv) {
            res.status(404).json({ error: 'Conversation not found.' });
            return;
        }
        res.status(201).json(conv);
    }

    protected sanitizeGitActionMetadata(body: unknown): import('@theia/qaap-mobile-shell/lib/common/qaap-composer-git-action-display').ComposerGitActionDisplayMetadata | undefined {
        const value = (body ?? {}) as Partial<import('@theia/qaap-mobile-shell/lib/common/qaap-composer-git-action-display').ComposerGitActionDisplayMetadata>;
        const action = typeof value.action === 'string' ? value.action.trim() : '';
        const label = typeof value.label === 'string' ? value.label.trim().slice(0, 120) : '';
        if (!action || !label) {
            return undefined;
        }
        const allowed = new Set([
            'create-branch-commit',
            'create-branch-commit-push',
            'commit-push',
            'commit',
            'commit-create-pr',
        ]);
        if (!allowed.has(action)) {
            return undefined;
        }
        return {
            action: action as import('@theia/qaap-mobile-shell/lib/common/qaap-git-review').QaapGitCommitWorkflowAction,
            label,
            status: value.status === 'failed'
                ? 'failed'
                : value.status === 'running'
                    ? 'running'
                    : 'completed',
            ...(typeof value.branch === 'string' && value.branch.trim() ? { branch: value.branch.trim().slice(0, 120) } : {}),
            ...(typeof value.files === 'number' && value.files >= 0 ? { files: value.files } : {}),
            ...(typeof value.insertions === 'number' && value.insertions >= 0 ? { insertions: value.insertions } : {}),
            ...(typeof value.deletions === 'number' && value.deletions >= 0 ? { deletions: value.deletions } : {}),
        };
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
        if (typeof body.archived === 'boolean') {
            patch.archived = body.archived;
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
        // Named `heartbeat` event (not just a `:` comment) so EventSource surfaces it to JS: the
        // client refreshes its transport-liveness clock and won't mislabel a slow-but-live turn as
        // a dropped connection.
        const heartbeat = setInterval(() => res.write('event: heartbeat\ndata: {}\n\n'), SSE_HEARTBEAT_MS);

        const cleanup = (): void => {
            clearInterval(heartbeat);
            subscription.dispose();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
    }

    protected async warmBilling(login: string | undefined): Promise<void> {
        if (!login || !this.billingStore) {
            return;
        }
        try {
            await this.billingStore.getOrCreateAccount(login);
        } catch {
            // Peek stays on Starter until the store recovers.
        }
    }

    protected requireAuth(req: Request, res: Response): QaapGithubAuthContext | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return ctx;
    }

    /**
     * Keep / merge / discard an isolated Parallel worktree fork (`forkedFromId` + `worktreeBranch`).
     * Multi-agent {@link QaapAgentConversation.parallelRunId} variants keep using `/parallel-runs/:id/choose`.
     */
    protected async handleApplyWorktree(req: Request, res: Response): Promise<void> {
        const conv = this.getConversationIfOwned(req, res, req.params.id);
        if (!conv) {
            return;
        }
        const ctx = this.auth.authenticate(req);
        const body = (req.body ?? {}) as Partial<QaapApplyConversationWorktreeRequest>;
        const action = body.action;
        if (!this.isWorktreeApplyAction(action)) {
            res.status(400).json({ error: '"action" must be keep-branch, merge, or none.' });
            return;
        }
        if (conv.parallelRunId) {
            res.status(400).json({ error: 'Use the parallel-runs API to choose a multi-agent variant.' });
            return;
        }
        if (!conv.forkedFromId || !conv.worktreeBranch) {
            res.status(400).json({ error: 'This conversation is not an isolated Parallel worktree.' });
            return;
        }
        if (this.conversationHasLiveRun(conv.id, conv)) {
            res.status(409).json({ error: 'Wait until the agent finishes before applying this worktree.' });
            return;
        }
        const parent = this.store.get(conv.forkedFromId);
        const baseCwd = conv.parallelBaseCwd ?? parent?.parallelBaseCwd ?? parent?.cwd;
        if (!baseCwd) {
            res.status(400).json({ error: 'The parent repository for this worktree is unknown.' });
            return;
        }
        if (ctx.kind !== 'unauthorized' && !this.auth.ownsWorkspacePath(ctx, baseCwd)) {
            this.auth.denyForbidden(res, req, 'agent_conversation', { conversationId: conv.id, cwd: baseCwd });
            return;
        }
        try {
            const result = await this.worktrees.apply({
                worktreePath: conv.cwd,
                branch: conv.worktreeBranch,
                baseCwd,
                action,
            }) satisfies QaapApplyConversationWorktreeResponse;
            if (result.ok) {
                this.store.delete(conv.id);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected isWorktreeApplyAction(value: unknown): value is QaapWorktreeApplyAction {
        return value === 'keep-branch' || value === 'merge' || value === 'none';
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
        // 'parallel-run' carries the run's base cwd — scope its diff stats to the owner.
        return this.auth.ownsWorkspacePath(ctx, event.cwd);
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

function sanitizeLatencyMarks(input: unknown): Partial<Record<QaapTurnLatencyMark, number>> | undefined {
    if (!input || typeof input !== 'object') {
        return undefined;
    }
    const result: Partial<Record<QaapTurnLatencyMark, number>> = {};
    for (const [mark, at] of Object.entries(input)) {
        if (typeof at === 'number' && Number.isFinite(at)) {
            result[mark as QaapTurnLatencyMark] = at;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function isAgentApprovalPolicyId(value: string | undefined): value is QaapAgentApprovalPolicyId {
    return value === 'request-approval' || value === 'approve-for-me' || value === 'full-access';
}
