// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

/** Exposes the shared loop-spawn budget helpers (no disk / DI needed for these). */
class TestConversationStore extends QaapAgentConversationStore {
    protected autoMessageSequence = 0;

    protected override async persist(): Promise<void> { /* no-op */ }
    protected override async restoreFromDisk(): Promise<void> { /* no-op */ }
    protected override startTurnWatchdog(): void { /* no-op */ }

    protected override postAutoContinueMessage(
        conversationId: string,
        content: string,
        conv: QaapAgentConversation,
        rootUserMessageId: string,
        _turnAgentId: string,
        _turnAgentModel: QaapAgentMessage['turnAgentModel'],
    ): QaapAgentConversation {
        this.autoMessageSequence += 1;
        const userMessage: QaapAgentMessage = {
            id: `auto-user-${this.autoMessageSequence}`,
            role: 'user',
            content,
            createdAt: this.autoMessageSequence * 2,
            autoContinueRootMessageId: rootUserMessageId,
        };
        const agentMessage: QaapAgentMessage = {
            id: `auto-agent-${this.autoMessageSequence}`,
            role: 'agent',
            content: 'Created the Vite project.',
            createdAt: this.autoMessageSequence * 2 + 1,
            segments: [{
                type: 'tool',
                toolUseId: `tool-${this.autoMessageSequence}`,
                name: 'Bash',
                args: JSON.stringify({ command: 'npm create vite@latest app -- --template react-ts' }),
                finished: true,
            }],
        };
        const next = {
            ...conv,
            status: 'idle' as const,
            updatedAt: agentMessage.createdAt,
            messages: [...conv.messages, userMessage, agentMessage],
        };
        this.conversations.set(conversationId, next);
        return next;
    }

    hasBudget(id: string): boolean {
        return (this as unknown as { hasLoopSpawnBudget(id: string): boolean }).hasLoopSpawnBudget(id);
    }

    record(id: string): void {
        (this as unknown as { recordLoopSpawn(id: string): void }).recordLoopSpawn(id);
    }

    seed(conversation: QaapAgentConversation): void {
        this.conversations.set(conversation.id, conversation);
    }

    continueLatestTurn(conversationId: string): QaapAgentConversation {
        const conversation = this.conversations.get(conversationId)!;
        const userMessage = [...conversation.messages].reverse().find(message => message.role === 'user')!;
        const agentMessage = [...conversation.messages].reverse().find(message => message.role === 'agent')!;
        this.maybeAutoContinueIncompleteTurn(
            conversationId,
            conversation,
            userMessage.id,
            agentMessage.id,
            userMessage.turnAgentId ?? conversation.agentId,
        );
        return this.conversations.get(conversationId)!;
    }
}

describe('QaapAgentConversationStore shared loop-spawn budget (#12)', () => {
    it('allows re-spawns up to the ceiling, then denies further ones for that user message', () => {
        const store = new TestConversationStore();
        const id = 'user-msg-1';
        let spawns = 0;
        // Drain the budget the way the two loops would: check-then-record.
        while (store.hasBudget(id)) {
            store.record(id);
            spawns += 1;
            if (spawns > 20) {
                break; // safety: must not be unbounded
            }
        }
        expect(spawns).to.be.greaterThan(0);
        expect(spawns).to.be.lessThan(20);
        expect(store.hasBudget(id)).to.equal(false);
    });

    it('scopes the budget per user message (one exhausted turn does not starve another)', () => {
        const store = new TestConversationStore();
        while (store.hasBudget('user-msg-a')) {
            store.record('user-msg-a');
        }
        expect(store.hasBudget('user-msg-a')).to.equal(false);
        expect(store.hasBudget('user-msg-b')).to.equal(true);
    });

    it('keeps generated continuations on one persisted root budget and preserves the original topic', () => {
        const store = new TestConversationStore();
        const prompt = 'Crea una landing page moderna para vinos Rioja, responsive, con hero, productos destacados, '
            + 'sección de historia, formulario de contacto y diseño premium.';
        const conversation: QaapAgentConversation = {
            id: 'conversation-1',
            cwd: '/tmp/rioja',
            agentId: 'qaiq',
            title: 'Rioja landing page',
            status: 'idle',
            createdAt: 0,
            updatedAt: 1,
            messages: [
                { id: 'root-user', role: 'user', content: prompt, createdAt: 0 },
                {
                    id: 'root-agent',
                    role: 'agent',
                    content: 'Created the Vite project.',
                    createdAt: 1,
                    segments: [{
                        type: 'tool',
                        toolUseId: 'root-tool',
                        name: 'Bash',
                        args: JSON.stringify({ command: 'npm create vite@latest app -- --template react-ts' }),
                        finished: true,
                    }],
                },
            ],
        };
        store.seed(conversation);

        store.continueLatestTurn(conversation.id);
        store.continueLatestTurn(conversation.id);
        const settled = store.continueLatestTurn(conversation.id);

        const generated = settled.messages.filter(message => message.role === 'user' && message.autoContinueRootMessageId);
        expect(generated).to.have.length(2);
        expect(generated.map(message => message.autoContinueRootMessageId)).to.deep.equal(['root-user', 'root-user']);
        expect(generated[1].content).to.equal(generated[0].content);
        expect(generated.every(message => /hero/i.test(message.content))).to.equal(true);
        expect(generated.some(message => /Topic:\s*continue/i.test(message.content))).to.equal(false);
    });
});
