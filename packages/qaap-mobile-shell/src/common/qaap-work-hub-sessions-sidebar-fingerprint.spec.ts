// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildWorkHubSessionsSidebarFingerprint,
    buildWorkHubSessionsSidebarRowFingerprint,
    buildWorkHubSessionsSidebarStructureFingerprint,
    buildWorkHubSessionsSidebarVisibleStructureFingerprint,
    type WorkHubSessionsSidebarFingerprintInput,
} from './qaap-work-hub-sessions-sidebar-fingerprint';

describe('qaap-work-hub-sessions-sidebar-fingerprint', () => {

    const baseInput = (): WorkHubSessionsSidebarFingerprintInput => ({
        query: '',
        transcriptOpenSummaryId: undefined,
        expandedProjectIds: new Set<string>(),
        visibleConversationCountByProjectId: new Map<string, number>(),
        projects: [{ id: 'proj-a', isCurrent: true }],
        conversationsForProject: projectId => projectId === 'proj-a'
            ? [{
                id: 'conv-1',
                status: 'streaming',
                title: 'Fix login',
                updatedAt: 100,
                messageCount: 3,
                priority: true,
            }]
            : [],
        pinnedConversationIds: new Set(['conv-1']),
    });

    it('is stable for identical sidebar data', () => {
        const input = baseInput();
        expect(buildWorkHubSessionsSidebarFingerprint(input))
            .to.equal(buildWorkHubSessionsSidebarFingerprint(input));
    });

    it('changes when a visible conversation field changes', () => {
        const before = buildWorkHubSessionsSidebarFingerprint(baseInput());
        const after = buildWorkHubSessionsSidebarFingerprint({
            ...baseInput(),
            conversationsForProject: projectId => projectId === 'proj-a'
                ? [{
                    id: 'conv-1',
                    status: 'idle',
                    title: 'Fix login',
                    updatedAt: 101,
                    messageCount: 4,
                    priority: true,
                }]
                : [],
        });
        expect(after).to.not.equal(before);
    });

    it('does not change for volatile live counters when row order is stable', () => {
        const before = buildWorkHubSessionsSidebarFingerprint(baseInput());
        const after = buildWorkHubSessionsSidebarFingerprint({
            ...baseInput(),
            conversationsForProject: projectId => projectId === 'proj-a'
                ? [{
                    id: 'conv-1',
                    status: 'streaming',
                    title: 'Fix login',
                    updatedAt: 999,
                    messageCount: 99,
                    priority: true,
                }]
                : [],
        });
        expect(after).to.equal(before);
    });

    it('does not change structure when streaming title or turn progress updates', () => {
        const input = baseInput();
        const before = buildWorkHubSessionsSidebarStructureFingerprint(input);
        const after = buildWorkHubSessionsSidebarStructureFingerprint({
            ...input,
            conversationsForProject: projectId => projectId === 'proj-a'
                ? [{
                    id: 'conv-1',
                    status: 'streaming',
                    title: 'Renamed while streaming',
                    updatedAt: 999,
                    messageCount: 99,
                    priority: true,
                    turnProgressCurrent: 4,
                    turnProgressTotal: 12,
                }]
                : [],
        });
        expect(after).to.equal(before);
    });

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

    it('changes when conversation order changes', () => {
        const before = buildWorkHubSessionsSidebarFingerprint({
            ...baseInput(),
            conversationsForProject: projectId => projectId === 'proj-a'
                ? [
                    {
                        id: 'conv-1',
                        status: 'streaming',
                        title: 'Fix login',
                        updatedAt: 100,
                        messageCount: 3,
                    },
                    {
                        id: 'conv-2',
                        status: 'idle',
                        title: 'Review copy',
                        updatedAt: 90,
                        messageCount: 2,
                    },
                ]
                : [],
        });
        const after = buildWorkHubSessionsSidebarFingerprint({
            ...baseInput(),
            conversationsForProject: projectId => projectId === 'proj-a'
                ? [
                    {
                        id: 'conv-2',
                        status: 'idle',
                        title: 'Review copy',
                        updatedAt: 90,
                        messageCount: 2,
                    },
                    {
                        id: 'conv-1',
                        status: 'streaming',
                        title: 'Fix login',
                        updatedAt: 100,
                        messageCount: 3,
                    },
                ]
                : [],
        });
        expect(after).to.not.equal(before);
    });

    it('changes when accordion expansion or pagination changes', () => {
        const before = buildWorkHubSessionsSidebarFingerprint(baseInput());
        const after = buildWorkHubSessionsSidebarFingerprint({
            ...baseInput(),
            expandedProjectIds: new Set(['proj-a']),
            visibleConversationCountByProjectId: new Map([['proj-a', 15]]),
        });
        expect(after).to.not.equal(before);
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
