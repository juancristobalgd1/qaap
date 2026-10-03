// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { listAllConversationGroups } from './qaap-agent-conversation-client';
import { fetchAgentApprovals } from './qaap-agent-approval-client';
import { fetchAgentTaskListAll } from './qaap-agent-task-client';

describe('Qaap agent GET APIs recover from transient gateway errors', () => {
    const originalFetch = globalThis.fetch;
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        clock.restore();
    });

    it('retries task, approval, and conversation snapshots after a 502', async () => {
        const attempts = new Map<string, number>();
        globalThis.fetch = (async input => {
            const url = String(input);
            const count = (attempts.get(url) ?? 0) + 1;
            attempts.set(url, count);
            if (count === 1) {
                return new Response('{}', { status: 502 });
            }
            const body = url.includes('/agent-tasks/')
                ? { agents: [], agentConfigured: false, qaiqInstalled: false, qaiqModels: [] }
                : url.includes('/agent-approvals')
                    ? { approvals: [] }
                    : { groups: [] };
            return new Response(JSON.stringify(body), { status: 200 });
        }) as typeof fetch;

        const tasks = fetchAgentTaskListAll();
        await clock.tickAsync(700);
        expect((await tasks).agents).to.deep.equal([]);

        const approvals = fetchAgentApprovals();
        await clock.tickAsync(700);
        expect(await approvals).to.deep.equal([]);

        const conversations = listAllConversationGroups();
        await clock.tickAsync(700);
        expect(await conversations).to.deep.equal([]);
        expect([...attempts.values()]).to.deep.equal([2, 2, 2]);
    });
});
