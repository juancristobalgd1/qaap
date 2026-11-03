// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { MobileProjectsTranscriptSubmitUi } from './mobile-projects-transcript-submit-ui';

/**
 * A conversation whose Auto-approve switch is off must keep asking on follow-ups, even when the composer
 * chip says approve-for-me (its default). Otherwise the next message silently turns Autonomous mode back on.
 */
describe('mobile-projects-transcript-submit-ui follow-up approval', () => {

    const summaryWith = (autoApprove: boolean | undefined): { id: string; cwd: string; autoApprove?: boolean } =>
        ({ id: 'conv-1', cwd: '/repo', autoApprove });

    const resolve = (
        summary: { id: string; cwd: string; autoApprove?: boolean },
        options: { autoApprove?: boolean; approvalPolicyId?: string },
        chip: string | undefined = 'approve-for-me',
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

    it('a follow-up after the switch was turned off sends autoApprove false and request-approval', () => {
        const result = resolve(summaryWith(false), { autoApprove: true, approvalPolicyId: 'approve-for-me' });
        expect(result).to.deep.equal({ autoApprove: false, approvalPolicyId: 'request-approval' });
    });

    it('the switch is read from the live summary, not a stale copy', () => {
        const result = resolve(summaryWith(undefined), { autoApprove: undefined, approvalPolicyId: 'request-approval' });
        expect(result.approvalPolicyId).to.equal('request-approval');
        expect(result.autoApprove).to.equal(undefined);
    });

    it('a switch that is on keeps the composer choice', () => {
        const result = resolve(summaryWith(true), { autoApprove: true, approvalPolicyId: 'full-access' });
        expect(result).to.deep.equal({ autoApprove: true, approvalPolicyId: 'full-access' });
    });

    it('without a switch state or chip the composer default applies', () => {
        const result = resolve(summaryWith(undefined), { autoApprove: true }, undefined);
        expect(result.approvalPolicyId).to.equal('approve-for-me');
        expect(result.autoApprove).to.equal(true);
    });
});
