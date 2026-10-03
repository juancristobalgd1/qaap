// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import type { QaapAgentApprovalRequestDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-approval-client';
import { MobileProjectsTasksHubAttentionUi, type MobileProjectsTasksHubAttentionHost } from './mobile-projects-tasks-hub-attention-ui';

describe('MobileProjectsTasksHubAttentionUi approval retry state', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('keeps the last good approvals visible while the API connection is unavailable', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const previousApproval = { id: 'approval-1' } as QaapAgentApprovalRequestDTO;
        let listRenders = 0;
        const host = {
            query: '',
            visible: true,
            agentApprovalsFetchGeneration: 0,
            cachedAgentApprovals: [previousApproval],
            collectTeamMembersForHub: () => [],
            collectTeamApprovalItems: () => [],
            isTasksHubView: () => true,
            isHomeHubView: () => false,
            renderList: () => { listRenders++; },
            updateTasksAttentionChrome: () => undefined,
            renderSubtitle: () => undefined,
            hubQueryUi: { isTasksHubView: () => true, isHomeHubView: () => false },
        } as unknown as MobileProjectsTasksHubAttentionHost;
        globalThis.fetch = (async () => { throw new TypeError('connection lost'); }) as typeof fetch;
        try {
            new MobileProjectsTasksHubAttentionUi(host).refreshTasksHubApprovals();
            await clock.runAllAsync();
            expect(host.cachedAgentApprovals).to.deep.equal([previousApproval]);
            expect(listRenders).to.equal(1);
        } finally {
            clock.restore();
        }
    });
});
