// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { json } from 'body-parser';
import { isQaapTenantBackendMode, QAAP_TENANT_LOGIN_ENV } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import {
    isQaapAgentDelegationEnabled,
    parseQaapChildApplyRequest,
    parseQaapDelegateRequest,
    parseQaapListAgentsRequest,
    parseQaapTaskCancelRequest,
    parseQaapTaskStatusRequest,
    parseQaapTaskWaitRequest,
    QAAP_AGENT_DELEGATION_API_PATH,
    QAAP_AGENT_DELEGATION_ERROR_STATUS,
    QAAP_AGENT_DELEGATION_ROUTES,
    QAAP_AGENT_DELEGATION_TOKEN_HEADER,
    type QaapAgentDelegationErrorCode,
    type QaapAgentDelegationErrorResponse,
    type QaapAgentDelegationOperation,
    type QaapDelegationParseResult,
} from '../common/qaap-agent-delegation-protocol';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapAgentDelegationError, QaapAgentDelegationService, type QaapDelegationCallerContext } from './qaap-agent-delegation-service';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

/** Prompts are capped at 20k characters; this leaves room for JSON escaping and nothing more. */
const DELEGATION_BODY_LIMIT = '128kb';

/** One route: how to validate its body and what to call with it. */
interface QaapDelegationRoute {
    readonly parse: (body: unknown) => QaapDelegationParseResult<unknown>;
    readonly run: (ctx: QaapDelegationCallerContext, request: never, signal: AbortSignal) => Promise<unknown> | unknown;
}

/**
 * HTTP side of agent delegation (`qaap-agent-delegation-protocol.ts`), called by the MCP shim a parent turn's
 * harness runs. Behind `QAAP_AGENT_DELEGATION` (off: every route answers 404 `disabled`).
 *
 * Authentication: the task token in {@link QAAP_AGENT_DELEGATION_TOKEN_HEADER} must hold the `delegate` scope.
 * On a tenant backend it must also belong to the tenant this backend serves (`QAAP_TENANT_LOGIN`); a tenant
 * backend without that login refuses everything (fail closed). The parent conversation and turn come from the
 * token's task, the owner from its grant; the body never names an owner, a cwd or a parent.
 */
@injectable()
export class QaapAgentDelegationEndpoint implements BackendApplicationContribution {

    @inject(QaapToolGateTokenService)
    protected readonly tokens: QaapToolGateTokenService;

    @inject(QaapAgentDelegationService)
    protected readonly delegation: QaapAgentDelegationService;

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    configure(app: Application): void {
        const routes: Record<QaapAgentDelegationOperation, QaapDelegationRoute> = {
            delegate: { parse: parseQaapDelegateRequest, run: (ctx, request) => this.delegation.delegate(ctx, request) },
            // Reports are marked delivered only once the response is written (see handle), never by an aborted wait.
            wait: { parse: parseQaapTaskWaitRequest, run: (ctx, request, signal) => this.delegation.wait(ctx, request, signal, { deliverOnReturn: false }) },
            status: { parse: parseQaapTaskStatusRequest, run: (ctx, request) => this.delegation.status(ctx, request) },
            cancel: { parse: parseQaapTaskCancelRequest, run: (ctx, request) => this.delegation.cancel(ctx, request) },
            childApply: { parse: parseQaapChildApplyRequest, run: (ctx, request) => this.delegation.childApply(ctx, request) },
            listAgents: { parse: parseQaapListAgentsRequest, run: ctx => this.delegation.listAgents(ctx) },
        };
        for (const operation of Object.keys(routes) as QaapAgentDelegationOperation[]) {
            app.post(`${QAAP_AGENT_DELEGATION_API_PATH}${QAAP_AGENT_DELEGATION_ROUTES[operation]}`, json({ limit: DELEGATION_BODY_LIMIT }), (req, res) => {
                this.handle(req, res, routes[operation]).catch(error => {
                    console.warn('[qaap-agent-delegation] request failed:', error instanceof Error ? error.message : String(error));
                    if (!res.headersSent) {
                        this.fail(res, 'internal', 'The delegation request failed.');
                    }
                });
            });
        }
    }

