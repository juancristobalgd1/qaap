// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildWorkHubSessionsSidebarRowFingerprint, buildWorkHubSessionsSidebarVisibleStructureFingerprint } from './qaap-work-hub-sessions-sidebar-fingerprint';

describe('qaap-work-hub-sessions-sidebar-fingerprint', () => {
    it('does not change row fingerprint when streaming turn progress advances', () => {
        const summary = {
            id: 'conv-1',
            status: 'streaming' as const,
            title: 'Fix login',
            updatedAt: 100,
            messageCount: 3,
            turnProgressCurrent: 1,
            turnProgressTotal: 4,
        };
        const before = buildWorkHubSessionsSidebarRowFingerprint(summary, {
            pinned: true,
            isCurrent: true,
            visualStatusId: 'running',
        });
        const after = buildWorkHubSessionsSidebarRowFingerprint({
            ...summary,
            turnProgressCurrent: 2,
            title: 'Renamed while streaming',
        }, {
            pinned: true,
            isCurrent: true,
            visualStatusId: 'running',
        });
        expect(after).to.equal(before);
    });

    it('changes row fingerprint when idle turn progress or title changes', () => {
        const summary = {
            id: 'conv-1',
            status: 'idle' as const,
            title: 'Fix login',
            updatedAt: 100,
            messageCount: 3,
            turnProgressCurrent: 1,
            turnProgressTotal: 4,
        };
        const before = buildWorkHubSessionsSidebarRowFingerprint(summary, {
            pinned: false,
            isCurrent: false,
            visualStatusId: 'done',
        });
        const afterProgress = buildWorkHubSessionsSidebarRowFingerprint({
            ...summary,
            turnProgressCurrent: 2,
        }, {
            pinned: false,
            isCurrent: false,
            visualStatusId: 'done',
        });
        const afterTitle = buildWorkHubSessionsSidebarRowFingerprint({
            ...summary,
            title: 'Renamed',
        }, {
            pinned: false,
            isCurrent: false,
            visualStatusId: 'done',
        });
        expect(afterProgress).to.not.equal(before);
        expect(afterTitle).to.not.equal(before);
    });

    it('visible structure ignores hidden conversations outside pagination window', () => {
        const visibleSlot = {
            projectId: 'proj-a',
            conversation: {
                id: 'conv-1',
                status: 'streaming',
                title: 'Visible',
                updatedAt: 100,
                messageCount: 3,
            },
            pinned: false,
        };
        const base = {
            query: '',
            transcriptOpenSummaryId: undefined,
            expandedProjectIds: new Set<string>(),
            visibleConversationCountByProjectId: new Map([['proj-a', 5]]),
            visibleProjectGroupIds: ['proj-a'],
            pinnedSectionProjectIds: [] as string[],
            visibleSlots: [visibleSlot],
        };
        const before = buildWorkHubSessionsSidebarVisibleStructureFingerprint(base);
        const after = buildWorkHubSessionsSidebarVisibleStructureFingerprint({
            ...base,
            visibleSlots: [{
                ...visibleSlot,
                conversation: {
                    ...visibleSlot.conversation,
                    updatedAt: 999,
                    messageCount: 50,
                    title: 'Hidden conv changed',
                },
            }],
        });
        expect(after).to.equal(before);
    });
});
