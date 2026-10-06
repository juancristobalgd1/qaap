// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { json } from 'body-parser';
import {
    QAAP_CONVERSATION_READ_MARKS_API_PATH,
    type QaapConversationReadMarkResponse,
    type QaapConversationReadMarksResponse,
    type QaapPutConversationReadMarkRequest,
} from '@theia/qaap-shared-core/lib/common/qaap-conversation-read-marks';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapConversationReadMarkStore } from './qaap-conversation-read-mark-store';

/** Per-user read marks of agent conversations (the Work Hub unread dot). */
@injectable()
export class QaapConversationReadMarkEndpoint implements BackendApplicationContribution {

    @inject(QaapConversationReadMarkStore)
    protected readonly readMarks: QaapConversationReadMarkStore;

    @inject(QaapAgentConversationStore)
    protected readonly conversations: QaapAgentConversationStore;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_CONVERSATION_READ_MARKS_API_PATH, (req, res) => this.handleList(req, res));
        app.put(`${QAAP_CONVERSATION_READ_MARKS_API_PATH}/:id`, json({ limit: '1kb' }), (req, res) => this.handleMarkRead(req, res));
    }

    protected handleList(req: Request, res: Response): void {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        res.json({ marks: this.readMarks.list(this.auth.resolveUserLogin(ctx)) } satisfies QaapConversationReadMarksResponse);
    }

    protected handleMarkRead(req: Request, res: Response): void {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const conversationId = req.params.id;
        const conv = this.conversations.get(conversationId);
        if (!conv) {
            res.status(404).json({ error: 'Conversation not found.' });
            return;
        }
        if (!this.auth.ownsWorkspacePath(ctx, conv.cwd)) {
            this.auth.denyForbidden(res, req, 'agent_conversation', { conversationId });
            return;
        }
        const requested = (req.body ?? {}) as QaapPutConversationReadMarkRequest;
        const readAt = this.readMarks.markRead(
            this.auth.resolveUserLogin(ctx),
            conversationId,
            typeof requested.readAt === 'number' ? requested.readAt : undefined,
        );
        res.json({ conversationId, readAt } satisfies QaapConversationReadMarkResponse);
    }
}
