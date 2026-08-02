// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { QaapAgentFinishedToastContribution } from './qaap-agent-finished-toast-contribution';
import { MobileSnackbar } from './mobile-snackbar';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { QaapConversationChangeEvent } from '../common/qaap-conversation-change';
import type { MobileProjectEntry } from './mobile-projects-types';

/**
 * Verifies that the agent-finished toast fires a snackbar with an "Open" action when a
 * background agent transitions streaming → settled, and that it does NOT fire when the
 * user is already viewing that conversation.
 */
describe('QaapAgentFinishedToastContribution', () => {
    let contribution: QaapAgentFinishedToastContribution;
    let conversations: MobileProjectsConversations;
    let changeEmitter: Emitter<QaapConversationChangeEvent>;
    let snackbarMessages: Array<{ message: string; kind?: string; actionLabel?: string }>;
    let openCalls: Array<{ projectId: string; conversationId: string }>;
    let openConversationId: string | undefined;

    function makeSummary(id: string, status: QaapAgentConversationSummaryDTO['status'], title = 'Test task'): QaapAgentConversationSummaryDTO {
        return {
            id,
            status,
            title,
            cwd: '/srv/test',
            agentId: 'qaiq',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
        } as QaapAgentConversationSummaryDTO;
    }

    function fireChange(conversationId: string, changedFields: readonly string[] = ['status']): void {
        changeEmitter.fire({ kind: 'updated', conversationId, changedFields: changedFields as never });
    }

    beforeEach(() => {
        snackbarMessages = [];
        openCalls = [];
        openConversationId = undefined;

        // Stub MobileSnackbar.show to capture calls without rendering DOM.
        const originalShow = MobileSnackbar.show;
        (MobileSnackbar as unknown as { show: typeof MobileSnackbar.show }).show = (
            message: string,
            options?: { kind?: string; actionLabel?: string; onAction?: () => void },
        ) => {
            snackbarMessages.push({ message, kind: options?.kind, actionLabel: options?.actionLabel });
            // Simulate the "Open" action tap for the last toast.
            if (options?.actionLabel && options?.onAction) {
                options.onAction();
            }
        };
        // Save for restore.
        (MobileSnackbar as unknown as { _originalShow: typeof MobileSnackbar.show })._originalShow = originalShow;

        // Build a minimal conversations stub with an onDidChangeDetail emitter.
        changeEmitter = new Emitter<QaapConversationChangeEvent>();
        const summaries = new Map<string, QaapAgentConversationSummaryDTO>();
        conversations = {
            start: () => { /* no-op */ },
            onDidChangeDetail: changeEmitter.event,
            threadStore: {
                findSummaryById: (id: string) => summaries.get(id),
                getSummariesForCwd: () => [],
            },
        } as unknown as MobileProjectsConversations;

        contribution = new QaapAgentFinishedToastContribution();
        // Inject the stubbed conversations.
        (contribution as unknown as { conversations: MobileProjectsConversations }).conversations = conversations;

        const project: MobileProjectEntry = {
            id: 'p1',
            name: 'Demo',
            color: '#fff',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: '',
            tokens: '',
            cost: '',
            pinned: false,
            isCurrent: true,
        };

        contribution.bindPanelCallbacks({
            resolveOpenConversationId: () => openConversationId,
            openConversation: (p, s) => {
                openCalls.push({ projectId: p.id, conversationId: s.id });
            },
            resolveProjectForConversation: () => ({ project, summary: makeSummary('c1', 'idle') }),
        });

        // Helper to set summary status and fire change.
        (contribution as unknown as { setSummary: (id: string, status: QaapAgentConversationSummaryDTO['status']) => void })
            .setSummary = (id: string, status: QaapAgentConversationSummaryDTO['status']) => {
                summaries.set(id, makeSummary(id, status));
            };

        contribution.onStart();
    });

    afterEach(() => {
        const originalShow = (MobileSnackbar as unknown as { _originalShow: typeof MobileSnackbar.show })._originalShow;
        if (originalShow) {
            (MobileSnackbar as unknown as { show: typeof MobileSnackbar.show }).show = originalShow;
        }
        MobileSnackbar.dismiss();
    });

    it('shows a success toast with "Open" action when a background agent finishes (streaming → idle)', () => {
        // Seed: conversation was streaming.
        (contribution as unknown as { setSummary: (id: string, status: QaapAgentConversationSummaryDTO['status']) => void })
            .setSummary('c1', 'streaming');
        fireChange('c1');

        // Now it settles to idle.
        (contribution as unknown as { setSummary: (id: string, status: QaapAgentConversationSummaryDTO['status']) => void })
            .setSummary('c1', 'idle');
        fireChange('c1');

        expect(snackbarMessages).to.have.lengthOf(1);
        expect(snackbarMessages[0].kind).to.equal('success');
        expect(snackbarMessages[0].actionLabel).to.equal('Open');
        expect(snackbarMessages[0].message).to.contain('Test task');
        // The "Open" action should have navigated.
        expect(openCalls).to.have.lengthOf(1);
        expect(openCalls[0].conversationId).to.equal('c1');
    });

    it('shows a warning toast when a background agent fails (streaming → failed)', () => {
        (contribution as unknown as { setSummary: (id: string, status: QaapAgentConversationSummaryDTO['status']) => void })
            .setSummary('c2', 'streaming');
        fireChange('c2');

        (contribution as unknown as { setSummary: (id: string, status: QaapAgentConversationSummaryDTO['status']) => void })
            .setSummary('c2', 'failed');
        fireChange('c2');

        expect(snackbarMessages).to.have.lengthOf(1);
        expect(snackbarMessages[0].kind).to.equal('warning');
        expect(snackbarMessages[0].message).to.contain('failed');
    });

    it('does NOT toast when the user is already viewing the finished conversation', () => {
        openConversationId = 'c3'; // user is viewing c3

        (contribution as unknown as { setSummary: (id: string, status: QaapAgentConversationSummaryDTO['status']) => void })
            .setSummary('c3', 'streaming');
        fireChange('c3');

        (contribution as unknown as { setSummary: (id: string, status: QaapAgentConversationSummaryDTO['status']) => void })
            .setSummary('c3', 'idle');
        fireChange('c3');

        expect(snackbarMessages).to.have.lengthOf(0);
    });

    it('does NOT toast on non-streaming → idle transitions (no prior streaming)', () => {
        (contribution as unknown as { setSummary: (id: string, status: QaapAgentConversationSummaryDTO['status']) => void })
            .setSummary('c4', 'idle');
        fireChange('c4');

        expect(snackbarMessages).to.have.lengthOf(0);
    });

    it('does NOT toast while the agent is still streaming', () => {
        (contribution as unknown as { setSummary: (id: string, status: QaapAgentConversationSummaryDTO['status']) => void })
            .setSummary('c5', 'streaming');
        fireChange('c5');

        expect(snackbarMessages).to.have.lengthOf(0);
    });
});
