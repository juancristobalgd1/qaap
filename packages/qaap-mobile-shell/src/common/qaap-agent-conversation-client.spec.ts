// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isFailedRunSummary,
    looksLikeSelfReportedAgentStopFailure,
    preferQaapConversationSummary,
    type QaapAgentConversationSummaryDTO,
} from './qaap-agent-conversation-client';

const summary = (partial: Partial<QaapAgentConversationSummaryDTO> = {}): QaapAgentConversationSummaryDTO => ({
    id: 'conversation-1',
    cwd: '/workspace/project',
    agentId: 'qaiq',
    title: 'Fix preview',
    status: 'streaming',
    createdAt: 1,
    updatedAt: 10,
    messageCount: 1,
    ...partial,
});

describe('looksLikeSelfReportedAgentStopFailure', () => {
    it('matches a leading "Stopped:" or "Stopped." wording', () => {
        expect(looksLikeSelfReportedAgentStopFailure('Stopped: repeated tool failures detected')).to.be.true;
        expect(looksLikeSelfReportedAgentStopFailure('stopped. Could not complete the task.')).to.be.true;
    });

    it('does not match ordinary agent prose that happens to mention stopping', () => {
        expect(looksLikeSelfReportedAgentStopFailure('Stopped the dev server as requested.')).to.be.false;
        expect(looksLikeSelfReportedAgentStopFailure('I stopped here to ask a question.')).to.be.false;
        expect(looksLikeSelfReportedAgentStopFailure('Turn cancelled.')).to.be.false;
    });

    it('handles undefined/empty text', () => {
        expect(looksLikeSelfReportedAgentStopFailure(undefined)).to.be.false;
        expect(looksLikeSelfReportedAgentStopFailure('')).to.be.false;
        expect(looksLikeSelfReportedAgentStopFailure('   ')).to.be.false;
    });
});

describe('isFailedRunSummary', () => {
    it('is true whenever the structured status is failed', () => {
        expect(isFailedRunSummary({ status: 'failed', lastMessageRole: 'agent', lastMessagePreview: 'anything' })).to.be.true;
        expect(isFailedRunSummary({ status: 'failed', lastMessageRole: 'user', lastMessagePreview: undefined })).to.be.true;
    });

    it('is true for an idle/settled conversation whose last agent message self-reports a stop/failure', () => {
        expect(isFailedRunSummary({
            status: 'idle',
            lastMessageRole: 'agent',
            lastMessagePreview: 'Stopped: repeated tool failures detected',
        })).to.be.true;
        expect(isFailedRunSummary({
            status: 'settled',
            lastMessageRole: 'agent',
            lastMessagePreview: 'Stopped: repeated tool failures detected',
        })).to.be.true;
    });

    it('is false for an ordinary idle conversation with unread agent activity', () => {
        expect(isFailedRunSummary({
            status: 'idle',
            lastMessageRole: 'agent',
            lastMessagePreview: 'Here is the summary of the changes I made.',
        })).to.be.false;
    });

    it('is false for a user-cancelled turn (no self-reported-stop wording, no failed status)', () => {
        expect(isFailedRunSummary({
            status: 'idle',
            lastMessageRole: 'agent',
            lastMessagePreview: 'Here is the partial output before you cancelled the run.',
        })).to.be.false;
    });

    it('ignores the self-reported-stop wording when the last message is from the user', () => {
        expect(isFailedRunSummary({
            status: 'idle',
            lastMessageRole: 'user',
            lastMessagePreview: 'Stopped: repeated tool failures detected',
        })).to.be.false;
    });
});

describe('preferQaapConversationSummary', () => {
    it('settles a streaming row when a failed server update has the same timestamp', () => {
        const result = preferQaapConversationSummary(
            summary({ status: 'streaming', updatedAt: 42 }),
            summary({ status: 'failed', updatedAt: 42, lastMessagePreview: 'Agent interrupted (exit 144).' }),
        );

        expect(result.status).to.equal('failed');
    });

    it('does not let an older failed update overwrite newer active stream state', () => {
        const result = preferQaapConversationSummary(
            summary({ status: 'streaming', updatedAt: 43 }),
            summary({ status: 'failed', updatedAt: 42 }),
        );

        expect(result.status).to.equal('streaming');
    });

    it('does not erase a same-tick failure with a stale idle summary', () => {
        const result = preferQaapConversationSummary(
            summary({ status: 'failed', updatedAt: 42 }),
            summary({ status: 'idle', updatedAt: 42 }),
        );

        expect(result.status).to.equal('failed');
    });

    it('does not revive a failed row from a same-tick streaming delta', () => {
        const result = preferQaapConversationSummary(
            summary({ status: 'failed', updatedAt: 42, messageCount: 4 }),
            summary({ status: 'streaming', updatedAt: 42, messageCount: 4 }),
        );

        expect(result.status).to.equal('failed');
    });

    it('allows a failed conversation to stream again only after a newer user turn', () => {
        const result = preferQaapConversationSummary(
            summary({ status: 'failed', updatedAt: 42, messageCount: 4 }),
            summary({ status: 'streaming', updatedAt: 43, messageCount: 5 }),
        );

        expect(result.status).to.equal('streaming');
    });
});
