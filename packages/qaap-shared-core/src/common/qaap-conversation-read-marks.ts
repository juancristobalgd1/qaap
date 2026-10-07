// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Per-user "read up to" marks for agent conversations. The backend owns them (keyed by the
 * signed-in login + conversation id), so a task read on the desktop is read on the phone, after a
 * reload and in any other tab — and never for another user of the same browser.
 */
export const QAAP_CONVERSATION_READ_MARKS_API_PATH = '/qaap/api/conversation-read-marks';

export interface QaapConversationReadMarksResponse {
    /** Conversation id → server time (ms) up to which the user has read it. */
    readonly marks: Readonly<Record<string, number>>;
}

export interface QaapPutConversationReadMarkRequest {
    /** Server-clock time to record; omitted = "now". Clamped to now and never moves a mark back. */
    readonly readAt?: number;
}

export interface QaapConversationReadMarkResponse {
    readonly conversationId: string;
    readonly readAt: number;
}

/** Message fields {@link resolveQaapConversationAgentActivityAt} reads. */
export interface QaapConversationActivityMessage {
    readonly role: string;
    readonly createdAt: number;
    readonly runFinishedAt?: number;
}

/**
 * When the agent last wrote something the user has not necessarily seen: the live `updatedAt`
 * while it streams, otherwise the end of its last reply. PATCHes (title, flags, composer prefs),
 * PR links and git bookkeeping move `updatedAt` but are not agent activity. `undefined` when the
 * latest message is the user's — there is no reply to read.
 */
export function resolveQaapConversationAgentActivityAt(conv: {
    readonly status: string;
    readonly updatedAt: number;
    readonly messages: ReadonlyArray<QaapConversationActivityMessage>;
}): number | undefined {
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'agent') {
        return undefined;
    }
    if (conv.status === 'streaming') {
        return conv.updatedAt;
    }
    return Math.max(last.createdAt, last.runFinishedAt ?? 0);
}

/** Read marks of the signed-in user. */
export async function fetchConversationReadMarks(): Promise<Record<string, number>> {
    const response = await fetch(QAAP_CONVERSATION_READ_MARKS_API_PATH, { credentials: 'include' });
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    const body = await response.json() as Partial<QaapConversationReadMarksResponse>;
    return { ...(body.marks ?? {}) };
}

/** Records the conversation as read (now, or at `readAt` when importing an older mark). */
export async function putConversationReadMark(conversationId: string, readAt?: number): Promise<number> {
    const request: QaapPutConversationReadMarkRequest = readAt === undefined ? {} : { readAt };
    const response = await fetch(`${QAAP_CONVERSATION_READ_MARKS_API_PATH}/${encodeURIComponent(conversationId)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return (await response.json() as QaapConversationReadMarkResponse).readAt;
}
