// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

/**
 * A "New task" creation that is still in flight for a project. A Stop pressed before the backend
 * returns the created conversation has no conversation id to cancel (the placeholder id is never
 * on the server), so it is recorded here and honoured when creation resolves. In memory only.
 */
export interface QaapNewTaskStartup {
    readonly projectId: string;
    stopRequested: boolean;
}

/** What happens once a new-task creation resolves. */
export type QaapNewTaskStartupOutcome = 'commit' | 'restore' | 'cancelAndRestore';

const startupsByProjectId = new Map<string, QaapNewTaskStartup>();

export function beginNewTaskStartup(projectId: string): QaapNewTaskStartup {
    const startup: QaapNewTaskStartup = { projectId, stopRequested: false };
    startupsByProjectId.set(projectId, startup);
    return startup;
}

export function endNewTaskStartup(startup: QaapNewTaskStartup): void {
    if (startupsByProjectId.get(startup.projectId) === startup) {
        startupsByProjectId.delete(startup.projectId);
    }
}

/** Marks the project's in-flight new-task creation as stopped. Returns false when none is in flight. */
export function requestStopNewTaskStartup(projectId: string): boolean {
    const startup = startupsByProjectId.get(projectId);
    if (!startup) {
        return false;
    }
    startup.stopRequested = true;
    return true;
}

/**
 * Outcome of a creation. Nothing created means nothing was accepted, so the draft is restored.
 * A created conversation with a Stop during creation is cancelled and the draft is restored.
 * Otherwise the send is committed.
 */
export function resolveNewTaskStartupOutcome(
    startup: Pick<QaapNewTaskStartup, 'stopRequested'>,
    created: unknown | undefined,
): QaapNewTaskStartupOutcome {
    if (!created) {
        return 'restore';
    }
    return startup.stopRequested ? 'cancelAndRestore' : 'commit';
}

/**
 * True when a conversation produced agent output (text, tool segments or trace events). A stopped
 * task with output is kept; one without is a send that never really started.
 */
export function conversationHasAgentOutput(conversation: Pick<QaapAgentConversationDTO, 'messages'>): boolean {
    return conversation.messages.some(message => message.role === 'agent' && (
        message.content.trim().length > 0
        || (message.segments?.length ?? 0) > 0
        || (message.traceEvents?.length ?? 0) > 0
    ));
}
