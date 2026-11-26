// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { json } from 'body-parser';
import { QAAP_TENANT_LOGIN_ENV, isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import {
    QAAP_AGENT_PREVIEW_API_PATH,
    QAAP_AGENT_PREVIEW_ERROR_STATUS,
    QAAP_AGENT_PREVIEW_READ_OPERATIONS,
    QAAP_AGENT_PREVIEW_ROUTES,
    QAAP_USER_PREVIEW_API_PATH,
    QAAP_USER_PREVIEW_CONFIG_ROUTE,
    QaapAgentPreviewError,
    isQaapAgentPreviewToolsEnabled,
    isQaapPreviewAgentDrivenEnabled,
    isQaapPreviewServiceEnabled,
    parseQaapPreviewLogsRequest,
    parseQaapPreviewSnapshotRequest,
    parseQaapPreviewStartRequest,
    parseQaapPreviewStatusRequest,
    parseQaapPreviewStopRequest,
    type QaapAgentPreviewErrorCode,
    type QaapAgentPreviewOperation,
    type QaapPreviewConfigResponse,
    type QaapPreviewParseResult,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-preview-protocol';
import { QAAP_DEFAULT_PREVIEW_CONVERSATION_ID, normalizeQaapPreviewConversationId } from '@theia/qaap-shared-core/lib/common/qaap-preview-identity';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QAAP_AGENT_DELEGATION_TOKEN_HEADER } from '../common/qaap-agent-delegation-protocol';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapAgentPreviewService, type QaapAgentPreviewCaller } from './qaap-agent-preview-service';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';
import { canonicalQaapTenantLogin } from './qaap-tenant-runtime-store';

const BODY_LIMIT = '64kb';

/** Parser per operation. */
const PARSERS: Readonly<Record<QaapAgentPreviewOperation, (body: unknown) => QaapPreviewParseResult<unknown>>> = {
    start: parseQaapPreviewStartRequest,
    restart: parseQaapPreviewStartRequest,
    status: parseQaapPreviewStatusRequest,
    logs: parseQaapPreviewLogsRequest,
    stop: parseQaapPreviewStopRequest,
    snapshot: parseQaapPreviewSnapshotRequest,
};

/**
 * HTTP side of the agent preview tools.
 *
 * - `POST /qaap/api/agent-preview/<op>`: called by the per-task MCP shim. The token in the delegation header (one
 *   per-task MCP token for every Qaap toolset) must hold the `preview` scope; on a tenant backend it must belong to
 *   this tenant. Conversation, owner and working directory come from the token's task, never from the body.
 *   Behind `QAAP_AGENT_PREVIEW_TOOLS`.
 * - `POST /qaap/api/preview/<op>`: the same operations for a signed-in user (Run app button, manual checks), with
 *   `cwd` (absolute, owned by the user) and an optional `conversationId` in the body. Behind `QAAP_PREVIEW_SERVICE`
 *   (implied by the agent tools).
 */
@injectable()
export class QaapAgentPreviewEndpoint implements BackendApplicationContribution {

