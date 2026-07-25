// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { TranscriptFollowUpQueue } from '../common/qaap-transcript-follow-up-queue';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';

describe('mobile-projects-transcript-sticky-composer-ui queue send now', () => {

    // The composer module pulls @lumino/widgets, which reads `document` at load time — it can
    // only be required once JSDOM is up, so it is loaded here instead of at module scope.
    let composerModule: typeof import('./mobile-projects-transcript-sticky-composer-ui');

    before(() => {
        // Deliberately not torn down: sibling suites in this package enable JSDOM at module
        // scope (load time), so restoring the globals here would strip the document out from
        // under whichever spec file runs next.
        enableJSDOM();
        composerModule = require('./mobile-projects-transcript-sticky-composer-ui');
    });

    const project = { id: 'p1', name: 'demo' } as unknown as MobileProjectEntry;
    const summary = { id: 'c1', cwd: '/tmp/demo' } as unknown as QaapAgentConversationSummaryDTO;

    interface ConversationSubmit {
        readonly conversationId: string;
        readonly draft: string;
        readonly options: Record<string, unknown>;
    }

    interface SendNowProbe {
        readonly ui: MobileProjectsTranscriptStickyComposerUi;
        readonly queue: TranscriptFollowUpQueue;
        /** Messages posted into an existing conversation (the in-session path). */
        readonly conversationSubmits: ConversationSubmit[];
        /** Tasks that would have spawned a SEPARATE conversation — must stay empty. */
        readonly backgroundSubmits: string[];
        stopped: number;
    }

    /**
     * Exercises `sendQueuedFollowUpNow` without building the full composer host: only the
     * collaborators that path touches are stubbed on a prototype-backed instance.
     */
    function createProbe(options: {
        agentWorking: boolean;
        submitFails?: boolean;
    }): SendNowProbe {
        const queue = new TranscriptFollowUpQueue();
        const conversationSubmits: ConversationSubmit[] = [];
        const backgroundSubmits: string[] = [];
        const probe = {
            queue,
            conversationSubmits,
            backgroundSubmits,
            stopped: 0,
        } as unknown as SendNowProbe & { ui: MobileProjectsTranscriptStickyComposerUi };
        const ui = Object.create(
            composerModule.MobileProjectsTranscriptStickyComposerUi.prototype,
        ) as MobileProjectsTranscriptStickyComposerUi;
        // The host and the collaborators below are protected seams — reached through an
        // untyped view so the probe can stub them without subclassing the whole composer.
        const seam = ui as unknown as Record<string, unknown>;
        seam.host = {
            transcriptFollowUpQueue: queue,
            transcriptComposerAgentModel: undefined,
            messageService: { error: () => { } },
            submitTranscriptViaBackendConversation: async (
                _project: MobileProjectEntry,
                target: QaapAgentConversationSummaryDTO,
                draft: string,
                opts: Record<string, unknown>,
            ) => {
                if (options.submitFails) {
                    throw new Error('backend down');
                }
                conversationSubmits.push({ conversationId: target.id, draft, options: opts });
            },
            submitBackgroundAgentTask: async (_project: MobileProjectEntry, draft: string) => {
                backgroundSubmits.push(draft);
                return undefined;
            },
        };
        seam.isTranscriptStickyComposerAgentWorking = () => options.agentWorking;
        seam.refreshComposerActivityStack = () => { };
        seam.remountTranscriptStickyComposer = () => { };
        seam.stopOpenComposerAgentLikeComposerStop = () => { probe.stopped++; return true; };
        probe.ui = ui;
        return probe;
    }

    it('starts a peer run in the SAME conversation instead of cancelling the open turn', async () => {
        const probe = createProbe({ agentWorking: true });
        probe.queue.enqueue(summary.id, { draft: 'keep', selectedAgentId: 'a1' });
        probe.queue.enqueue(summary.id, { draft: 'run me', selectedAgentId: 'a2', modeId: 'm1' });

        await probe.ui.sendQueuedFollowUpNow(project, summary, 1);

        expect(probe.stopped).to.equal(0);
        // No second session: in-session multitasking posts into the open conversation.
        expect(probe.backgroundSubmits).to.deep.equal([]);
        expect(probe.conversationSubmits).to.have.length(1);
        expect(probe.conversationSubmits[0].conversationId).to.equal(summary.id);
        expect(probe.conversationSubmits[0].draft).to.equal('run me');
        expect(probe.conversationSubmits[0].options.parallel).to.equal(true);
        expect(probe.conversationSubmits[0].options.selectedAgentId).to.equal('a2');
        expect(probe.conversationSubmits[0].options.modeId).to.equal('m1');
        // Only the dispatched entry leaves the queue.
        expect(probe.queue.peek(summary.id).map(entry => entry.draft)).to.deep.equal(['keep']);
    });

    it('puts the message back in the queue when the peer run could not start', async () => {
        const probe = createProbe({ agentWorking: true, submitFails: true });
        probe.queue.enqueue(summary.id, { draft: 'run me' });

        await probe.ui.sendQueuedFollowUpNow(project, summary, 0);

        expect(probe.queue.peek(summary.id).map(entry => entry.draft)).to.deep.equal(['run me']);
    });

    it('sends as a normal follow-up (not a peer run) when the agent is idle', async () => {
        const probe = createProbe({ agentWorking: false });
        probe.queue.enqueue(summary.id, { draft: 'run me' });

        await probe.ui.sendQueuedFollowUpNow(project, summary, 0);

        expect(probe.conversationSubmits).to.have.length(1);
        expect(probe.conversationSubmits[0].draft).to.equal('run me');
        expect(probe.conversationSubmits[0].options.parallel).to.equal(undefined);
        expect(probe.queue.peek(summary.id)).to.have.length(0);
    });
});
