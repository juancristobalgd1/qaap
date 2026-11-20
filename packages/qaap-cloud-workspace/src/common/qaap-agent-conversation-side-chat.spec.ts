// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    toConversationSummary,
    type QaapAgentConversation,
} from './qaap-agent-conversation';
import {
    buildSideChatContextPreamble,
    composeSideChatPrompt,
    parseSideChatContextPreamble,
    parseSideChatCreateFields,
    QAAP_SIDE_CHAT_CONTEXT_CHAR_LIMIT,
    QAAP_SIDE_CHAT_CONTEXT_PREAMBLE_MAX_LENGTH,
    sideChatVisibleTitle,
    stripSideChatPreamble,
    withoutSideChatPreamble,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-side-chat';

describe('qaap-agent-conversation-side-chat', () => {

    describe('parseSideChatCreateFields', () => {
        it('keeps the side chat origin and a well-formed parent id', () => {
            expect(parseSideChatCreateFields({ origin: 'side-chat', sideChatParentId: ' 0b1f-2c3d ' }))
                .to.deep.equal({ origin: 'side-chat', sideChatParentId: '0b1f-2c3d' });
        });

        it('creates the side chat without a parent when the parent id is malformed', () => {
            expect(parseSideChatCreateFields({ origin: 'side-chat', sideChatParentId: '../etc' })).to.deep.equal({ origin: 'side-chat' });
            expect(parseSideChatCreateFields({ origin: 'side-chat', sideChatParentId: 'x'.repeat(129) })).to.deep.equal({ origin: 'side-chat' });
        });

        it('never marks a plain conversation, even with a parent id', () => {
            expect(parseSideChatCreateFields({ sideChatParentId: '0b1f' })).to.deep.equal({});
            expect(parseSideChatCreateFields({ origin: 'subtask', sideChatParentId: '0b1f' })).to.deep.equal({});
            expect(parseSideChatCreateFields(undefined)).to.deep.equal({});
        });
    });

    describe('buildSideChatContextPreamble', () => {
        it('uses the parent title, its last user prompt and its last agent reply', () => {
            const preamble = buildSideChatContextPreamble({
                title: 'Fix login',
                messages: [
                    { role: 'user', text: 'first prompt' },
                    { role: 'agent', text: 'first reply' },
                    { role: 'user', text: 'second prompt' },
                    { role: 'agent', text: 'second reply' },
                ],
            });
            expect(preamble).to.contain('"Fix login"');
            expect(preamble).to.contain('second prompt');
            expect(preamble).to.contain('second reply');
            expect(preamble).to.not.contain('first prompt');
        });

        it('clips the context to the budget, marking the cut', () => {
            const long = 'a'.repeat(20_000);
            const preamble = buildSideChatContextPreamble({
                title: 'Long',
                messages: [{ role: 'user', text: long }, { role: 'agent', text: long }],
            })!;
            expect(preamble.length).to.be.at.most(QAAP_SIDE_CHAT_CONTEXT_CHAR_LIMIT);
            expect(preamble).to.contain('…');
        });

        it('has no preamble for a parent without any turn', () => {
            expect(buildSideChatContextPreamble({ title: 'Empty', messages: [] })).to.equal(undefined);
        });
    });

    describe('composeSideChatPrompt', () => {
        it('prepends the preamble to the first message only', () => {
            const first = composeSideChatPrompt('why does it fail?', 'Background', true);
            expect(first.startsWith('Background')).to.equal(true);
            expect(first.endsWith('why does it fail?')).to.equal(true);
            expect(composeSideChatPrompt('and now?', 'Background', false)).to.equal('and now?');
        });

        it('sends the bare message when there is no preamble', () => {
            expect(composeSideChatPrompt('  hi  ', undefined, true)).to.equal('hi');
        });
    });

    describe('conversation summary', () => {
        /** A stored record as an older build wrote it: no side chat fields at all. */
        const legacyRecord = {
            id: 'c-legacy', cwd: '/repo', agentId: 'claude', title: 'Old thread', status: 'idle',
            createdAt: 1, updatedAt: 2, messages: [],
        } as unknown as QaapAgentConversation;

        it('loads a record written before side chats, without the new fields', () => {
            const summary = toConversationSummary(legacyRecord);
            expect(summary.title).to.equal('Old thread');
            expect('origin' in summary).to.equal(false);
            expect('sideChatParentId' in summary).to.equal(false);
        });

        it('exposes the side chat origin and its parent on the summary', () => {
            const summary = toConversationSummary({ ...legacyRecord, origin: 'side-chat', sideChatParentId: '0b1f' });
            expect(summary.origin).to.equal('side-chat');
            expect(summary.sideChatParentId).to.equal('0b1f');
        });
    });

    describe('parseSideChatContextPreamble', () => {
        it('trims a background and treats a blank or missing one as no background', () => {
            expect(parseSideChatContextPreamble('  Background  ')).to.equal('Background');
            expect(parseSideChatContextPreamble('   ')).to.equal(undefined);
            expect(parseSideChatContextPreamble(undefined)).to.equal(undefined);
        });

        it('accepts a background up to the server limit and rejects one over it', () => {
            expect(parseSideChatContextPreamble('x'.repeat(QAAP_SIDE_CHAT_CONTEXT_PREAMBLE_MAX_LENGTH))).to.have.length(QAAP_SIDE_CHAT_CONTEXT_PREAMBLE_MAX_LENGTH);
            expect(() => parseSideChatContextPreamble('x'.repeat(QAAP_SIDE_CHAT_CONTEXT_PREAMBLE_MAX_LENGTH + 1))).to.throw(/longer than 8000/);
        });

        it('rejects a value that is not a string', () => {
            expect(() => parseSideChatContextPreamble(42)).to.throw(/must be a string/);
            expect(() => parseSideChatContextPreamble(null)).to.throw(/must be a string/);
        });
    });

    describe('stripSideChatPreamble', () => {
        const preamble = buildSideChatContextPreamble({
            title: 'Fix login',
            messages: [{ role: 'user', text: 'Make login work' }, { role: 'agent', text: 'Done' }],
        })!;

        it('returns the words of a prompt stored with its background in the text (older builds)', () => {
            expect(stripSideChatPreamble(composeSideChatPrompt('Why red?', preamble, true))).to.equal('Why red?');
        });

        it('removes a background nested inside another one', () => {
            const inner = composeSideChatPrompt('Why red?', preamble, true);
            const nested = `Background from the conversation "Side chat" this side chat was opened from. Use it only as context.\n\nLast user request:\n${inner}\n\nLast agent reply:\nHola`;
            expect(stripSideChatPreamble(`${nested}\n\n---\n\nresponde solo: ok`)).to.equal('responde solo: ok');
        });

        it('keeps a message without a background as it is', () => {
            expect(stripSideChatPreamble('Second question')).to.equal('Second question');
        });

        it('keeps a cut opening that has no separator, since no words survive it', () => {
            const cut = 'Background from the conversation "Fix lo';
            expect(stripSideChatPreamble(cut)).to.equal(cut);
        });
    });

    describe('sideChatVisibleTitle', () => {
        it('returns a title that is not a stored background unchanged', () => {
            expect(sideChatVisibleTitle('Why is the build red?')).to.equal('Why is the build red?');
        });

        it('takes the first user message words for a title that is a stored background', () => {
            const stored = composeSideChatPrompt('responde solo: ok', buildSideChatContextPreamble({
                title: 'Mockup', messages: [{ role: 'user', text: 'di hola' }, { role: 'agent', text: 'Hola' }],
            })!, true);
            expect(sideChatVisibleTitle(stored.slice(0, 60), stored)).to.equal('responde solo: ok');
        });

        it('has no title when a stored background leaves no words', () => {
            expect(sideChatVisibleTitle('Background from the conversation "Mo', undefined)).to.equal('');
        });

        it('cuts a long first message with an ellipsis', () => {
            const title = sideChatVisibleTitle('Background from the conversation "A"', `x ${'y'.repeat(200)}`);
            expect(title.length).to.equal(48);
            expect(title.endsWith('…')).to.equal(true);
        });
    });

    describe('withoutSideChatPreamble', () => {
        it('returns the same message when there is nothing to remove', () => {
            const agent = { role: 'agent', content: 'Done' };
            const plain = { role: 'user', content: 'Hello' };
            expect(withoutSideChatPreamble(agent)).to.equal(agent);
            expect(withoutSideChatPreamble(plain)).to.equal(plain);
        });

        it('shows only the words of a user message that carries a stored background', () => {
            const stored = { role: 'user', content: composeSideChatPrompt('why?', buildSideChatContextPreamble({
                title: 'Fix login', messages: [{ role: 'user', text: 'Make login work' }],
            }), true) };
            expect(withoutSideChatPreamble(stored).content).to.equal('why?');
        });
    });

    describe('buildSideChatContextPreamble with stored backgrounds', () => {
        it('does not quote an older background that sits inside the parent prompt', () => {
            const oldBackground = composeSideChatPrompt('di hola', buildSideChatContextPreamble({
                title: 'Mockup', messages: [{ role: 'user', text: 'a' }, { role: 'agent', text: 'b' }],
            }), true);
            const preamble = buildSideChatContextPreamble({
                title: 'Mockup', messages: [{ role: 'user', text: oldBackground }, { role: 'agent', text: 'Hola' }],
            })!;
            expect(preamble).to.contain('Last user request:\ndi hola');
            expect(preamble.split('Background from the conversation').length).to.equal(2);
        });

        it('falls back to a generic title when the parent title is a stored background', () => {
            const preamble = buildSideChatContextPreamble({
                title: 'Background from the conversation "Mo',
                messages: [{ role: 'user', text: 'Make it work' }],
            })!;
            expect(preamble).to.contain('"Untitled conversation"');
        });
    });

    describe('conversation summary title', () => {
        it('shows the user words, not the stored background, for an older side chat', () => {
            const stored = composeSideChatPrompt('responde solo: ok', buildSideChatContextPreamble({
                title: 'Mockup', messages: [{ role: 'user', text: 'di hola' }, { role: 'agent', text: 'Hola' }],
            })!, true);
            const legacy = {
                id: 'c-old', cwd: '/repo', agentId: 'opencode', title: stored.slice(0, 60), status: 'idle',
                createdAt: 1, updatedAt: 2, origin: 'side-chat', sideChatParentId: '0b1f',
                messages: [{ id: 'u1', role: 'user', content: stored, createdAt: 1 }],
            } as unknown as QaapAgentConversation;
            expect(toConversationSummary(legacy).title).to.equal('responde solo: ok');
        });
    });
});