    @inject(QaapToolGateTokenService)
    protected readonly tokens: QaapToolGateTokenService;

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapAgentPreviewService)
    protected readonly previews: QaapAgentPreviewService;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(`${QAAP_USER_PREVIEW_API_PATH}${QAAP_USER_PREVIEW_CONFIG_ROUTE}`, (req, res) => {
            this.handleConfig(req, res);
        });
        for (const operation of Object.keys(QAAP_AGENT_PREVIEW_ROUTES) as QaapAgentPreviewOperation[]) {
            const route = QAAP_AGENT_PREVIEW_ROUTES[operation];
            app.post(`${QAAP_AGENT_PREVIEW_API_PATH}${route}`, json({ limit: BODY_LIMIT }), (req, res) => {
                void this.handle(req, res, operation, () => this.agentCaller(req)).catch(error => this.internal(res, error));
            });
            app.post(`${QAAP_USER_PREVIEW_API_PATH}${route}`, json({ limit: BODY_LIMIT }), (req, res) => {
                void this.handle(req, res, operation, () => this.userCaller(req)).catch(error => this.internal(res, error));
            });
        }
    }

    /** Exposes the backend preview feature flags to a signed-in user so the frontend can switch over cleanly. */
    protected handleConfig(req: Request, res: Response): void {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            this.fail(res, 'unauthorized', 'Not signed in.');
            return;
        }
        const env = this.env();
        const response: QaapPreviewConfigResponse = {
            previewService: isQaapPreviewServiceEnabled(env),
            agentPreviewTools: isQaapAgentPreviewToolsEnabled(env),
            agentDriven: isQaapPreviewAgentDrivenEnabled(env),
        };
        res.json(response);
    }

    protected async handle(
        req: Request,
        res: Response,
        operation: QaapAgentPreviewOperation,
        authenticate: () => { caller: QaapAgentPreviewCaller; body: unknown },
    ): Promise<void> {
        const agentRoute = req.path.startsWith(QAAP_AGENT_PREVIEW_API_PATH);
        if (agentRoute ? !isQaapAgentPreviewToolsEnabled(this.env()) : !isQaapPreviewServiceEnabled(this.env())) {
            this.fail(res, 'disabled', 'The preview tools are off on this server.');
            return;
        }
        try {
            const { caller, body } = authenticate();
            if (!caller.ownerLogin) {
                this.fail(res, 'forbidden', 'This request has no owner.');
                return;
            }
            const parsed = PARSERS[operation](body);
            if (!parsed.ok) {
                this.fail(res, 'invalid-request', parsed.error);
                return;
            }
            if (!caller.canControl && !QAAP_AGENT_PREVIEW_READ_OPERATIONS.has(operation)) {
                this.fail(res, 'read-only', caller.controlRefusal ?? 'This turn may only read the preview.');
                return;
            }
            const value = parsed.value as never;
            const result = operation === 'start' ? await this.previews.start(caller, value)
                : operation === 'restart' ? await this.previews.restart(caller, value)
                    : operation === 'status' ? await this.previews.status(caller, value)
                        : operation === 'logs' ? this.previews.logs(caller, value)
                            : operation === 'stop' ? await this.previews.stop(caller)
                                : await this.previews.snapshot(caller, value);
            if (!res.headersSent) {
                res.json(result);
            }
        } catch (error) {
            if (error instanceof QaapAgentPreviewError) {
                this.fail(res, error.code, error.message);
                return;
            }
            throw error;
        }
    }

    /** The caller of a shim request, from its token's task. Throws {@link QaapAgentPreviewError} when refused. */
    protected agentCaller(req: Request): { caller: QaapAgentPreviewCaller; body: unknown } {
        const env = this.env();
        let ownerCheck: { readonly expectedOwner: string | undefined } | undefined;
        if (isQaapTenantBackendMode(env)) {
            const tenantLogin = env[QAAP_TENANT_LOGIN_ENV]?.trim();
            if (!tenantLogin) {
                throw new QaapAgentPreviewError('forbidden', 'This tenant backend does not know its tenant, so it refuses preview requests.');
            }
            ownerCheck = { expectedOwner: tenantLogin };
        }
        const result = this.tokens.authorize(req.header(QAAP_AGENT_DELEGATION_TOKEN_HEADER), 'preview', ownerCheck);
        if (!result.ok) {
            throw result.reason === 'invalid'
                ? new QaapAgentPreviewError('unauthorized', 'Invalid or expired preview token.')
                : new QaapAgentPreviewError('forbidden', result.reason === 'scope' ? 'This task has no preview tools.' : 'The preview token belongs to another tenant.');
        }
        // A local runtime (desktop, `start:browser`) has no signed-in user: its tasks carry no owner and its
        // previews are claimed as the local login (`_dev`). A hosted tenant backend always needs the owner.
        const owner = result.grant.owner || (ownerCheck ? undefined : canonicalQaapTenantLogin(''));
        if (result.grant.oneShot || !owner) {
            throw new QaapAgentPreviewError('forbidden', 'This task has no preview tools.');
        }
        const turn = this.store.taskToConversation.get(result.grant.taskId);
        const task = this.store.findTaskById(result.grant.taskId);
        if (!turn || !task) {
            throw new QaapAgentPreviewError('forbidden', 'The preview token is not attached to a conversation turn.');
        }
        const conversation = this.store.get(turn.conversationId);
        const parentId = conversation?.parentConversationId;
        const child = task.delegationRole === 'child' || !!parentId;
        const readOnly = task.readOnlyWorkspace === true;
        const caller: QaapAgentPreviewCaller = {
            ownerLogin: owner,
            // A delegated child addresses its parent's preview (D3).
            conversationId: child && parentId ? parentId : turn.conversationId,
            cwd: child && parentId ? (this.store.get(parentId)?.cwd ?? task.cwd) : task.cwd,
            canControl: !child && !readOnly,
            ...(child ? { controlRefusal: 'A delegated child may only read its parent\'s preview (preview_status, preview_logs, preview_snapshot).' }
                : readOnly ? { controlRefusal: 'This is a read-only (plan) turn: it may only read the preview (preview_status, preview_logs, preview_snapshot).' } : {}),
            ownership: 'agent',
        };
        return { caller, body: req.body };
    }

    /** The caller of a user request, from the session; `cwd` must be a workspace path the user owns. */
    protected userCaller(req: Request): { caller: QaapAgentPreviewCaller; body: unknown } {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            throw new QaapAgentPreviewError('unauthorized', 'Not signed in.');
        }
        const raw = (req.body ?? {}) as Record<string, unknown>;
        const cwd = typeof raw.cwd === 'string' ? raw.cwd.trim() : '';
        if (!cwd) {
            throw new QaapAgentPreviewError('invalid-request', 'cwd (the absolute project path) is required.');
        }
        if (ctx.kind !== 'skip' && !this.auth.ownsWorkspacePath(ctx, cwd)) {
            throw new QaapAgentPreviewError('forbidden', 'This workspace path is not yours.');
        }
        const ownerLogin = ctx.userLogin;
        if (!ownerLogin) {
            throw new QaapAgentPreviewError('forbidden', 'This session has no user.');
        }
        const conversationId = typeof raw.conversationId === 'string' && raw.conversationId.trim()
            ? normalizeQaapPreviewConversationId(raw.conversationId)
            : QAAP_DEFAULT_PREVIEW_CONVERSATION_ID;
        const { cwd: _cwd, conversationId: _conversation, ...body } = raw;
        return {
            caller: { ownerLogin, conversationId, cwd, canControl: true, ownership: 'user' },
            body,
        };
    }

    protected fail(res: Response, code: QaapAgentPreviewErrorCode, error: string): void {
        if (!res.headersSent) {
            res.status(QAAP_AGENT_PREVIEW_ERROR_STATUS[code]).json({ error, code });
        }
    }

    protected internal(res: Response, error: unknown): void {
        console.warn('[qaap-agent-preview] request failed:', error instanceof Error ? error.message : String(error));
        this.fail(res, 'internal', 'The preview request failed.');
    }

    /** Process env; a seam for tests. */
    protected env(): NodeJS.ProcessEnv {
        return process.env;
    }
}
