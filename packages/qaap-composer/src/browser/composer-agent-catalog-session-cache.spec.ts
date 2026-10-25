// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentTaskAgentOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    COMPOSER_AGENT_CATALOG_SESSION_KEY,
    readComposerAgentCatalogSession,
    writeComposerAgentCatalogSession,
} from './composer-agent-catalog-session-cache';
import { MobileProjectsStickyComposerAgentsUi, type MobileProjectsStickyComposerAgentsHost } from './mobile-projects-sticky-composer-agents-ui';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('composer agent catalog session cache', () => {

    useSuiteJSDOM();

    const copilot: QaapAgentTaskAgentOption = { id: 'copilot', label: 'Copilot CLI', available: true, connectionState: 'connected' };

    beforeEach(() => {
        window.sessionStorage.clear();
        window.localStorage.clear();
    });

    afterEach(() => {
        window.sessionStorage.clear();
    });

    describe('read and write', () => {

        it('round-trips the last catalog through sessionStorage', () => {
            writeComposerAgentCatalogSession([copilot]);

            expect(window.sessionStorage.getItem(COMPOSER_AGENT_CATALOG_SESSION_KEY)).to.be.a('string');
            expect(readComposerAgentCatalogSession()).to.deep.equal([copilot]);
            // Per tab only: localStorage is never used for the catalog.
            expect(window.localStorage.length).to.equal(0);
        });

        it('returns an empty catalog for missing or malformed entries', () => {
            expect(readComposerAgentCatalogSession()).to.deep.equal([]);
            window.sessionStorage.setItem(COMPOSER_AGENT_CATALOG_SESSION_KEY, '{not json');
            expect(readComposerAgentCatalogSession()).to.deep.equal([]);
            window.sessionStorage.setItem(COMPOSER_AGENT_CATALOG_SESSION_KEY, JSON.stringify({ id: 'copilot' }));
            expect(readComposerAgentCatalogSession()).to.deep.equal([]);
            window.sessionStorage.setItem(COMPOSER_AGENT_CATALOG_SESSION_KEY, JSON.stringify([null, { label: 'no id' }, copilot]));
            expect(readComposerAgentCatalogSession()).to.deep.equal([copilot]);
        });

        it('never throws when sessionStorage is blocked', () => {
            const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
            Object.defineProperty(window, 'sessionStorage', {
                configurable: true,
                get: () => { throw new Error('blocked'); },
            });
            try {
                expect(() => writeComposerAgentCatalogSession([copilot])).to.not.throw();
                expect(readComposerAgentCatalogSession()).to.deep.equal([]);
            } finally {
                if (descriptor) {
                    Object.defineProperty(window, 'sessionStorage', descriptor);
                } else {
                    delete (window as unknown as { sessionStorage?: Storage }).sessionStorage;
                }
            }
        });
    });

    describe('picker catalog', () => {

        const project: MobileProjectEntry = {
            id: 'project',
            name: 'Project',
            color: '#8EB5DC',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '$0',
            pinned: false,
            isCurrent: true,
        };

        function createHost(options: {
            agents?: QaapAgentTaskAgentOption[];
            streamAgents?: QaapAgentTaskAgentOption[];
            backendAgents?: QaapAgentTaskAgentOption[];
        } = {}): MobileProjectsStickyComposerAgentsHost {
            return {
                stickyComposerPinnedAgentId: undefined,
                stickyComposerBackendAgents: options.agents ?? [],
                stickyComposerQaiqModels: [],
                preparedCwdByProjectId: new Map(),
                projectsService: {
                    getProjectCwd: () => '/workspace/project',
                } as unknown as MobileProjectsStickyComposerAgentsHost['projectsService'],
                activeTasks: options.streamAgents === undefined ? undefined : {
                    getAgents: () => options.streamAgents ?? [],
                    getDefaultAgent: () => undefined,
                    isAgentConfigured: () => true,
                    start: () => undefined,
                    onDidChange: () => ({ dispose: () => undefined }),
                } as unknown as MobileProjectsStickyComposerAgentsHost['activeTasks'],
                stickyComposerRenderUi: {
                    renderStickyComposer: () => undefined,
                } as unknown as MobileProjectsStickyComposerAgentsHost['stickyComposerRenderUi'],
                loadBackendAgentSnapshot: async () => ({
                    agents: options.backendAgents ?? [],
                    defaultAgent: undefined,
                    agentConfigured: true,
                    qaiqInstalled: false,
                    qaiqModels: [],
                }),
                resolveConversationAgentLabel: () => 'Copilot CLI',
                projectRowsUi: {} as MobileProjectsStickyComposerAgentsHost['projectRowsUi'],
            };
        }

        function createChrome(): ComposerAgentPickerChrome {
            return {
                list: document.createElement('div'),
                header: document.createElement('div'),
            } as unknown as ComposerAgentPickerChrome;
        }

        it('paints the tab session catalog after a reload, before any backend answer', () => {
            writeComposerAgentCatalogSession([copilot]);
            const ui = new MobileProjectsStickyComposerAgentsUi(createHost());
            const renders: Array<readonly QaapAgentTaskAgentOption[]> = [];

            ui.loadComposerAgentPickerCatalog(createChrome(), {
                cached: [],
                load: () => new Promise(() => undefined),
                isCurrent: () => true,
                render: agents => renders.push(agents),
                onError: () => expect.fail('a remembered catalog must not show the error state'),
            });

            expect(renders).to.have.length(1);
            expect(renders[0].map(agent => agent.id)).to.include('copilot');
        });

        it('prefers the in-memory catalog over the session copy', () => {
            writeComposerAgentCatalogSession([{ ...copilot, label: 'Stale' }]);
            const ui = new MobileProjectsStickyComposerAgentsUi(createHost({ agents: [copilot] }));
            const renders: Array<readonly QaapAgentTaskAgentOption[]> = [];

            ui.loadComposerAgentPickerCatalog(createChrome(), {
                cached: [copilot],
                load: () => new Promise(() => undefined),
                isCurrent: () => true,
                render: agents => renders.push(agents),
                onError: () => undefined,
            });

            expect(renders[0].find(agent => agent.id === 'copilot')?.label).to.equal('Copilot CLI');
        });

        it('stores the answered catalog for the next reload', async () => {
            const ui = new MobileProjectsStickyComposerAgentsUi(createHost({ backendAgents: [copilot] }));

            await ui.refreshStickyComposerAgents(project, { forceRefresh: true });

            expect(readComposerAgentCatalogSession().map(agent => agent.id)).to.include('copilot');
        });

        it('does not hold the catalog for 3 s once the live stream has reported agents', async () => {
            // The backend answer has no selectable agent (all signed out) and the stream already knows the
            // harness list: nothing new can arrive, so the sheet must not wait for the 3 s window.
            const signedOut: QaapAgentTaskAgentOption = { id: 'codex', label: 'Codex', available: false, connectionState: 'disconnected' };
            const ui = new MobileProjectsStickyComposerAgentsUi(createHost({ backendAgents: [signedOut], streamAgents: [signedOut] }));

            const startedAt = Date.now();
            await ui.refreshStickyComposerAgents(project, { forceRefresh: true });

            expect(Date.now() - startedAt).to.be.lessThan(1000);
        });
    });
});
