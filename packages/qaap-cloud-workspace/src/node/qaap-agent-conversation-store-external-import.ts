// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { randomUUID } from 'crypto';
import * as path from 'path';
import type { QaapExternalSessionSource } from '@theia/qaap-shared-core/lib/common/qaap-external-session-protocol';
import { DEFAULT_QAAP_CONTEXT_WINDOW, toConversationSummary, type QaapAgentConversation, type QaapAgentMessage } from '../common/qaap-agent-conversation';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import type { QaapExternalSessionTranscript } from './external-sessions/qaap-external-session-transcript';

/** What the import endpoint hands the store: the parsed session and the project it belongs to. */
export interface QaapExternalConversationSeed {
    readonly cwd: string;
    readonly source: QaapExternalSessionSource;
    readonly transcript: QaapExternalSessionTranscript;
}

/** The conversation already imported from `(source, sessionId)` for this owner, if any. */
export function findImportedConversation(
    ctx: Pick<QaapAgentConversationStoreContext, 'conversations'>,
    source: QaapExternalSessionSource,
    sessionId: string,
    ownerLogin: string | undefined,
): QaapAgentConversation | undefined {
    for (const conv of ctx.conversations.values()) {
        if (conv.externalSession?.source === source && conv.externalSession.sessionId === sessionId
            && (conv.ownerLogin ?? undefined) === (ownerLogin ?? undefined)) {
            return conv;
        }
    }
    return undefined;
}

/**
 * Creates an idle conversation holding a copy of an external CLI session. Its harness is that CLI, so the
 * next turn resumes the native session; any other harness continues it from the replayed history.
 * Returns the existing conversation (and `created: false`) when this session was already imported.
 */
export function importExternalConversationExtracted(
    ctx: QaapAgentConversationStoreContext,
    seed: QaapExternalConversationSeed,
    ownerLogin: string | undefined,
): { conversation: QaapAgentConversation; created: boolean } {
    if (ctx.conversationStorageFailure !== undefined) {
        throw new Error(`Conversation storage is unavailable: ${ctx.conversationStorageFailure}`);
    }
    const { header, messages: imported } = seed.transcript;
    const existing = findImportedConversation(ctx, seed.source, header.sessionId, ownerLogin);
    if (existing) {
        return { conversation: existing, created: false };
    }
    const cwd = path.resolve(seed.cwd);
    if (!ctx.isDirectory(cwd)) {
        throw new Error('A valid absolute "cwd" directory is required.');
    }
    let previousUserId: string | undefined;
    const messages: QaapAgentMessage[] = imported.map(message => {
        const id = randomUUID();
        if (message.role === 'user') {
            previousUserId = id;
            return { id, role: 'user', content: message.content, createdAt: message.createdAt, turnAgentId: seed.source };
        }
        return {
            id,
            role: 'agent',
            content: message.content,
            createdAt: message.createdAt,
            runFinishedAt: message.finishedAt ?? message.createdAt,
            ...(message.traceEvents?.length ? { traceEvents: message.traceEvents } : {}),
            ...(previousUserId ? { runUserMessageId: previousUserId } : {}),
        };
    });
    const now = Date.now();
    const titleSeed = header.title || header.firstUserMessage;
    const conversation: QaapAgentConversation = {
        id: randomUUID(),
        cwd,
        agentId: seed.source,
        title: ctx.deriveTitle(titleSeed) || 'Imported conversation',
        status: 'idle',
        createdAt: header.startedAt || now,
        updatedAt: now,
        messages,
        ...(ownerLogin ? { ownerLogin } : {}),
        externalSession: {
            source: seed.source,
            sessionId: header.sessionId,
            importedAt: now,
            importedMessageCount: messages.length,
            ...(header.originator ? { originator: header.originator } : {}),
        },
        // An imported thread is a copy of work done elsewhere: it must not open a task pull request on its own.
        taskPullRequestEnabled: false,
        contextUsageEstimated: true,
        contextWindowSize: DEFAULT_QAAP_CONTEXT_WINDOW,
    };
    ctx.conversations.set(conversation.id, conversation);
    ctx.fire({ type: 'created', conversation: toConversationSummary(conversation) });
    void ctx.persist();
    return { conversation, created: true };
}
