// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentConversationDTO, QaapPendingUserMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectsTranscriptMessagesRenderUiContext, QaapQueuedMessageAction } from './mobile-projects-transcript-messages-render-ui-context';
import { createTranscriptQueuedMessageRowsExtracted } from './mobile-projects-transcript-messages-render-ui-render';

describe('mobile-projects-transcript-queued-message-row', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    const pending = {
        id: 'queued-1',
        content: 'hold this message',
        createdAt: 1,
        optimisticImagePreviews: [{ src: 'data:image/png;base64,AAAA', fileName: 'shot.png' }],
    } as QaapPendingUserMessageDTO;
    const conv = { id: 'conv-1', pendingUserMessages: [pending] } as unknown as QaapAgentConversationDTO;

    function createCtx(actions: [string, QaapPendingUserMessageDTO, QaapQueuedMessageAction][]): MobileProjectsTranscriptMessagesRenderUiContext {
        return {
            userUi: {
                createTranscriptUserImagePreviews: (previews: readonly { fileName: string }[]) => {
                    const list = document.createElement('div');
                    list.className = 'theia-mobile-agent-transcript-user-attachments';
                    list.textContent = previews.map(preview => preview.fileName).join(',');
                    return list;
                },
            },
            queuedMessageAction: async (conversationId: string, message: QaapPendingUserMessageDTO, action: QaapQueuedMessageAction) => {
                actions.push([conversationId, message, action]);
            },
        } as unknown as MobileProjectsTranscriptMessagesRenderUiContext;
    }

    function buttonFor(row: HTMLElement, label: string): HTMLButtonElement {
        const button = row.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
        expect(button, label).to.exist;
        return button!;
    }

    it('paints a queued message as a dashed user bubble with its attachments and actions', () => {
        const [row] = createTranscriptQueuedMessageRowsExtracted(createCtx([]), conv);

        expect(row.getAttribute('role')).to.equal('group');
        expect(row.getAttribute('aria-label')).to.equal('Queued message');
        const bubble = row.querySelector('.theia-mobile-agent-transcript-msg.theia-mod-user.theia-mod-queued');
        expect(bubble, 'dashed bubble').to.exist;
        expect(bubble!.textContent).to.contain('hold this message');
        expect(bubble!.querySelector('.theia-mobile-agent-transcript-user-attachments')!.textContent).to.equal('shot.png');
        expect(row.querySelector('.theia-mobile-agent-transcript-queued-actions')).to.exist;
        buttonFor(row, 'Send now');
        buttonFor(row, 'Edit queued message');
        buttonFor(row, 'Remove from queue');
    });

    it('routes Send now and Edit to the queued message action at once', () => {
        const actions: [string, QaapPendingUserMessageDTO, QaapQueuedMessageAction][] = [];
        const [row] = createTranscriptQueuedMessageRowsExtracted(createCtx(actions), conv);

        buttonFor(row, 'Send now').click();
        buttonFor(row, 'Edit queued message').click();

        expect(actions.map(([, , action]) => action)).to.deep.equal(['send', 'edit']);
        expect(actions[0][0]).to.equal('conv-1');
        expect(actions[0][1]).to.equal(pending);
    });

    it('leaves on Remove after the exit animation and then routes the remove action', async () => {
        const actions: [string, QaapPendingUserMessageDTO, QaapQueuedMessageAction][] = [];
        const [row] = createTranscriptQueuedMessageRowsExtracted(createCtx(actions), conv);

        buttonFor(row, 'Remove from queue').click();
        expect(row.classList.contains('theia-mod-leaving')).to.equal(true);
        expect(actions).to.have.length(0);

        await new Promise(resolve => setTimeout(resolve, 220));
        expect(actions.map(([, , action]) => action)).to.deep.equal(['remove']);
    });

    it('animates a queued message in only on its first paint', () => {
        const ctx = createCtx([]);
        const fresh = { id: 'conv-animate', pendingUserMessages: [{ ...pending, id: 'queued-animate' }] } as unknown as QaapAgentConversationDTO;
        const [first] = createTranscriptQueuedMessageRowsExtracted(ctx, fresh);
        const [repaint] = createTranscriptQueuedMessageRowsExtracted(ctx, fresh);

        expect(first.classList.contains('theia-mod-entering')).to.equal(true);
        expect(repaint.classList.contains('theia-mod-entering')).to.equal(false);
    });

    it('paints a queued auto-sent preview feedback as a collapsed chip, never its raw payload', () => {
        const feedback = {
            id: 'queued-feedback',
            createdAt: 2,
            content: [
                'The user attached the following context with this message. Use it to answer; do not claim nothing was provided.',
                '',
                '### previewFeedback: Preview feedback · 1 annotations · /?_qaap_cache_bust=1795010821889 · Desktop',
                '```',
                'Preview feedback annotations (compact context — not full DOM):',
                '',
                'Annotation 1:',
                '- Comment: make the delete button an icon',
                '- Route: /?_qaap_cache_bust=1795010821889',
                '- Selector: html > ul#list > li[0] > button',
                '- Element: <button>',
                '```',
                '',
                '---',
                '',
                'Please address the attached preview feedback.',
            ].join('\n'),
        } as QaapPendingUserMessageDTO;
        const chipCalls: { titles: string[]; collapsed?: boolean }[] = [];
        const ctx = {
            ...createCtx([]),
            userUi: {
                createTranscriptUserImagePreviews: () => document.createElement('div'),
                createTranscriptUserContextChips: (chips: readonly { title: string }[], options?: { collapsed?: boolean }) => {
                    chipCalls.push({ titles: chips.map(chip => chip.title), collapsed: options?.collapsed });
                    const list = document.createElement('div');
                    list.className = 'theia-mobile-agent-transcript-user-context-chips';
                    list.textContent = chips.map(chip => chip.title).join(',');
                    return list;
                },
            },
        } as unknown as MobileProjectsTranscriptMessagesRenderUiContext;
        const [row] = createTranscriptQueuedMessageRowsExtracted(ctx, {
            id: 'conv-feedback',
            pendingUserMessages: [feedback],
        } as unknown as QaapAgentConversationDTO);

        expect(chipCalls).to.deep.equal([{ titles: ['Preview feedback · 1 annotations · / · Desktop'], collapsed: true }]);
        const text = row.textContent ?? '';
        expect(text).to.contain('Please address the attached preview feedback.');
        for (const plumbing of ['_qaap_cache_bust', 'Selector', 'html > ul#list', 'The user attached the following context', '```']) {
            expect(text, plumbing).not.to.contain(plumbing);
        }
    });
});
