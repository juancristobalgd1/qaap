// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentConversationDTO, QaapAgentMessageDTO, QaapContextCompactionDTO } from '../common/qaap-agent-conversation-client';
import { MobileProjectsTranscriptMessagesRenderUi } from './mobile-projects-transcript-messages-render-ui';

const COMPACTION_SELECTOR = '.theia-mobile-agent-transcript-context-compaction';
const SEAM_SELECTOR = '.theia-mobile-agent-transcript-compaction-seam';
const MESSAGE_SELECTOR = '.theia-mobile-agent-transcript-msg';

// A no-op tool UI is enough: the boundary rows in these tests are empty-content agent messages, so
// createTranscriptMessageRowAtIndex takes the plain-row path (renderTranscriptRichContent only) and
// never reaches the segments/artifacts renderer that would drag in @lumino.
const noopToolUi = { renderTranscriptRichContent(): void { /* no-op */ } };

class TestRenderUi extends MobileProjectsTranscriptMessagesRenderUi {
    constructor() {
        super(
            { transcriptLastRenderedConversationId: undefined, transcriptLastRenderedMessageId: undefined } as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            noopToolUi as never,
        );
    }

    boundaryIndex(conv: QaapAgentConversationDTO): number | undefined {
        return this.transcriptContextCompactionBoundaryIndex(conv);
    }
}

function message(id: string, role: QaapAgentMessageDTO['role'], content = `msg-${id}`): QaapAgentMessageDTO {
    return { id, role, content, createdAt: 0 };
}

function conversation(
    messages: QaapAgentMessageDTO[],
    compaction: QaapContextCompactionDTO | undefined,
    status: QaapAgentConversationDTO['status'] = 'settled',
): QaapAgentConversationDTO {
    return {
        id: 'conv-1',
        cwd: '/work',
        agentId: 'agent-1',
        title: 'Test',
        status,
        createdAt: 0,
        updatedAt: 1,
        messages,
        contextCompaction: compaction,
    };
}

function completeCompaction(compactedMessageCount: number, sourceMessageCount: number): QaapContextCompactionDTO {
    return { status: 'complete', startedAt: 0, completedAt: 1, compactedMessageCount, sourceMessageCount };
}

function runningCompaction(compactedMessageCount: number, sourceMessageCount: number): QaapContextCompactionDTO {
    return { status: 'running', startedAt: 0, compactedMessageCount, sourceMessageCount };
}

describe('qaap-transcript-context-compaction-seam', () => {
    let disableJSDOM: (() => void) | undefined;
    let render: TestRenderUi;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        render = new TestRenderUi();
    });

    describe('transcriptContextCompactionBoundaryIndex', () => {
        it('points at the first message that survived a completed compaction', () => {
            const conv = conversation(
                [message('a', 'user'), message('b', 'agent'), message('c', 'user'), message('d', 'agent')],
                completeCompaction(2, 4),
            );
            expect(render.boundaryIndex(conv)).to.equal(2);
        });

        it('is undefined while compaction is still running', () => {
            const conv = conversation(
                [message('a', 'user'), message('b', 'agent'), message('c', 'user')],
                runningCompaction(1, 3),
                'streaming',
            );
            expect(render.boundaryIndex(conv)).to.equal(undefined);
        });

        it('is undefined when nothing was compacted', () => {
            const conv = conversation([message('a', 'user'), message('b', 'agent')], completeCompaction(0, 2));
            expect(render.boundaryIndex(conv)).to.equal(undefined);
        });

        it('anchors to the first visible message when compacted messages were trimmed from the live list', () => {
            const conv = conversation([message('a', 'user'), message('b', 'agent')], completeCompaction(2, 2));
            expect(render.boundaryIndex(conv)).to.equal(0);
        });

        it('is undefined when there is no compaction at all', () => {
            const conv = conversation([message('a', 'user'), message('b', 'agent')], undefined);
            expect(render.boundaryIndex(conv)).to.equal(undefined);
        });
    });

    describe('buildTranscriptVirtualFooter', () => {
        it('keeps the live shimmer in the footer while compaction is running', () => {
            // Last message is an agent turn so the streaming-activity branch (which needs the
            // artifacts UI) is skipped; only the compaction row should be present.
            const conv = conversation(
                [message('a', 'user'), message('b', 'agent')],
                runningCompaction(1, 2),
                'streaming',
            );
            const footers = render.buildTranscriptVirtualFooter(conv);
            expect(footers.some(node => node.matches(COMPACTION_SELECTOR))).to.equal(true);
        });

        it('does NOT render the completed seam in the footer (it is inlined at the boundary)', () => {
            const conv = conversation(
                [message('a', 'user'), message('b', 'agent'), message('c', 'user'), message('d', 'agent')],
                completeCompaction(2, 4),
            );
            const footers = render.buildTranscriptVirtualFooter(conv);
            expect(footers.some(node => node.matches(COMPACTION_SELECTOR))).to.equal(false);
        });
    });

    describe('createTranscriptMessageRowAtIndex', () => {
        it('glues the completed seam above the first surviving message', () => {
            const conv = conversation(
                [message('a', 'agent', ''), message('b', 'agent', ''), message('c', 'agent', ''), message('d', 'agent', '')],
                completeCompaction(2, 4),
            );

            const boundaryRow = render.createTranscriptMessageRowAtIndex(conv, 2);
            expect(boundaryRow.matches(SEAM_SELECTOR)).to.equal(true);
            // Seam marker first, message second — so "everything above" reads as compacted.
            expect(boundaryRow.firstElementChild?.matches(COMPACTION_SELECTOR)).to.equal(true);
            expect(boundaryRow.lastElementChild?.matches(MESSAGE_SELECTOR)).to.equal(true);
            expect(boundaryRow.querySelector(COMPACTION_SELECTOR)?.textContent).to.contain('Context automatically compacted');
        });

        it('glues the completed seam above the first visible message after trimming', () => {
            const conv = conversation(
                [message('a', 'agent', ''), message('b', 'agent', '')],
                completeCompaction(2, 2),
            );

            const firstRow = render.createTranscriptMessageRowAtIndex(conv, 0);
            expect(firstRow.matches(SEAM_SELECTOR)).to.equal(true);
            expect(firstRow.firstElementChild?.matches(COMPACTION_SELECTOR)).to.equal(true);
            expect(firstRow.lastElementChild?.matches(MESSAGE_SELECTOR)).to.equal(true);
            expect(firstRow.querySelector(COMPACTION_SELECTOR)?.textContent).to.contain('Context automatically compacted');
        });

        it('leaves non-boundary messages unwrapped', () => {
            const conv = conversation(
                [message('a', 'agent', ''), message('b', 'agent', ''), message('c', 'agent', ''), message('d', 'agent', '')],
                completeCompaction(2, 4),
            );

            const plainRow = render.createTranscriptMessageRowAtIndex(conv, 3);
            expect(plainRow.matches(SEAM_SELECTOR)).to.equal(false);
            expect(plainRow.querySelector(COMPACTION_SELECTOR)).to.equal(null);
        });
    });
});
