// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Logs every turn the store creates so a `create` the user did not send can be traced to its origin.
 * Identifiers only: never prompt text or other user content.
 */
export function logTurnCreatedExtracted(origin: string, conversationId: string, userMessageId: string | undefined, taskId: string): void {
    console.warn(`[qaap-turn] create origin=${origin} conv=${conversationId} userMessage=${userMessageId ?? '-'} task=${taskId}`);
}
