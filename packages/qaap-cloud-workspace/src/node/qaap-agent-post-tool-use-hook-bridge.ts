// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import type { QaapAgentConversation, QaapAgentConversationEvent, QaapAgentMessageSegment } from '../common/qaap-agent-conversation';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapAgentHookService } from './qaap-agent-hook-service';

type QaapToolSegment = Extract<QaapAgentMessageSegment, { type: 'tool' }>;

const MAX_TRACKED_TOOL_IDS_PER_CONVERSATION = 2_000;

/**
 * PostToolUse: watches the parsed transcript (the same tool segments every CLI stream is reduced to)
 * and notifies hooks once per finished tool call of the streaming turn. Fire-and-forget — hooks can
 * observe tool results but cannot alter them.
 */
@injectable()
export class QaapAgentPostToolUseHookBridge implements BackendApplicationContribution {

    @inject(QaapAgentConversationStore)
    protected readonly conversations: QaapAgentConversationStore;

    @inject(QaapAgentHookService)
    protected readonly hooks: QaapAgentHookService;

    protected readonly notified = new Map<string, Set<string>>();

    onStart(): void {
        this.conversations.onDidChange(event => this.onConversationEvent(event));
    }

    protected onConversationEvent(event: QaapAgentConversationEvent): void {
        if (event.type === 'deleted') {
            this.notified.delete(event.conversationId);
            return;
        }
        if (event.type !== 'message' && event.type !== 'message_delta') {
            return;
        }
        try {
            const conversation = this.conversations.get(event.conversationId);
            if (conversation) {
                this.scan(conversation);
            }
        } catch (error) {
            console.warn('[qaap-agent-hooks] PostToolUse scan failed:', error instanceof Error ? error.message : String(error));
        }
    }

    protected scan(conversation: QaapAgentConversation): void {
        // Only the live agent reply: a new user message or a settled conversation must never replay
        // tool calls of earlier turns.
        const last = conversation.messages[conversation.messages.length - 1];
        if (conversation.status !== 'streaming' || !last || last.role !== 'agent' || !last.segments?.length) {
            return;
        }
        const context = { cwd: conversation.cwd, ...(conversation.ownerLogin ? { ownerLogin: conversation.ownerLogin } : {}) };
        let seen = this.notified.get(conversation.id);
        for (const segment of last.segments) {
            if (segment.type !== 'tool' || !segment.finished || !segment.toolUseId || seen?.has(segment.toolUseId)) {
                continue;
            }
            if (!seen) {
                seen = new Set<string>();
                this.notified.set(conversation.id, seen);
            }
            seen.add(segment.toolUseId);
            if (seen.size > MAX_TRACKED_TOOL_IDS_PER_CONVERSATION) {
                seen.delete(seen.values().next().value!);
            }
            if (!this.hooks.hasHooks(context, 'PostToolUse', segment.name)) {
                continue;
            }
            this.hooks.firePostToolUse(
                { ...context, sessionId: conversation.id },
                segment.name,
                this.parseArgs(segment),
                segment.result ?? '',
                segment.toolUseId,
            );
        }
    }

    protected parseArgs(segment: QaapToolSegment): unknown {
        try {
            const parsed = JSON.parse(segment.args);
            return parsed && typeof parsed === 'object' ? parsed : { value: parsed };
        } catch {
            return { raw: segment.args };
        }
    }
}