    protected async handle(req: Request, res: Response, route: QaapDelegationRoute): Promise<void> {
        if (!isQaapAgentDelegationEnabled(this.env())) {
            this.fail(res, 'disabled', 'Agent delegation is off on this server.');
            return;
        }
        const ctx = this.authenticate(req, res);
        if (!ctx) {
            return;
        }
        const parsed = route.parse(req.body);
        if (!parsed.ok) {
            this.fail(res, 'invalid-request', parsed.error);
            return;
        }
        // A wait blocks; when the shim gives up (client cancelled, harness gone) stop waiting at once.
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        try {
            const result = await route.run(ctx, parsed.value as never, abort.signal);
            if (!res.writableEnded && !abort.signal.aborted) {
                const delivered = deliveredReportIds(result);
                if (delivered.length) {
                    // `finish`: the whole response was handed to the OS for the caller. Until then the reports stay
                    // undelivered, so a caller that went away gets them again (next wait or a follow-up).
                    res.on('finish', () => this.delegation.markReportsDelivered(ctx, delivered));
                }
                res.json(result);
            }
        } catch (error) {
            if (error instanceof QaapAgentDelegationError) {
                this.fail(res, error.code, error.message);
                return;
            }
            throw error;
        }
    }

    /** The caller context from the token, or undefined after answering 401/403. */
    protected authenticate(req: Request, res: Response): QaapDelegationCallerContext | undefined {
        const env = this.env();
        let ownerCheck: { readonly expectedOwner: string | undefined } | undefined;
        if (isQaapTenantBackendMode(env)) {
            const tenantLogin = env[QAAP_TENANT_LOGIN_ENV]?.trim();
            if (!tenantLogin) {
                this.fail(res, 'forbidden', 'This tenant backend does not know its tenant, so it refuses delegation.');
                return undefined;
            }
            ownerCheck = { expectedOwner: tenantLogin };
        }
        const result = this.tokens.authorize(req.header(QAAP_AGENT_DELEGATION_TOKEN_HEADER), 'delegate', ownerCheck);
        if (!result.ok) {
            if (result.reason === 'invalid') {
                this.fail(res, 'unauthorized', 'Invalid or expired delegation token.');
            } else {
                this.fail(res, 'forbidden', result.reason === 'scope'
                    ? 'This task may not delegate.'
                    : 'The delegation token belongs to another tenant.');
            }
            return undefined;
        }
        if (result.grant.oneShot) {
            this.fail(res, 'forbidden', 'This task may not delegate.');
            return undefined;
        }
        const turn = this.store.taskToConversation.get(result.grant.taskId);
        if (!turn) {
            this.fail(res, 'forbidden', 'The delegation token is not attached to a conversation turn.');
            return undefined;
        }
        // Plan mode and read-only workspaces set `readOnlyWorkspace` on the task: such a turn never gains writes.
        const readOnlyTurn = this.store.findTaskById(result.grant.taskId)?.readOnlyWorkspace === true;
        return {
            parentConversationId: turn.conversationId, ownerLogin: result.grant.owner, parentTurnId: turn.userMessageId,
            ...(readOnlyTurn ? { readOnlyTurn: true } : {}),
        };
    }

    protected fail(res: Response, code: QaapAgentDelegationErrorCode, error: string): void {
        res.status(QAAP_AGENT_DELEGATION_ERROR_STATUS[code]).json({ error, code } satisfies QaapAgentDelegationErrorResponse);
    }

    /** Process env; a seam for tests. */
    protected env(): NodeJS.ProcessEnv {
        return process.env;
    }
}

/** Child ids of the reports a wait response carries (`finished`), if any. */
function deliveredReportIds(result: unknown): string[] {
    const finished = (result as { finished?: unknown } | undefined)?.finished;
    return Array.isArray(finished)
        ? finished.map(report => (report as { childId?: unknown }).childId).filter((id): id is string => typeof id === 'string')
        : [];
}
