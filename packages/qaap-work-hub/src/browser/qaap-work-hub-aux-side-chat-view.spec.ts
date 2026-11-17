// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// The view touches the DOM only when constructed; keep jsdom off while the modules load.
const disableImportJSDOM = enableJSDOM();

import { Disposable } from '@theia/core/lib/common/disposable';
import { expect } from 'chai';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapLiveFeedFrame } from '@theia/qaap-shared-core/lib/common/qaap-live-feed-cursor';
import {
    QaapWorkHubAuxSideChatView,
    type QaapWorkHubAuxSideChatApi,
    type QaapWorkHubAuxSideChatHost,
    type QaapWorkHubSideChatComposerSelection,
    type QaapWorkHubSideChatModelOption,
    type QaapWorkHubSideChatParent,
} from './qaap-work-hub-aux-side-chat-view';

disableImportJSDOM();

describe('qaap-work-hub-aux-side-chat-view', () => {

    let disableJSDOM: (() => void) | undefined;
    const views: QaapWorkHubAuxSideChatView[] = [];

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    afterEach(() => {
        views.splice(0).forEach(view => view.dispose());
        document.body.innerHTML = '';
    });

    const parent: QaapWorkHubSideChatParent = {
        id: 'parent-1', title: 'Fix login', cwd: '/workspace/repos/users/alice/o/r', agentId: 'opencode',
    };

    const models: QaapWorkHubSideChatModelOption[] = [
        { agentId: 'opencode', agentLabel: 'OpenCode', modelLabel: 'Beam Free', tier: 'free', session: 'signed-out', agentModel: { provider: 'openai', vendor: 'openai', modelId: 'beam-free' } },
        { agentId: 'opencode', agentLabel: 'OpenCode', modelLabel: 'Beam Pro', tier: 'pro', session: 'signed-out', agentModel: { provider: 'openai', vendor: 'openai', modelId: 'beam-pro' } },
    ];

    function conversation(id: string, messages: QaapAgentConversationDTO['messages'], status: QaapAgentConversationDTO['status'] = 'settled'): QaapAgentConversationDTO {
        return { id, cwd: parent.cwd, agentId: 'opencode', title: id, status, messages } as unknown as QaapAgentConversationDTO;
    }

    function harness(options: {
        messages?: QaapAgentConversationDTO['messages'];
        composer?: QaapWorkHubSideChatComposerSelection;
        models?: readonly QaapWorkHubSideChatModelOption[];
        /** Replaces the stored conversations (the parent and any chain above it). */
        conversations?: QaapAgentConversationDTO[];
    } = {}): {
        view: QaapWorkHubAuxSideChatView;
        calls: { create: unknown[]; post: unknown[]; get: string[]; remove: string[]; opened: string[]; signIns: string[]; closed: number; titles: Array<string | undefined>; listeners: Array<(frame: QaapLiveFeedFrame) => void>; live: number };
        setConversation: (dto: QaapAgentConversationDTO) => void;
    } {
        const initial: QaapAgentConversationDTO[] = options.conversations ?? [conversation(parent.id, [
            { id: 'p1', role: 'user', content: 'Make login work', createdAt: 1 },
            { id: 'p2', role: 'agent', content: 'Done', createdAt: 2 },
        ] as unknown as QaapAgentConversationDTO['messages'])];
        const conversations = new Map<string, QaapAgentConversationDTO>(initial.map(dto => [dto.id, dto] as [string, QaapAgentConversationDTO]));
        const calls = { create: [] as unknown[], post: [] as unknown[], get: [] as string[], remove: [] as string[], opened: [] as string[], signIns: [] as string[], closed: 0, titles: [] as Array<string | undefined>, listeners: [] as Array<(frame: QaapLiveFeedFrame) => void>, live: 0 };
        const api: QaapWorkHubAuxSideChatApi = {
            create: async body => {
                calls.create.push(body);
                const created = conversation('side-1', options.messages ?? []);
                conversations.set('side-1', created);
                return created;
            },
            post: async (id, content, postOptions) => {
                calls.post.push({ id, content, postOptions });
                return {};
            },
            get: async id => {
                calls.get.push(id);
                const dto = conversations.get(id);
                if (!dto) {
                    throw new Error('Conversation not found.');
                }
                return dto;
            },
            remove: async id => {
                calls.remove.push(id);
            },
        };
        const host: QaapWorkHubAuxSideChatHost = {
            resolveParent: () => parent,
            resolveComposerSelection: () => options.composer,
            listModels: async () => options.models ?? models,
            startSignIn: agentId => { calls.signIns.push(agentId); },
            openInMainArea: async id => { calls.opened.push(id); },
            subscribeLive: onFrame => {
                calls.live += 1;
                calls.listeners.push(onFrame);
                return Disposable.create(() => { calls.live -= 1; });
            },
        };
        const view = new QaapWorkHubAuxSideChatView({
            host,
            api,
            onTitle: title => { calls.titles.push(title); },
            onClose: () => { calls.closed += 1; },
            refreshMs: 0,
        });
        views.push(view);
        document.body.append(view.element);
        view.show();
        return {
            view,
            calls,
            // Stands for the live feed: a stored change reaches the view as a frame of its conversation.
            setConversation: dto => {
                conversations.set(dto.id, dto);
                calls.listeners.forEach(listener => listener({ type: 'message', conversationId: dto.id }));
            },
        };
    }

    const q = (view: QaapWorkHubAuxSideChatView, selector: string): HTMLElement => view.element.querySelector(selector) as HTMLElement;
    const bubbles = (view: QaapWorkHubAuxSideChatView): string[] => Array.from(view.element.querySelectorAll('.qaap-work-hub-aux-side-chat-message.is-user'))
        .map(element => element.textContent ?? '');

    async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
        const started = Date.now();
        while (!predicate()) {
            if (Date.now() - started > timeout) {
                throw new Error('timed out waiting for the side chat');
            }
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    }

    async function sendText(view: QaapWorkHubAuxSideChatView, text: string): Promise<void> {
        (q(view, 'textarea') as HTMLTextAreaElement).value = text;
        await view.send();
    }

    it('creates the side chat with its origin, the parent and the parent cwd, and the context in the first prompt only', async () => {
        const h = harness({ messages: [{ id: 'u1', role: 'user', content: 'x', createdAt: 1 }] as unknown as QaapAgentConversationDTO['messages'] });
        await sendText(h.view, 'Why is the build red?');
        expect(h.calls.create).to.have.length(1);
        const body = h.calls.create[0] as { origin: string; sideChatParentId: string; cwd: string; message: string; contextPreamble?: string };
        expect(body.origin).to.equal('side-chat');
        expect(body.sideChatParentId).to.equal('parent-1');
        expect(body.cwd).to.equal(parent.cwd);
        // The user's words are the message; the background travels in its own field, never in the text.
        expect(body.message).to.equal('Why is the build red?');
        expect(body.contextPreamble).to.contain('Background from the conversation "Fix login"');
        expect(body.contextPreamble).to.contain('Make login work');
        expect(h.view.conversation).to.equal('side-1');
        expect(h.calls.titles).to.deep.equal(['Why is the build red?']);
    });

    it('sends later messages to the created conversation with the bare text', async () => {
        const h = harness();
        await sendText(h.view, 'First');
        await sendText(h.view, 'Second');
        expect(h.calls.create).to.have.length(1);
        expect(h.calls.post).to.have.length(1);
        expect((h.calls.post[0] as { id: string; content: string }).id).to.equal('side-1');
        expect((h.calls.post[0] as { content: string }).content).to.equal('Second');
    });

    it('shows the user words, never the preamble, in the bubble of the stored first message', async () => {
        const h = harness();
        await sendText(h.view, 'Why is the build red?');
        const stored = (h.calls.create[0] as { message: string }).message;
        expect(stored).to.equal('Why is the build red?');
        h.setConversation(conversation('side-1', [
            { id: 'u1', role: 'user', content: stored, createdAt: 1 },
            { id: 'a1', role: 'agent', content: 'Because of the lock.', createdAt: 2 },
        ] as unknown as QaapAgentConversationDTO['messages'], 'settled'));
        await waitFor(() => h.view.element.querySelector('.qaap-work-hub-aux-side-chat-message.is-agent') !== null);
        expect(bubbles(h.view).join('\n')).to.not.contain('Background from the conversation');
        expect(bubbles(h.view)).to.deep.equal(['Why is the build red?']);
        expect(q(h.view, '.qaap-work-hub-aux-side-chat-message.is-agent').textContent).to.contain('Because of the lock.');
    });

    it('isolates the side chat: sending never opens or changes the main conversation', async () => {
        const h = harness();
        await sendText(h.view, 'Quick question');
        await waitFor(() => h.calls.get.length > 0);
        expect(h.calls.opened).to.deep.equal([]);
        expect(h.calls.remove).to.deep.equal([]);
    });

    it('shows the parent context line and the working status while the agent runs', async () => {
        const h = harness();
        expect(q(h.view, '.qaap-work-hub-aux-side-chat-context').textContent).to.contain('Fix login');
        await sendText(h.view, 'Run it');
        h.setConversation(conversation('side-1', [
            { id: 'u1', role: 'user', content: 'Run it', createdAt: 1 },
            { id: 'a1', role: 'agent', content: 'Running', createdAt: 2, runActive: true },
        ] as unknown as QaapAgentConversationDTO['messages'], 'streaming'));
        await waitFor(() => q(h.view, '.qaap-work-hub-aux-side-chat-status').textContent !== '');
        expect(q(h.view, '.qaap-work-hub-aux-side-chat-status').textContent).to.contain('Working');
    });

    it('counts the tool calls of a turn on the "Used N tools" line', async () => {
        const h = harness();
        await sendText(h.view, 'Look around');
        h.setConversation(conversation('side-1', [
            { id: 'u1', role: 'user', content: 'Look around', createdAt: 1 },
            {
                id: 'a1', role: 'agent', content: 'Done', createdAt: 2,
                traceEvents: [{ type: 'tool_call' }, { type: 'tool_call' }, { type: 'thought' }],
            },
        ] as unknown as QaapAgentConversationDTO['messages']));
        await waitFor(() => h.view.element.querySelector('.is-agent .qaap-work-hub-aux-side-chat-message-meta')?.textContent === 'Used 2 tools');
    });

    it('reads the conversation only for live frames of its own id', async () => {
        const h = harness();
        await sendText(h.view, 'Hello');
        await waitFor(() => h.calls.get.includes('side-1'));
        const before = h.calls.get.length;
        h.calls.listeners.forEach(listener => listener({ type: 'message', conversationId: 'someone-else' }));
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(h.calls.get.length).to.equal(before);
        h.calls.listeners.forEach(listener => listener({ type: 'message', conversationId: 'side-1' }));
        await waitFor(() => h.calls.get.length > before);
    });

    it('Bring back opens the conversation in the main area and closes the tab', async () => {
        const h = harness();
        await sendText(h.view, 'Keep this');
        await waitFor(() => !(q(h.view, '.qaap-work-hub-aux-side-chat-bring-back') as HTMLButtonElement).disabled);
        (q(h.view, '.qaap-work-hub-aux-side-chat-bring-back') as HTMLButtonElement).click();
        await waitFor(() => h.calls.closed === 1);
        expect(h.calls.opened).to.deep.equal(['side-1']);
        expect(h.calls.remove).to.deep.equal([]);
    });

    it('deletes only after confirmation, then closes the tab', async () => {
        const h = harness();
        await sendText(h.view, 'Delete me');
        (q(h.view, '.qaap-work-hub-aux-side-chat-delete') as HTMLButtonElement).click();
        expect(q(h.view, '.qaap-work-hub-aux-side-chat-confirm').hidden).to.be.false;
        expect(h.calls.remove).to.deep.equal([]);
        (q(h.view, '.qaap-work-hub-aux-side-chat-confirm-cancel') as HTMLButtonElement).click();
        expect(q(h.view, '.qaap-work-hub-aux-side-chat-confirm').hidden).to.be.true;
        (q(h.view, '.qaap-work-hub-aux-side-chat-delete') as HTMLButtonElement).click();
        (q(h.view, '.qaap-work-hub-aux-side-chat-confirm-delete') as HTMLButtonElement).click();
        await waitFor(() => h.calls.closed === 1);
        expect(h.calls.remove).to.deep.equal(['side-1']);
    });

    it('closes with the close button without deleting the conversation', async () => {
        const h = harness();
        await sendText(h.view, 'Keep me');
        (q(h.view, '.qaap-work-hub-aux-side-chat-close') as HTMLButtonElement).click();
        expect(h.calls.closed).to.equal(1);
        expect(h.calls.remove).to.deep.equal([]);
        expect(h.calls.opened).to.deep.equal([]);
    });

    it('sends on Enter and keeps Shift+Enter for a new line', async () => {
        const h = harness();
        const input = q(h.view, 'textarea') as HTMLTextAreaElement;
        input.value = 'New line';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(h.calls.create).to.have.length(0);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await waitFor(() => h.calls.create.length === 1);
    });

    it('offers Sign in for a Pro model without a session and never selects it', async () => {
        const h = harness();
        await waitFor(() => (q(h.view, '.qaap-work-hub-aux-side-chat-model').textContent ?? '').includes('Beam Free'));
        (q(h.view, '.qaap-work-hub-aux-side-chat-model') as HTMLButtonElement).click();
        const rows = Array.from(h.view.element.querySelectorAll('.qaap-model-picker-row')) as HTMLElement[];
        const pro = rows.find(row => row.textContent?.includes('Beam Pro'));
        if (!pro) {
            throw new Error('the shared picker lists no Pro row');
        }
        pro.click();
        expect(h.calls.signIns).to.deep.equal(['opencode']);
        expect(q(h.view, '.qaap-work-hub-aux-side-chat-model').textContent).to.contain('Beam Free');
    });

    it('picks a model in its own picker and leaves the main composer selection alone', async () => {
        const signedIn: QaapWorkHubSideChatModelOption[] = [
            { agentId: 'opencode', agentLabel: 'OpenCode', modelLabel: 'Beam Free', tier: 'free', session: 'signed-in', agentModel: { provider: 'openai', vendor: 'openai', modelId: 'beam-free' } },
            { agentId: 'opencode', agentLabel: 'OpenCode', modelLabel: 'Other Free', tier: 'free', session: 'signed-in', agentModel: { provider: 'openai', vendor: 'openai', modelId: 'other-free' } },
        ];
        const composer = { agentId: 'opencode', agentModel: { provider: 'openai', vendor: 'openai', modelId: 'beam-free' } } as const;
        const h = harness({ models: signedIn, composer });
        await waitFor(() => (q(h.view, '.qaap-work-hub-aux-side-chat-model').textContent ?? '').includes('Beam Free'));
        (q(h.view, '.qaap-work-hub-aux-side-chat-model') as HTMLButtonElement).click();
        const other = (Array.from(h.view.element.querySelectorAll('.qaap-model-picker-row')) as HTMLElement[])
            .find(row => row.textContent?.includes('Other Free'));
        if (!other) {
            throw new Error('the shared picker lists no Other Free row');
        }
        other.click();
        expect(q(h.view, '.qaap-work-hub-aux-side-chat-model').textContent).to.contain('Other Free');
        expect(composer.agentModel.modelId).to.equal('beam-free');
        expect(h.view.element.querySelector('.qaap-model-picker')).to.equal(null);
    });

    it('uses the main composer classes for its card, input, model pill and send button', () => {
        const h = harness();
        expect(q(h.view, '.theia-mobile-projects-sticky-composer-card')).to.exist;
        expect(q(h.view, 'textarea.theia-mobile-projects-sticky-composer-input')).to.exist;
        expect(q(h.view, '.theia-mobile-projects-sticky-composer-agent.qaap-work-hub-aux-side-chat-model')).to.exist;
        expect(q(h.view, '.theia-mobile-projects-sticky-composer-send.qaap-work-hub-aux-side-chat-send')).to.exist;
    });

    describe('selector start', () => {
        const signedIn: QaapWorkHubSideChatModelOption[] = [
            {
                agentId: 'opencode', agentLabel: 'OpenCode', modelLabel: 'Beam Free', tier: 'free', session: 'signed-in',
                agentModel: { provider: 'openai', vendor: 'openai', modelId: 'beam-free' },
            },
            {
                agentId: 'opencode', agentLabel: 'OpenCode', modelLabel: 'Other Free', tier: 'free', session: 'signed-in',
                agentModel: { provider: 'openai', vendor: 'openai', modelId: 'other-free' },
            },
        ];

        it('starts from the main composer harness and model when the list has them', async () => {
            const composer = { agentId: 'opencode', agentModel: { provider: 'openai', vendor: 'openai', modelId: 'other-free' } } as const;
            const h = harness({ models: signedIn, composer });
            await waitFor(() => (q(h.view, '.qaap-work-hub-aux-side-chat-model').textContent ?? '').includes('Other Free'));
            await sendText(h.view, 'hello');
            expect((h.calls.create[0] as { agent: string; agentModel: { modelId: string } }).agent).to.equal('opencode');
            expect((h.calls.create[0] as { agentModel: { modelId: string } }).agentModel.modelId).to.equal('other-free');
        });

        it('starts from the parent harness when the composer has no model pinned', async () => {
            const h = harness({ models: signedIn });
            await waitFor(() => (q(h.view, '.qaap-work-hub-aux-side-chat-model').textContent ?? '').includes('Beam Free'));
        });
    });

    it('quotes the root of a chain of side chats, not the side chat it was opened from', async () => {
        const side = { ...conversation(parent.id, [
            { id: 's1', role: 'user', content: 'Earlier side question', createdAt: 3 },
            { id: 's2', role: 'agent', content: 'Earlier side answer', createdAt: 4 },
        ] as unknown as QaapAgentConversationDTO['messages']), title: 'Earlier side question', origin: 'side-chat', sideChatParentId: 'root-1' } as unknown as QaapAgentConversationDTO;
        const root = { ...conversation('root-1', [
            { id: 'p1', role: 'user', content: 'Make login work', createdAt: 1 },
            { id: 'p2', role: 'agent', content: 'Done', createdAt: 2 },
        ] as unknown as QaapAgentConversationDTO['messages']), title: 'Fix login' };
        const h = harness({ conversations: [side, root] });
        await sendText(h.view, 'Why now?');
        const body = h.calls.create[0] as { contextPreamble: string };
        expect(body.contextPreamble).to.contain('"Fix login"');
        expect(body.contextPreamble).to.contain('Make login work');
        expect(body.contextPreamble).to.not.contain('Earlier side');
        expect(h.calls.get).to.deep.equal(['parent-1', 'root-1']);
    });

    it('quotes a root title that is still a stored background by its first question, never by the background', async () => {
        const side = { ...conversation(parent.id, [
            { id: 's1', role: 'user', content: 'Earlier side question', createdAt: 3 },
        ] as unknown as QaapAgentConversationDTO['messages']), origin: 'side-chat', sideChatParentId: 'root-1' } as unknown as QaapAgentConversationDTO;
        const root = { ...conversation('root-1', [
            { id: 'p1', role: 'user', content: 'Make login work', createdAt: 1 },
            { id: 'p2', role: 'agent', content: 'Done', createdAt: 2 },
        ] as unknown as QaapAgentConversationDTO['messages']), title: 'Background from the conversation "Fi' };
        const h = harness({ conversations: [side, root] });
        await sendText(h.view, 'Why now?');
        const body = h.calls.create[0] as { contextPreamble: string };
        expect(body.contextPreamble).to.contain('"Make login work"');
        expect(body.contextPreamble).to.not.contain('"Background from the conversation');
    });

    it('disables the send button while the input is empty and enables it with text', () => {
        const h = harness();
        const send = q(h.view, '.qaap-work-hub-aux-side-chat-send') as HTMLButtonElement;
        expect(send.disabled).to.equal(true);
        const input = q(h.view, 'textarea') as HTMLTextAreaElement;
        const InputEvent = input.ownerDocument.defaultView!.Event;
        input.value = 'hi';
        input.dispatchEvent(new InputEvent('input'));
        expect(send.disabled).to.equal(false);
        expect(send.classList.contains('theia-mod-ready')).to.equal(true);
        input.value = '   ';
        input.dispatchEvent(new InputEvent('input'));
        expect(send.disabled).to.equal(true);
    });

    it('lays the composer out as the main composer does: the same wrapper, card, stage and input panel nesting', () => {
        const h = harness();
        const composer = q(h.view, '.qaap-work-hub-aux-side-chat-composer');
        expect(composer.classList.contains('theia-mobile-projects-sticky-composer-inner')).to.equal(true);
        expect(composer.querySelector(':scope > .theia-mobile-projects-sticky-composer-card > .theia-mobile-projects-sticky-composer-stage > .theia-mobile-projects-sticky-composer-input-panel')).to.exist;
        const panel = composer.querySelector('.theia-mobile-projects-sticky-composer-input-panel') as HTMLElement;
        expect(panel.querySelector(':scope > .theia-mobile-projects-sticky-composer-input-body > .theia-mobile-projects-sticky-composer-input-editor > textarea')).to.exist;
        expect(panel.querySelector(':scope > .theia-mobile-projects-sticky-composer-controls-row > .theia-mobile-projects-sticky-composer-controls-left > .theia-mobile-projects-sticky-composer-agent')).to.exist;
        expect(panel.querySelector(':scope > .theia-mobile-projects-sticky-composer-controls-row > .theia-mobile-projects-sticky-composer-controls-right .theia-mobile-projects-sticky-composer-send')).to.exist;
    });

    it('omits the access block from the picker footer, since a side chat has no approval policy', async () => {
        const h = harness({ models: [{ agentId: 'opencode', agentLabel: 'OpenCode', modelLabel: 'Beam Free', tier: 'free', session: 'signed-in', agentModel: { provider: 'openai', vendor: 'openai', modelId: 'beam-free' } }] });
        await waitFor(() => q(h.view, '.qaap-work-hub-aux-side-chat-model').textContent !== 'Model');
        (q(h.view, '.qaap-work-hub-aux-side-chat-model') as HTMLButtonElement).click();
        expect(h.view.element.querySelector('.qaap-model-picker')).to.exist;
        expect(h.view.element.querySelector('.qaap-model-picker-access')).to.equal(null);
    });
});
