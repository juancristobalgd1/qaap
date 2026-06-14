// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildWorkHubSessionsSidebarFingerprint,
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

    it('changes when accordion expansion or pagination changes', () => {
        const before = buildWorkHubSessionsSidebarFingerprint(baseInput());
        const after = buildWorkHubSessionsSidebarFingerprint({
            ...baseInput(),
            expandedProjectIds: new Set(['proj-a']),
            visibleConversationCountByProjectId: new Map([['proj-a', 15]]),
        });
        expect(after).to.not.equal(before);
    });
});
