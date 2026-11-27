// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    resetOptimisticallyResolvedApprovalsForTests,
    type QaapAgentApprovalRequestDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-approval-client';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { TRANSCRIPT_APPROVAL_CARD_ALLOW_CLASS } from './qaap-transcript-approval-card-ui';
import {
    clearTranscriptPendingApprovalBar,
    mountTranscriptPendingApprovalBar,
    TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS,
} from './qaap-transcript-inline-approval-ui';
import {
    optimisticallyDismissTranscriptApprovalExtracted,
    restoreOptimisticallyDismissedTranscriptApprovalExtracted,
    syncTranscriptPendingApprovalExtracted,
} from './mobile-projects-transcript-live-ui-timeline';
import type { MobileProjectsTranscriptLiveUiContext } from './mobile-projects-transcript-live-ui-context';

describe('qaap-transcript-inline-approval-ui', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    const pending: QaapAgentApprovalRequestDTO = {
        id: 'conv-1:tool:tool-use-1',
        conversationId: 'conv-1',
        cwd: '/tmp/repo',
        agentId: 'qaiq',
        conversationTitle: 'Test task',
        kind: 'tool',
        toolName: 'Bash',
        toolUseId: 'tool-use-1',
        summary: 'Run npm test',
        createdAt: Date.now(),
    };

    it('mounts pending approval above the composer column', () => {
        const composerHost = document.createElement('div');
        composerHost.className = 'theia-mobile-projects-sticky-composer';
        composerHost.innerHTML = '<div class="theia-mobile-projects-sticky-composer-column"><div class="theia-mobile-projects-sticky-composer-inner"></div></div>';
        mountTranscriptPendingApprovalBar(composerHost, pending, {
            onApprove: () => undefined,
            onReject: () => undefined,
        });
        const column = composerHost.querySelector('.theia-mobile-projects-sticky-composer-column')!;
        expect(column.firstElementChild?.className).to.equal(TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS);
        expect(column.querySelector(`.${TRANSCRIPT_APPROVAL_CARD_ALLOW_CLASS}`)?.textContent).to.equal('Allow');
    });

    it('clearTranscriptPendingApprovalBar removes the host', () => {
        const composerHost = document.createElement('div');
        composerHost.innerHTML = '<div class="theia-mobile-projects-sticky-composer-column"></div>';
        mountTranscriptPendingApprovalBar(composerHost, pending, {
            onApprove: () => undefined,
            onReject: () => undefined,
        });
        clearTranscriptPendingApprovalBar(composerHost);
        expect(composerHost.querySelector(`.${TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS}`)).to.equal(null);
    });

    it('optimistically dismisses the approval bar immediately and restores it on rollback', () => {
        resetOptimisticallyResolvedApprovalsForTests();
        const composerHost = document.createElement('div');
        composerHost.innerHTML = '<div class="theia-mobile-projects-sticky-composer-column"></div>';
        const conv: QaapAgentConversationDTO = {
            id: 'conv-1',
            cwd: '/tmp/repo',
            agentId: 'qaiq',
            title: 'Test task',
            status: 'streaming',
            approvalPolicyId: 'request-approval',
            createdAt: 1,
            updatedAt: 1,
            messages: [],
        };
        const ctx = {
            host: {
                cachedAgentApprovals: [pending],
                transcriptComposerHost: composerHost,
                transcriptLastConv: conv,
            },
            lastInlineApprovalSyncKey: undefined as string | undefined,
            lastMountedApprovalId: undefined as string | undefined,
            resolveActiveTranscriptChatHost: () => undefined,
            buildTranscriptApprovalSyncKey: (_chat: HTMLElement | undefined, c: QaapAgentConversationDTO, pendingId: string | undefined) => `${c.id}|${pendingId ?? ''}`,
            reconcileTranscriptInlineToolApprovalCards: () => undefined,
            stopTranscriptApprovalRefresh: () => undefined,
            refreshTranscriptApprovals: async () => undefined,
            ensureTranscriptConversationRefresh: () => undefined,
            syncTranscriptPendingApproval: (c: QaapAgentConversationDTO) => syncTranscriptPendingApprovalExtracted(ctx, c),
        } as unknown as MobileProjectsTranscriptLiveUiContext;

        syncTranscriptPendingApprovalExtracted(ctx, conv);
        expect(composerHost.querySelector(`.${TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS}`)).to.not.equal(null);

        optimisticallyDismissTranscriptApprovalExtracted(ctx, pending);
        expect(composerHost.querySelector(`.${TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS}`)).to.equal(null);
        expect(ctx.host.cachedAgentApprovals).to.deep.equal([]);

        restoreOptimisticallyDismissedTranscriptApprovalExtracted(ctx, pending);
        expect(composerHost.querySelector(`.${TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS}`)).to.not.equal(null);
        expect(ctx.host.cachedAgentApprovals.map(item => item.id)).to.deep.equal([pending.id]);
        resetOptimisticallyResolvedApprovalsForTests();
    });
});
