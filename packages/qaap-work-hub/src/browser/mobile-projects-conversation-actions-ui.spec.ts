// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type {
    QaapAgentConversationDTO,
    QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { writeStoredAgentModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-model-selection';
import type {
    MobileProjectsConversationActionsHost,
    MobileProjectsConversationActionsUi,
} from './mobile-projects-conversation-actions-ui';

disableImportJSDOM();

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
        try {
            window.localStorage.clear();
        } catch {
            // jsdom storage may be unavailable; nothing to reset then.
        }
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

    function createActions(extraHost: Record<string, unknown> = {}): {
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
            ...extraHost,
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

    describe('onContinueConversation', () => {
        const model = { provider: 'anthropic' as const, vendor: 'anthropic', modelId: 'claude-sonnet-4-5', label: 'Sonnet' };
        const failedSummary: QaapAgentConversationSummaryDTO = { ...summary, status: 'failed', lastMessageError: 'Agent interrupted' };
        const continueHost = (errors: string[] = [], started: string[] = []): Record<string, unknown> => ({
            applyTaskStartedToProject: (_cwd: string, prompt: string) => started.push(prompt),
            isWatchingOpenTranscript: () => false,
            messageService: { error: (message: string) => errors.push(message) },
        });

        it('shows the conversation as streaming and posts the follow-up with the stored model', async () => {
            writeStoredAgentModel(failedSummary.cwd, failedSummary.agentId, model);
            const bodies: Array<Record<string, unknown>> = [];
            globalThis.fetch = (_url, init) => {
                bodies.push(JSON.parse(String(init?.body)));
                return Promise.resolve(new Response(JSON.stringify(fullConversation({ status: 'streaming' })), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }));
            };
            const started: string[] = [];
            const { actions, snapshots } = createActions(continueHost([], started));

            const pending = actions.onContinueConversation({} as never, failedSummary);

            expect(snapshots[0]).to.include({ id: failedSummary.id, status: 'streaming' });
            expect(started).to.have.length(1);
            await pending;
            expect(bodies).to.have.length(1);
            expect(bodies[0].content).to.equal(started[0]);
            expect(bodies[0].agentModel).to.deep.equal({ provider: model.provider, vendor: model.vendor, modelId: model.modelId });
            expect(snapshots[snapshots.length - 1]).to.include({ status: 'streaming' });
        });

        it('rolls the snapshot back and reports the error when the follow-up fails', async () => {
            globalThis.fetch = () => Promise.reject(new Error('offline'));
            const errors: string[] = [];
            const { actions, snapshots } = createActions(continueHost(errors));

            await actions.onContinueConversation({} as never, failedSummary);

            expect(snapshots[0]).to.include({ status: 'streaming' });
            expect(snapshots[snapshots.length - 1]).to.deep.equal(failedSummary);
            expect(errors).to.have.length(1);
            expect(errors[0]).to.contain('offline');
        });
    });
});
