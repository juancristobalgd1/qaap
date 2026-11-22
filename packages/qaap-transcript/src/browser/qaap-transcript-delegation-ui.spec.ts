// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { TranscriptDelegationToolCall } from '../common/qaap-transcript-delegation-core';
import {
    createTranscriptDelegationToolCard,
    listTranscriptDelegationCalls,
    openTranscriptDelegationChild,
    TRANSCRIPT_DELEGATION_CHIP_CLASS,
} from './qaap-transcript-delegation-ui';

const DELEGATE = 'mcp__qaaq__qaaq_delegate';
const STATUS = 'mcp__qaaq__qaaq_task_status';

function delegateCall(toolUseId: string, childId: string, state = 'running', usage?: Record<string, unknown>): TranscriptDelegationToolCall {
    return {
        toolUseId,
        name: DELEGATE,
        args: '{"prompt":"x"}',
        result: JSON.stringify({ child: { childId, title: `Helper ${childId}`, state, isolation: 'worktree', agent: 'claude', model: 'sonnet', ...(usage ? { usage } : {}) } }),
    };
}

function statusCall(toolUseId: string, children: Array<Record<string, unknown>>): TranscriptDelegationToolCall {
    return { toolUseId, name: STATUS, result: JSON.stringify({ children, totals: {} }) };
}

function chips(card: HTMLElement): HTMLButtonElement[] {
    return Array.from(card.querySelectorAll<HTMLButtonElement>(`.${TRANSCRIPT_DELEGATION_CHIP_CLASS}`));
}

