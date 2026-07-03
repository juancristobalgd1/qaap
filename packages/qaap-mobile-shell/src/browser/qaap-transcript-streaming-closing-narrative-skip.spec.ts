// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Regression guard: a closing-narrative text segment that the dedup /
// error-suppression logic deliberately SKIPS (duplicate closing block, or
// identical to `msg.error`) has no DOM host by design. Before the fix,
// `patchStreamingAgentTextSegments` treated that missing host as "must full
// re-render" and returned false on every streaming tick where the skipped
// segment's content grew — forcing a whole-row rebuild (a brand-new process
// accordion) ~once per SSE tick for the rest of the turn. The patch path must
// instead recognize the intentional skip and keep patching in place.

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import * as markdownit from '@theia/core/shared/markdown-it';
import type { QaapAgentConversationDTO, QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { MobileProjectsTranscriptMessagesArtifactsUi } from '../browser/mobile-projects-transcript-messages-artifacts-ui';
import { MobileProjectsTranscriptMessagesContentUi } from '../browser/mobile-projects-transcript-messages-content-ui';
import { MobileProjectsTranscriptMessagesResolversUi } from '../browser/mobile-projects-transcript-messages-resolvers-ui';
import { MobileProjectsTranscriptMessagesToolUi } from '../browser/mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesHost } from '../browser/mobile-projects-transcript-messages-ui';
import { findMobileProcessAccordion } from './qaap-execution-event-timeline';

describe('qaap streaming closing-narrative skip does not churn the process accordion', () => {
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

    function tool(id: string): QaapAgentMessageSegmentDTO {
        return { type: 'tool', name: 'Read', toolUseId: id, args: JSON.stringify({ path: `f-${id}.ts` }), result: 'ok', finished: true };
    }
    function text(content: string): QaapAgentMessageSegmentDTO {
        return { type: 'text', content };
    }
    function conv(segments: QaapAgentMessageSegmentDTO[], error?: string): QaapAgentConversationDTO {
        return {
            id: 'c1', cwd: '/tmp', agentId: 'codex', status: 'streaming', updatedAt: Date.now(),
            messages: [{ id: 'agent-1', role: 'agent', content: '', segments, error }],
        } as QaapAgentConversationDTO;
    }

    it('control: plain final-answer growth patches in place (no rebuild)', () => {
        const ui = createArtifactsUi();
        const prev = [tool('t1'), text('Answer')];
        const c = conv(prev);
        const row = ui.createTranscriptAgentSegmentsRow(prev, undefined, c, { streaming: true, message: c.messages[0] });
        const body = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments')!;
        const accordion = findMobileProcessAccordion(body)!;
        const patched = ui.patchStreamingAgentTextSegments(row, prev, [tool('t1'), text('Answer more')], c);
        expect(patched, 'plain growth patches in place').to.equal(true);
        expect(findMobileProcessAccordion(body), 'accordion identity preserved').to.equal(accordion);
    });

    it('a closing narrative that stays == msg.error (both grow in lockstep) keeps patching in place', () => {
        const ui = createArtifactsUi();
        let prev = [tool('t1'), text('Error: boom')];
        const c = conv(prev, 'boom');
        const row = ui.createTranscriptAgentSegmentsRow(prev, 'boom', c, { streaming: true, message: c.messages[0] });
        const body = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments')!;
        const accordion = findMobileProcessAccordion(body)!;
        expect(body.querySelector('[data-transcript-segment-index="1"]'), 'skipped error narrative has no DOM host').to.equal(null);
        for (let tick = 1; tick <= 10; tick++) {
            const grown = 'Error: boom' + '!'.repeat(tick);
            const next = [tool('t1'), text(grown)];
            // Fresh snapshot whose msg.error mirrors the grown text -> stays a dup.
            const tickConv = conv(next, 'boom' + '!'.repeat(tick));
            const patched = ui.patchStreamingAgentTextSegments(row, prev, next, tickConv);
            expect(patched, `tick ${tick}: intentional error-skip must not force a rebuild`).to.equal(true);
            prev = next;
        }
        expect(findMobileProcessAccordion(body), 'accordion identity preserved across ticks').to.equal(accordion);
    });

    it('a skipped duplicate closing narrative (both copies grow in lockstep) keeps patching in place', () => {
        const ui = createArtifactsUi();
        let prev = [tool('t1'), text('Wrapping up.'), text('Wrapping up.')];
        const c = conv(prev);
        const row = ui.createTranscriptAgentSegmentsRow(prev, undefined, c, { streaming: true, message: c.messages[0] });
        const body = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments')!;
        const accordion = findMobileProcessAccordion(body)!;
        for (let tick = 1; tick <= 10; tick++) {
            const grown = 'Wrapping up.' + '.'.repeat(tick);
            const patched = ui.patchStreamingAgentTextSegments(row, prev, [tool('t1'), text(grown), text(grown)], c);
            expect(patched, `tick ${tick}: duplicate-skip must not force a rebuild`).to.equal(true);
            prev = [tool('t1'), text(grown), text(grown)];
        }
        expect(findMobileProcessAccordion(body), 'accordion identity preserved across ticks').to.equal(accordion);
    });
});
