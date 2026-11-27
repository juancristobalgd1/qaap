// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { MobileProjectsTranscriptSubmitUi } from './mobile-projects-transcript-submit-ui';

/**
 * The composer chip is the single source of truth for a follow-up's approval policy. The chip is synced with the
 * conversation (sheet and Auto-approve switch), so a follow-up takes the chip, and the switch state is only a fallback.
 */
describe('mobile-projects-transcript-submit-ui follow-up approval', () => {

    const summaryWith = (autoApprove: boolean | undefined): { id: string; cwd: string; autoApprove?: boolean } =>
        ({ id: 'conv-1', cwd: '/repo', autoApprove });

    const resolve = (
        summary: { id: string; cwd: string; autoApprove?: boolean },
        options: { autoApprove?: boolean; approvalPolicyId?: string },
        chip: string | undefined,
    ): { autoApprove: boolean | undefined; approvalPolicyId: string } => {
        const host = {
            conversations: { findSummaryById: () => summary },
            transcriptComposerApprovalPolicyId: chip,
        };
        const ui = new MobileProjectsTranscriptSubmitUi(host as never);
        return (ui as unknown as {
            resolveFollowUpApproval(s: unknown, o: unknown): { autoApprove: boolean | undefined; approvalPolicyId: string };
        }).resolveFollowUpApproval(summary, options);
    };

    it('(a) switch turned off: the synced chip sends request-approval and autoApprove false', () => {
        const result = resolve(summaryWith(false), { autoApprove: true, approvalPolicyId: 'request-approval' }, 'request-approval');
        expect(result).to.deep.equal({ autoApprove: false, approvalPolicyId: 'request-approval' });
    });

    it('(b) last turn was Ask, user switches the chip to Autonomous: follow-up is approve-for-me, autoApprove true', () => {
        const result = resolve(summaryWith(false), { autoApprove: true, approvalPolicyId: 'approve-for-me' }, 'approve-for-me');
        expect(result).to.deep.equal({ autoApprove: true, approvalPolicyId: 'approve-for-me' });
    });

    it('a full-access chip keeps the composer autoApprove', () => {
        const result = resolve(summaryWith(true), { autoApprove: true, approvalPolicyId: 'full-access' }, 'full-access');
        expect(result).to.deep.equal({ autoApprove: true, approvalPolicyId: 'full-access' });
    });

    it('without a chip value the conversation switch decides: off means request-approval', () => {
        const result = resolve(summaryWith(false), { autoApprove: true }, undefined);
        expect(result).to.deep.equal({ autoApprove: false, approvalPolicyId: 'request-approval' });
    });

    it('without a chip value or switch state the default is approve-for-me', () => {
        const result = resolve(summaryWith(undefined), { autoApprove: true }, undefined);
        expect(result).to.deep.equal({ autoApprove: true, approvalPolicyId: 'approve-for-me' });
    });

    it('rolls back optimistic paint and clears the stream clock when a pending-new-chat create fails', async () => {
        const events: string[] = [];
        const host = {
            conversations: {
                recordSubmitLatencyMark: () => undefined,
                getSubmitLatencyMarks: () => undefined,
                findSummaryById: () => undefined,
            },
            transcriptHeaderUi: { isPendingNewChatSummary: (s: { id: string }) => s.id.startsWith('pending-new-chat-') },
            transcriptLiveUi: {
                seedTranscriptSemanticProgressClock: () => { events.push('seed'); },
                clearTranscriptSemanticProgressClock: () => { events.push('clear'); },
            },
            transcriptMessagesUi: {
                renderTranscriptMessages: () => { events.push('render'); },
            },
            resolveActiveTranscriptChatHost: () => ({} as HTMLElement),
            createProjectChatSession: async () => {
                throw new Error('Something went wrong (error 502). Please try again.');
            },
            transcriptLastConv: undefined,
            transcriptLastFingerprint: 'stale',
            transcriptOpenSummaryId: 'pending-new-chat-1',
            transcriptOpenSummary: undefined,
            transcriptComposerSummary: undefined,
        };
        const ui = new MobileProjectsTranscriptSubmitUi(host as never);
        const pendingSummary = {
            id: 'pending-new-chat-1',
            cwd: '/repo',
            agentId: 'pi',
            title: 'New task',
            status: 'idle' as const,
            createdAt: 1,
            updatedAt: 1,
            messageCount: 0,
        };
        let caught: unknown;
        try {
            await ui.submitTranscriptViaBackendConversation({ id: 'p1', name: 'repo' } as never, pendingSummary, 'hello', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(host.transcriptLastFingerprint).to.equal(undefined);
        expect(events.filter(event => event === 'render')).to.have.length(2);
        expect(events[events.length - 1]).to.equal('clear');
    });
});
