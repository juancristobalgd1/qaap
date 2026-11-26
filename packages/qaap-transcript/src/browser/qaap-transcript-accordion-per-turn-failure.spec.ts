// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

// Regression guard (desktop QA, 26 Nov 2026): a conversation whose first turn failed (Claude Code's
// weekly limit) painted every later, successful turn's process accordion "Failed after {0}", because
// the accordion was created from the conversation-wide error flag instead of the turn's own message.

import { expect } from 'chai';
import { Disposable } from '@theia/core/lib/common/disposable';
import * as markdownit from '@theia/core/shared/markdown-it';
import type { QaapAgentConversationDTO, QaapAgentMessageSegmentDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { MobileProjectsTranscriptMessagesArtifactsUi } from './mobile-projects-transcript-messages-artifacts-ui';
import { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import { MobileProjectsTranscriptMessagesResolversUi } from './mobile-projects-transcript-messages-resolvers-ui';
import { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import { findMobileProcessAccordion } from './qaap-execution-event-timeline';

disableImportJSDOM();

describe('qaap transcript process accordion reflects its own turn, not the conversation', () => {
    let disableJSDOM: (() => void) | undefined;
    before(() => { disableJSDOM = enableJSDOM(); });
    after(() => { disableJSDOM?.(); disableJSDOM = undefined; });

    function createArtifactsUi(): MobileProjectsTranscriptMessagesArtifactsUi {
        const host = {
            transcriptLastConv: undefined,
            transcriptUserScrollPinDispose: Disposable.NULL,
            transcriptLiveUi: {
                refreshTranscriptApprovals: async () => undefined,
                hasPendingTranscriptToolApproval: () => false,
            },
            projectRowsUi: { localizeActivityLabel: (label: string) => label },
            transcriptMarkdownIt: markdownit({ linkify: false }),
        } as unknown as MobileProjectsTranscriptMessagesHost;
        const contentUi = new MobileProjectsTranscriptMessagesContentUi(host as never);
        const resolversUi = new MobileProjectsTranscriptMessagesResolversUi(host as never, contentUi);
        const toolUi = new MobileProjectsTranscriptMessagesToolUi(host as never, contentUi, resolversUi);
        return new MobileProjectsTranscriptMessagesArtifactsUi(host, contentUi, resolversUi, toolUi);
    }

    const okSegments: QaapAgentMessageSegmentDTO[] = [
        { type: 'tool', name: 'Read', toolUseId: 't1', args: JSON.stringify({ path: 'public/index.html' }), result: 'ok', finished: true },
        { type: 'text', content: 'Updated the h1.' },
    ];

    function conversation(): QaapAgentConversationDTO {
        return {
            id: 'c1', cwd: '/tmp', agentId: 'pi', status: 'idle', updatedAt: Date.now(),
            messages: [
                { id: 'u1', role: 'user', content: 'Change the h1' },
                { id: 'a1', role: 'agent', content: 'You have hit your weekly limit', error: 'The agent stopped unexpectedly.' },
                { id: 'u2', role: 'user', content: 'Change the h1' },
                { id: 'a2', role: 'agent', content: '', segments: okSegments },
            ],
        } as unknown as QaapAgentConversationDTO;
    }

    it('a successful turn after a failed one is not labelled failed', () => {
        const ui = createArtifactsUi();
        const conv = conversation();
        const row = ui.createTranscriptAgentSegmentsRow(okSegments, undefined, conv, { streaming: false, message: conv.messages[3] });
        const accordion = findMobileProcessAccordion(row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments')!)!;
        expect(accordion.classList.contains('theia-mod-error')).to.equal(false);
        expect(accordion.querySelector('summary')?.textContent ?? '').to.not.match(/Failed/);
    });

    it('the failed turn itself is still labelled failed', () => {
        const ui = createArtifactsUi();
        const conv = conversation();
        const failed = { ...conv.messages[1], segments: okSegments };
        const row = ui.createTranscriptAgentSegmentsRow(okSegments, failed.error, conv, { streaming: false, message: failed });
        const accordion = findMobileProcessAccordion(row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments')!)!;
        expect(accordion.classList.contains('theia-mod-error')).to.equal(true);
    });
});