describe('qaap-transcript-delegation-ui', () => {
    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    describe('createTranscriptDelegationToolCard', () => {
        it('renders one chip per child with its state and cost', () => {
            const finished = delegateCall('t1', 'c1', 'completed', { inputTokens: 900, outputTokens: 100, costUsd: 0.12, source: 'reported' });
            const card = createTranscriptDelegationToolCard(document, finished, { calls: [finished] })!;
            const [chip] = chips(card);
            expect(chips(card)).to.have.length(1);
            expect(chip.dataset.childId).to.equal('c1');
            expect(chip.textContent).to.contain('Helper c1');
            expect(chip.textContent).to.contain('Done');
            expect(chip.textContent).to.contain('$0.12');
            expect(chip.className).to.contain(`${TRANSCRIPT_DELEGATION_CHIP_CLASS}-completed`);
        });

        it('shows no dollar amount for an unpriced child, but its tokens when known', () => {
            const call = delegateCall('t1', 'c1', 'completed', { inputTokens: 900, outputTokens: 100, source: 'none' });
            const card = createTranscriptDelegationToolCard(document, call, { calls: [call] })!;
            const [chip] = chips(card);
            expect(chip.textContent).to.not.contain('$');
            expect(chip.querySelector(`.${TRANSCRIPT_DELEGATION_CHIP_CLASS}-usage`)?.textContent).to.equal('1.0k');
        });

        it('takes the live state from the thread store over a stale snapshot', () => {
            const call = delegateCall('t1', 'c1', 'running');
            const card = createTranscriptDelegationToolCard(document, call, {
                calls: [call],
                liveStatus: id => id === 'c1' ? 'settled' : undefined,
            })!;
            expect(chips(card)[0].textContent).to.contain('Done');
        });

        it('uses the newest snapshot from a later status call', () => {
            const delegated = delegateCall('t1', 'c1', 'running');
            const later = statusCall('t2', [{ childId: 'c1', state: 'blocked', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.5, source: 'reported' } }]);
            const card = createTranscriptDelegationToolCard(document, delegated, { calls: [delegated, later] })!;
            expect(chips(card)[0].textContent).to.contain('Needs input');
            expect(chips(card)[0].textContent).to.contain('$0.50');
        });

        it('returns nothing while the call has no result, or for a non-delegation tool', () => {
            const pending: TranscriptDelegationToolCall = { toolUseId: 't1', name: DELEGATE, args: '{}' };
            expect(createTranscriptDelegationToolCard(document, pending, { calls: [pending] })).to.equal(undefined);
            const other: TranscriptDelegationToolCall = { toolUseId: 't2', name: 'Bash', result: '{}' };
            expect(createTranscriptDelegationToolCard(document, other, { calls: [other] })).to.equal(undefined);
        });

        it('shows the conversation summary once, on the first delegation call', () => {
            const first = delegateCall('t1', 'c1', 'completed', { inputTokens: 1, outputTokens: 1, costUsd: 0.1, source: 'reported' });
            const second = delegateCall('t2', 'c2', 'running');
            const calls = [first, second];
            const firstCard = createTranscriptDelegationToolCard(document, first, { calls })!;
            const secondCard = createTranscriptDelegationToolCard(document, second, { calls })!;
            expect(firstCard.querySelector('.theia-mobile-agent-delegation-summary')?.textContent).to.equal('2 helpers');
            expect(secondCard.querySelector('.theia-mobile-agent-delegation-summary')).to.equal(null); // eslint-disable-line no-null/no-null
        });

        it('shows the total cost only when every child is priced', () => {
            const priced = delegateCall('t1', 'c1', 'completed', { inputTokens: 1, outputTokens: 1, costUsd: 0.1, source: 'reported' });
            const unpriced = delegateCall('t2', 'c2', 'completed');
            const pricedCard = createTranscriptDelegationToolCard(document, priced, { calls: [priced, unpriced] })!;
            expect(pricedCard.querySelector('.theia-mobile-agent-delegation-summary')?.textContent).to.equal('2 helpers');

            const allPriced = delegateCall('t2', 'c2', 'completed', { inputTokens: 1, outputTokens: 1, costUsd: 0.25, source: 'reported' });
            const totalCard = createTranscriptDelegationToolCard(document, priced, { calls: [priced, allPriced] })!;
            expect(totalCard.querySelector('.theia-mobile-agent-delegation-summary')?.textContent).to.equal('2 helpers · $0.35');
        });

        it('calls openChild with the child id when a chip is tapped', () => {
            const call = delegateCall('t1', 'c9', 'running');
            const opened: string[] = [];
            const card = createTranscriptDelegationToolCard(document, call, { calls: [call], openChild: id => opened.push(id) })!;
            chips(card)[0].click();
            expect(opened).to.deep.equal(['c9']);
        });

        it('renders chips disabled when no openChild is given', () => {
            const call = delegateCall('t1', 'c1');
            const card = createTranscriptDelegationToolCard(document, call, { calls: [call] })!;
            expect(chips(card)[0].disabled).to.equal(true);
            expect(chips(card)[0].querySelector(`.${TRANSCRIPT_DELEGATION_CHIP_CLASS}-chevron`)).to.equal(null); // eslint-disable-line no-null/no-null
        });

        it('exposes accessible card, summary, running busy state, text states and chevron affordance', () => {
            const running = delegateCall('t1', 'c1', 'running', { inputTokens: 400, outputTokens: 200, costUsd: 0.04, source: 'reported' });
            const card = createTranscriptDelegationToolCard(document, running, {
                calls: [running],
                openChild: () => undefined,
            })!;
            expect(card.tagName).to.equal('SECTION');
            expect(card.getAttribute('aria-label')).to.equal('Helpers');
            const summary = card.querySelector('.theia-mobile-agent-delegation-summary');
            expect(summary?.getAttribute('aria-live')).to.equal('polite');

            const [chip] = chips(card);
            expect(chip.tagName).to.equal('BUTTON');
            expect(chip.type).to.equal('button');
            expect(chip.getAttribute('aria-busy')).to.equal('true');
            expect(chip.getAttribute('aria-label')).to.equal('Helper c1, Running, claude · sonnet, $0.04');
            expect(chip.title).to.equal('Open helper: Helper c1');
            const chevron = chip.querySelector(`.${TRANSCRIPT_DELEGATION_CHIP_CLASS}-chevron`);
            expect(chevron).to.not.equal(null); // eslint-disable-line no-null/no-null
            expect(chevron?.getAttribute('aria-hidden')).to.equal('true');

            const done = delegateCall('t2', 'c2', 'completed');
            const doneCard = createTranscriptDelegationToolCard(document, done, { calls: [done] })!;
            const [doneChip] = chips(doneCard);
            expect(doneChip.getAttribute('aria-busy')).to.equal(null); // eslint-disable-line no-null/no-null
            expect(doneChip.getAttribute('aria-label')).to.contain('Done');
            expect(doneChip.title).to.equal('Helper c2');
        });
    });

    describe('listTranscriptDelegationCalls', () => {
        it('keeps only tool segments, in order', () => {
            const calls = listTranscriptDelegationCalls([
                { segments: [{ type: 'text', content: 'hi' } as never, { type: 'tool', toolUseId: 'a', name: DELEGATE, args: '{}', finished: true, result: '{}' }] },
                { segments: [{ type: 'tool', toolUseId: 'b', name: STATUS, args: '{}', finished: true }] },
                {},
            ]);
            expect(calls.map(c => c.toolUseId)).to.deep.equal(['a', 'b']);
        });
    });

    describe('openTranscriptDelegationChild', () => {
        const project = { id: 'p1' } as unknown as MobileProjectEntry;
        const summary = { id: 'c1', title: 'Helper' } as unknown as QaapAgentConversationSummaryDTO;

        it('opens the child from the thread store through the host', async () => {
            const opened: Array<{ project: MobileProjectEntry; id: string }> = [];
            await openTranscriptDelegationChild({
                transcriptOpenProject: project,
                openConversationSummary: async (p, s) => { opened.push({ project: p, id: s.id }); },
                conversations: { threadStore: { getSummary: id => id === 'c1' ? summary : undefined } },
            }, 'c1');
            expect(opened).to.deep.equal([{ project, id: 'c1' }]);
        });

        it('does nothing without an open project or an opener', async () => {
            let called = false;
            await openTranscriptDelegationChild({
                openConversationSummary: async () => { called = true; },
                conversations: { threadStore: { getSummary: () => summary } },
            }, 'c1');
            expect(called).to.equal(false);
        });
    });
});
