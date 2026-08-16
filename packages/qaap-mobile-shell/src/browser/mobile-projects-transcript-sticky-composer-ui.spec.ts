// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { TranscriptFollowUpQueue } from '../common/qaap-transcript-follow-up-queue';
import { QaapConversationMessageError } from '../common/qaap-agent-conversation-client';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';

describe('mobile-projects-transcript-sticky-composer-ui queue send now', () => {

    // The composer module pulls @lumino/widgets, which reads `document` at load time — it can
    // only be required once JSDOM is up, so it is loaded here instead of at module scope.
    let composerModule: typeof import('./mobile-projects-transcript-sticky-composer-ui');
    let liveStatusModule: typeof import('./mobile-projects-transcript-sticky-composer-ui-live-status2');
    let timelineModule: typeof import('./mobile-projects-transcript-sticky-composer-ui-timeline2');

    before(() => {
        // Deliberately not torn down: sibling suites in this package enable JSDOM at module
        // scope (load time), so restoring the globals here would strip the document out from
        // under whichever spec file runs next.
        enableJSDOM();
        // @lumino/dragdrop reads DragEvent at module load; jsdom does not provide it.
        const globals = globalThis as unknown as { DragEvent?: unknown };
        if (!globals.DragEvent) {
            globals.DragEvent = class DragEvent {};
        }
        composerModule = require('./mobile-projects-transcript-sticky-composer-ui');
        liveStatusModule = require('./mobile-projects-transcript-sticky-composer-ui-live-status2');
        timelineModule = require('./mobile-projects-transcript-sticky-composer-ui-timeline2');
    });

    it('merges a failed send with text entered while the request was in flight', () => {
        expect(composerModule.mergeFailedComposerDraft('failed request', 'new idea'))
            .to.equal('failed request\n\nnew idea');
        expect(composerModule.mergeFailedComposerDraft('failed request', ''))
            .to.equal('failed request');
        expect(composerModule.mergeFailedComposerDraft('failed request', 'failed request'))
            .to.equal('failed request');
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
        /** Tasks that spawned a SEPARATE conversation (only the isolated "New Worktree" path). */
        readonly backgroundSubmits: string[];
        readonly backgroundOptions: Record<string, unknown>[];
        stopped: number;
    }

    /**
     * Exercises `sendQueuedFollowUpNow` without building the full composer host: only the
     * collaborators that path touches are stubbed on a prototype-backed instance.
     */
    function createProbe(options: {
        agentWorking: boolean;
        submitFails?: boolean;
        /** Backend answers 429: the session already runs the maximum number of agents. */
        atRunLimit?: boolean;
        /** Backend never sees the message: another POST for this conversation was still open. */
        submitSkipped?: boolean;
        destination?: 'local' | 'worktree';
    }): SendNowProbe {
        const queue = new TranscriptFollowUpQueue();
        const conversationSubmits: ConversationSubmit[] = [];
        const backgroundSubmits: string[] = [];
        const backgroundOptions: Record<string, unknown>[] = [];
        const probe = {
            queue,
            conversationSubmits,
            backgroundSubmits,
            backgroundOptions,
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
            resolveActiveTranscriptChatHost: () => undefined,
            transcriptComposerQueueExpanded: false,
            transcriptComposerAgentModel: undefined,
            messageService: { error: () => { } },
            stickyComposerWorkspaceUi: {
                resolveComposerWorkspaceDestination: () => options.destination ?? 'local',
            },
            submitTranscriptViaBackendConversation: async (
                _project: MobileProjectEntry,
                target: QaapAgentConversationSummaryDTO,
                draft: string,
                opts: Record<string, unknown>,
            ) => {
                if (options.atRunLimit) {
                    throw new QaapConversationMessageError('too many runs', 429, 'max-concurrent-runs');
                }
                if (options.submitFails) {
                    throw new Error('backend down');
                }
                if (options.submitSkipped) {
                    return false;
                }
                conversationSubmits.push({ conversationId: target.id, draft, options: opts });
                return true;
            },
            submitBackgroundAgentTask: async (_project: MobileProjectEntry, draft: string, opts: Record<string, unknown>) => {
                if (options.atRunLimit) {
                    throw new QaapConversationMessageError('too many runs', 429, 'max-concurrent-runs');
                }
                if (options.submitFails) {
                    throw new Error('backend down');
                }
                backgroundSubmits.push(draft);
                backgroundOptions.push(opts);
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

    it('opens the queue popover when the first follow-up is queued during an active turn', () => {
        const probe = createProbe({ agentWorking: true });
        const host = (probe.ui as unknown as {
            host: { transcriptComposerQueueExpanded: boolean };
        }).host;

        expect(host.transcriptComposerQueueExpanded).to.equal(false);
        expect(probe.ui.enqueueTranscriptFollowUp(summary.id, { draft: 'queued while working' })).to.equal(true);
        expect(host.transcriptComposerQueueExpanded).to.equal(true);
    });

    it('resets the expanded state after the last queued message is gone', () => {
        const root = document.createElement('div');
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-projects-sticky-composer-inner';
        const card = document.createElement('div');
        card.className = 'theia-mobile-projects-sticky-composer-card theia-mod-codex';
        wrap.append(card);
        root.append(wrap);
        document.body.append(root);

        const host = {
            transcriptComposerHost: root,
            transcriptComposerProject: project,
            transcriptComposerSummary: summary,
            transcriptComposerQueueExpanded: true,
            composerHeaderUi: { updateStickyComposerFabLift: () => undefined },
            updateWorkingPillChrome: () => undefined,
        };
        const ctx = {
            host,
            buildTranscriptComposerActivityOptions: () => ({ queueEntries: [], queueExpanded: true }),
            syncComposerActivityFingerprint: () => undefined,
            syncTranscriptQueuedFollowUpBubbles: () => undefined,
            remountTranscriptStickyComposer: () => undefined,
        };

        timelineModule.refreshComposerActivityStackExtracted(ctx);

        expect(host.transcriptComposerQueueExpanded).to.equal(false);
        root.remove();
    });

    it('collapses the queue immediately when sending a queued message', async () => {
        const probe = createProbe({ agentWorking: true });
        const host = (probe.ui as unknown as {
            host: { transcriptComposerQueueExpanded: boolean };
        }).host;
        host.transcriptComposerQueueExpanded = true;
        probe.queue.enqueue(summary.id, { draft: 'send from expanded queue' });

        await probe.ui.sendQueuedFollowUpNow(project, summary, 0);

        expect(host.transcriptComposerQueueExpanded).to.equal(false);
    });

    it('starts an isolated worktree session instead of a same-tree peer run', async () => {
        const probe = createProbe({ agentWorking: true });
        probe.queue.enqueue(summary.id, { draft: 'keep', selectedAgentId: 'a1' });
        probe.queue.enqueue(summary.id, { draft: 'run me', selectedAgentId: 'a2', modeId: 'm1' });

        await probe.ui.sendQueuedFollowUpNow(project, summary, 1);

        expect(probe.stopped).to.equal(0);
        expect(probe.conversationSubmits).to.deep.equal([]);
        expect(probe.backgroundSubmits).to.deep.equal(['run me']);
        expect(probe.backgroundOptions[0].worktree).to.equal(true);
        expect(probe.backgroundOptions[0].openConversation).to.equal(true);
        expect(probe.backgroundOptions[0].selectedAgentId).to.equal('a2');
        expect(probe.backgroundOptions[0].modeId).to.equal('m1');
        expect(probe.queue.peek(summary.id).map(entry => entry.draft)).to.deep.equal(['keep']);
    });

    it('falls back to the queue when the isolated parallel session cannot start', async () => {
        const probe = createProbe({ agentWorking: true, submitFails: true });
        probe.queue.enqueue(summary.id, { draft: 'run me' });

        await probe.ui.sendQueuedFollowUpNow(project, summary, 0);

        expect(probe.queue.peek(summary.id).map(entry => entry.draft)).to.deep.equal(['run me']);
    });

    it('falls back to the queue when the session is already at the agent limit', async () => {
        const probe = createProbe({ agentWorking: true, atRunLimit: true });
        const request = {
            variable: { name: 'file' },
            arg: '/srv/demo/report.md',
        };
        const entry = {
            draft: 'one too many',
            variables: [request],
            imagePreviews: [{ src: 'data:image/png;base64,AA==', fileName: 'shot.png' }],
        };

        await (probe.ui as unknown as {
            startPeerRunOrQueue: (
                p: MobileProjectEntry,
                s: QaapAgentConversationSummaryDTO,
                e: typeof entry,
            ) => Promise<boolean>;
        }).startPeerRunOrQueue(project, summary, entry);

        // Not a failed send: the message waits in the queue instead of being lost.
        expect(probe.conversationSubmits).to.deep.equal([]);
        expect(probe.queue.peek(summary.id).map(e => e.draft)).to.deep.equal(['one too many']);
        expect(probe.queue.peek(summary.id)[0].variables).to.deep.equal([request]);
        expect(probe.queue.peek(summary.id)[0].imagePreviews?.[0].fileName).to.equal('shot.png');
    });

    it('queues a rapid-fire send that the in-flight guard skipped instead of losing it', async () => {
        const probe = createProbe({ agentWorking: true, submitSkipped: true });

        await (probe.ui as unknown as {
            startPeerRunOrQueue: (
                p: MobileProjectEntry,
                s: QaapAgentConversationSummaryDTO,
                e: { draft: string },
            ) => Promise<boolean>;
        }).startPeerRunOrQueue(project, summary, { draft: 'typed too fast' });

        // The composer draft is already cleared by this point, so a skipped submit must not
        // evaporate — it lands in the queue.
        expect(probe.queue.peek(summary.id).map(e => e.draft)).to.deep.equal(['typed too fast']);
    });

    it('routes a concurrent send to an isolated worktree session when "Run in" says so', async () => {
        const probe = createProbe({ agentWorking: true, destination: 'worktree' });
        probe.queue.enqueue(summary.id, { draft: 'isolate me' });

        await probe.ui.sendQueuedFollowUpNow(project, summary, 0);

        // Isolation needs its own working tree, which a conversation cannot have — so it runs as
        // its own session instead of as a peer sharing this one's files.
        expect(probe.conversationSubmits).to.deep.equal([]);
        expect(probe.backgroundSubmits).to.deep.equal(['isolate me']);
        expect(probe.backgroundOptions[0].worktree).to.equal(true);
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

    it('lets the backend-conversation submit own the optimistic transcript row', async () => {
        const optimisticRenders: string[] = [];
        const submittedDrafts: string[] = [];
        const host = {
            transcriptComposerContext: [],
            transcriptComposerDraft: 'follow-up',
            transcriptComposerDraftPersistTimer: undefined,
            transcriptComposerModeId: undefined,
            transcriptComposerApprovalPolicyId: undefined,
            transcriptComposerAgentModel: undefined,
            transcriptComposerHost: undefined,
            transcriptComposerSendRefresh: undefined,
            resolveAttachmentPreview: () => undefined,
            messageService: { warn: () => undefined, error: () => undefined },
            submitTranscriptViaBackendConversation: async (
                _project: MobileProjectEntry,
                _summary: QaapAgentConversationSummaryDTO,
                draft: string,
            ) => {
                submittedDrafts.push(draft);
                return true;
            },
        };
        const ui = Object.create(
            composerModule.MobileProjectsTranscriptStickyComposerUi.prototype,
        ) as MobileProjectsTranscriptStickyComposerUi;
        const seam = ui as unknown as Record<string, any>;
        seam.host = host;
        seam.isTranscriptStickyComposerAgentWorking = () => false;
        seam.workHub = {
            renderIdleSubmitOptimistic: () => optimisticRenders.push('work-hub'),
        };
        seam.remountTranscriptStickyComposer = () => undefined;

        await liveStatusModule.submitTranscriptComposerDraftExtracted(
            seam,
            'follow-up',
            project,
            { ...summary, status: 'idle' },
            document.createElement('div'),
            {
                resolvedPinnedId: 'qaiq',
                showApprovalPolicy: false,
                isLegacyTheiaChat: false,
            },
        );

        expect(submittedDrafts).to.deep.equal(['follow-up']);
        expect(optimisticRenders).to.deep.equal([]);
    });

    function createBusySubmitProbe(): {
        queued: Array<{ draft: string; deliveryMode?: string }>;
        dispatched: Array<{ draft: string; deliveryMode?: string }>;
        seam: Record<string, unknown>;
    } {
        const queued: Array<{ draft: string; deliveryMode?: string }> = [];
        const dispatched: Array<{ draft: string; deliveryMode?: string }> = [];
        const host = {
            transcriptComposerContext: [],
            transcriptComposerDraft: 'follow-up',
            transcriptComposerDraftPersistTimer: undefined,
            transcriptComposerModeId: undefined,
            transcriptComposerApprovalPolicyId: undefined,
            transcriptComposerAgentModel: undefined,
            transcriptComposerHost: undefined,
            transcriptComposerSendRefresh: undefined,
            resolveAttachmentPreview: () => undefined,
            messageService: { warn: () => undefined, error: () => undefined },
        };
        const ui = Object.create(
            composerModule.MobileProjectsTranscriptStickyComposerUi.prototype,
        ) as MobileProjectsTranscriptStickyComposerUi;
        const seam = ui as unknown as Record<string, unknown>;
        seam.host = host;
        seam.isTranscriptStickyComposerAgentWorking = () => true;
        seam.queuePeerRunMessage = (
            _summary: QaapAgentConversationSummaryDTO,
            entry: { draft: string; deliveryMode?: string },
        ) => {
            queued.push({ draft: entry.draft, deliveryMode: entry.deliveryMode });
            return true;
        };
        seam.startPeerRunOrQueue = async (
            _project: MobileProjectEntry,
            _summary: QaapAgentConversationSummaryDTO,
            entry: { draft: string; deliveryMode?: string },
        ) => {
            dispatched.push({ draft: entry.draft, deliveryMode: entry.deliveryMode });
            return true;
        };
        seam.remountTranscriptStickyComposer = () => undefined;
        return { queued, dispatched, seam };
    }

    it('queues a busy follow-up by default', async () => {
        const probe = createBusySubmitProbe();
        await liveStatusModule.submitTranscriptComposerDraftExtracted(
            probe.seam,
            'wait for me',
            project,
            { ...summary, status: 'streaming' },
            document.createElement('div'),
            {
                resolvedPinnedId: 'qaiq',
                showApprovalPolicy: false,
                isLegacyTheiaChat: false,
            },
        );
        expect(probe.queued).to.deep.equal([{ draft: 'wait for me', deliveryMode: 'queue' }]);
        expect(probe.dispatched).to.deep.equal([]);
    });

    it('ignores a leftover Parallel preference and still queues busy Send', async () => {
        const probe = createBusySubmitProbe();
        await liveStatusModule.submitTranscriptComposerDraftExtracted(
            probe.seam,
            'run alongside',
            project,
            { ...summary, status: 'streaming' },
            document.createElement('div'),
            {
                resolvedPinnedId: 'qaiq',
                showApprovalPolicy: false,
                isLegacyTheiaChat: false,
            },
        );
        expect(probe.queued).to.deep.equal([{ draft: 'run alongside', deliveryMode: 'queue' }]);
        expect(probe.dispatched).to.deep.equal([]);
    });

    it('lets Cmd/Ctrl+Enter interrupt without a composer selector', async () => {
        const probe = createBusySubmitProbe();
        await liveStatusModule.submitTranscriptComposerDraftExtracted(
            probe.seam,
            'stop and do this',
            project,
            { ...summary, status: 'streaming' },
            document.createElement('div'),
            {
                resolvedPinnedId: 'qaiq',
                showApprovalPolicy: false,
                isLegacyTheiaChat: false,
                forceDeliveryMode: 'interrupt',
            },
        );
        expect(probe.dispatched).to.deep.equal([{ draft: 'stop and do this', deliveryMode: 'interrupt' }]);
        expect(probe.queued).to.deep.equal([]);
    });

    it('restores draft and composer context when an active-conversation send fails', async () => {
        const errors: string[] = [];
        const contextEntry = {
            id: 'context-1',
            request: {
                variable: { name: 'file' },
                arg: '/srv/demo/report.md',
            },
        };
        const host = {
            transcriptComposerContext: [contextEntry],
            transcriptComposerDraft: 'send this safely',
            transcriptComposerDraftPersistTimer: undefined,
            transcriptComposerModeId: undefined,
            transcriptComposerApprovalPolicyId: undefined,
            transcriptComposerAgentModel: undefined,
            transcriptComposerHost: undefined,
            transcriptComposerSendRefresh: undefined,
            resolveAttachmentPreview: undefined,
            messageService: {
                error: (message: string) => errors.push(message),
                warn: () => undefined,
            },
            submitTranscriptViaBackendConversation: async () => {
                throw new Error('network offline');
            },
        };
        const ui = Object.create(
            composerModule.MobileProjectsTranscriptStickyComposerUi.prototype,
        ) as MobileProjectsTranscriptStickyComposerUi;
        const seam = ui as unknown as Record<string, unknown>;
        seam.host = host;
        seam.isTranscriptStickyComposerAgentWorking = () => false;
        seam.resolveComposerTranscriptChatHost = () => undefined;
        seam.remountTranscriptStickyComposer = () => undefined;

        await (ui as unknown as {
            submitTranscriptComposerDraft: (
                draft: string,
                p: MobileProjectEntry,
                s: QaapAgentConversationSummaryDTO,
                chatHost: HTMLElement,
                options: {
                    readonly resolvedPinnedId: string;
                    readonly showApprovalPolicy: boolean;
                    readonly isLegacyTheiaChat: boolean;
                },
            ) => Promise<void>;
        }).submitTranscriptComposerDraft(
            'send this safely',
            project,
            summary,
            document.createElement('div'),
            {
                resolvedPinnedId: 'qaiq',
                showApprovalPolicy: false,
                isLegacyTheiaChat: false,
            },
        );

        expect(host.transcriptComposerDraft).to.equal('send this safely');
        expect(host.transcriptComposerContext).to.deep.equal([contextEntry]);
        expect(errors[0]).to.contain('network offline');
    });
});
