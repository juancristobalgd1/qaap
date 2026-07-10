// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type {
    QaapAgentConversationDTO,
    QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import type {
    MobileProjectsConversationActionsHost,
    MobileProjectsConversationActionsUi,
} from './mobile-projects-conversation-actions-ui';

describe('MobileProjectsConversationActionsUi optimistic actions', () => {
    let disableJSDOM: (() => void) | undefined;
    let actionsCtor: typeof MobileProjectsConversationActionsUi;
    let originalFetch: typeof globalThis.fetch;

    before(() => {
        disableJSDOM = enableJSDOM();
        actionsCtor = require('./mobile-projects-conversation-actions-ui').MobileProjectsConversationActionsUi;
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    after(() => disableJSDOM?.());

    const summary: QaapAgentConversationSummaryDTO = {
        id: 'optimistic-task',
        cwd: '/workspace/project',
        agentId: 'qaiq',
        title: 'Optimistic task',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        messageCount: 0,
    };

    const fullConversation = (changes: Partial<QaapAgentConversationDTO>): QaapAgentConversationDTO => ({
        id: summary.id,
        cwd: summary.cwd,
        agentId: summary.agentId,
        title: summary.title,
        status: summary.status,
        createdAt: summary.createdAt,
        updatedAt: 2,
        messages: [],
        ...changes,
    });

    function createActions(): {
        readonly actions: MobileProjectsConversationActionsUi;
        readonly snapshots: QaapAgentConversationSummaryDTO[];
        readonly sidebarRefreshes: Array<{ readonly force?: boolean } | undefined>;
    } {
        const snapshots: QaapAgentConversationSummaryDTO[] = [];
        const sidebarRefreshes: Array<{ readonly force?: boolean } | undefined> = [];
        const host = {
            cardMenuUi: { closeCardMenu: () => undefined },
            conversations: { recordSnapshot: (next: QaapAgentConversationSummaryDTO) => snapshots.push(next) },
            renderList: () => undefined,
            sessionsSidebar: {
                isVisible: () => true,
                refreshList: (options?: { readonly force?: boolean }) => sidebarRefreshes.push(options),
            },
        } as unknown as MobileProjectsConversationActionsHost;
        return { actions: new actionsCtor(host), snapshots, sidebarRefreshes };
    }

    it('marks priority and refreshes the sidebar before the request resolves', async () => {
        let resolveFetch: ((response: Response) => void) | undefined;
        globalThis.fetch = () => new Promise<Response>(resolve => { resolveFetch = resolve; });
        const { actions, snapshots, sidebarRefreshes } = createActions();

        const pending = actions.onSetConversationPriority(summary, true);

        expect(snapshots[0]).to.include({ id: summary.id, priority: true });
        expect(sidebarRefreshes[0]).to.deep.equal({ force: true });
        resolveFetch?.(new Response(JSON.stringify(fullConversation({ priority: true })), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
        await pending;
        expect(snapshots[snapshots.length - 1]).to.include({ priority: true });
    });

    it('pauses and refreshes the sidebar before the request resolves', async () => {
        let resolveFetch: ((response: Response) => void) | undefined;
        globalThis.fetch = () => new Promise<Response>(resolve => { resolveFetch = resolve; });
        const { actions, snapshots, sidebarRefreshes } = createActions();

        const pending = actions.onSetConversationPaused({} as never, summary, true);

        expect(snapshots[0]).to.include({ id: summary.id, paused: true });
        expect(sidebarRefreshes[0]).to.deep.equal({ force: true });
        resolveFetch?.(new Response(JSON.stringify(fullConversation({ paused: true })), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
        await pending;
        expect(snapshots[snapshots.length - 1]).to.include({ paused: true });
    });

    it('rolls priority back and refreshes the sidebar when persistence fails', async () => {
        globalThis.fetch = () => Promise.reject(new Error('offline'));
        const { actions, snapshots, sidebarRefreshes } = createActions();

        await actions.onSetConversationPriority(summary, true);

        expect(snapshots[0]).to.include({ priority: true });
        expect(snapshots[snapshots.length - 1]).to.deep.equal(summary);
        expect(sidebarRefreshes.every(options => options?.force === true)).to.equal(true);
    });
});
