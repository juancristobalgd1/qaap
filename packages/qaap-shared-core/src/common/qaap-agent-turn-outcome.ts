// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Reading a settled turn's outcome. A persisted `error` on an agent message is the last classification
 * of its turn, and it can outlive the evidence that produced it (a failure taken from an auxiliary model's
 * log line, or from a turn that later delivered its reply). When the turn itself succeeded, that error is
 * stale and must not draw a failure card or a "Failed:" label.
 */

/** The turn verdict the user message carries once its task settled (structural: the DTO's shape). */
export interface QaapAgentTurnOutcomeVerdict {
    readonly taskState?: string;
    readonly closingReport?: { readonly exitCode?: number };
}

/** The agent message fields that show what the agent actually produced. */
export interface QaapAgentTurnOutcomeMessage {
    readonly content?: string;
    readonly segments?: readonly unknown[];
    readonly traceEvents?: readonly unknown[];
}

/** A conversation message as far as the outcome needs it. */
export interface QaapAgentTurnOutcomeEntry {
    readonly id: string;
    readonly role: string;
    readonly turnVerdict?: QaapAgentTurnOutcomeVerdict;
}

const SUCCESSFUL_TASK_STATES: ReadonlySet<string> = new Set(['completed', 'completed_with_warnings']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function nonEmptyText(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

/** The agent produced visible text: its reply, a text segment, or a completed assistant text in the trace. */
export function hasRealAgentContent(message: QaapAgentTurnOutcomeMessage): boolean {
    if (nonEmptyText(message.content)) {
        return true;
    }
    if ((message.segments ?? []).some(segment => isRecord(segment) && segment.type === 'text' && nonEmptyText(segment.content))) {
        return true;
    }
    return hasCompletedAssistantText(message);
}

/** A completed assistant text event in the trace (OpenCode, Codex and Claude streams write this). */
export function hasCompletedAssistantText(message: QaapAgentTurnOutcomeMessage): boolean {
    return (message.traceEvents ?? []).some(event => isRecord(event)
        && event.type === 'assistant_text'
        && event.status === 'completed'
        && nonEmptyText(event.content));
}

/**
 * Whether the turn that produced this agent message succeeded. The turn's verdict decides when it is
 * settled; otherwise its exit code; otherwise the trace itself. Without real agent output there is no
 * success to show, so the stored error stays.
 */
export function isSuccessfulAgentTurn(
    input: { readonly verdict?: QaapAgentTurnOutcomeVerdict; readonly exitCode?: number },
    message: QaapAgentTurnOutcomeMessage,
): boolean {
    if (!hasRealAgentContent(message)) {
        return false;
    }
    const state = input.verdict?.taskState;
    if (state) {
        return SUCCESSFUL_TASK_STATES.has(state);
    }
    const exitCode = input.verdict?.closingReport?.exitCode ?? input.exitCode;
    if (exitCode !== undefined) {
        return exitCode === 0;
    }
    return hasCompletedAssistantText(message);
}

/**
 * Whether the agent message `agentMessageId` belongs to a turn that succeeded. Its turn is the nearest
 * user message before it, which carries the verdict.
 */
export function isSuccessfulAgentMessageInConversation(
    messages: readonly QaapAgentTurnOutcomeEntry[],
    agentMessage: QaapAgentTurnOutcomeEntry & QaapAgentTurnOutcomeMessage,
): boolean {
    const index = messages.findIndex(entry => entry.id === agentMessage.id);
    const start = index < 0 ? messages.length - 1 : index;
    let verdict: QaapAgentTurnOutcomeVerdict | undefined;
    for (let i = start; i >= 0; i--) {
        if (messages[i].role === 'user') {
            verdict = messages[i].turnVerdict;
            break;
        }
    }
    return isSuccessfulAgentTurn({ verdict }, agentMessage);
}
