// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { clearQaapAuthSession, writeQaapAuthSession } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import type { QaapAgentTaskAgentOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    COMPOSER_AGENT_CATALOG_SESSION_KEY,
    composerAgentCatalogSessionKey,
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

    /** Signs the page in as `login`, the owner the cache is keyed by. */
    function signIn(login: string): void {
        writeQaapAuthSession('github', { provider: 'github', login, name: login });
    }

    // The auth session helpers dispatch through the global CustomEvent, which must come from the suite's jsdom window.
    const globalScope = globalThis as unknown as { CustomEvent?: unknown };
    let importedCustomEvent: unknown;

    beforeEach(() => {
        importedCustomEvent = globalScope.CustomEvent;
        globalScope.CustomEvent = window.CustomEvent;
        window.sessionStorage.clear();
        window.localStorage.clear();
    });

    afterEach(() => {
        clearQaapAuthSession();
        window.sessionStorage.clear();
        globalScope.CustomEvent = importedCustomEvent;
    });

    describe('owner scoping', () => {

        it('stores the catalog under the signed-in owner only', () => {
            signIn('alice');
            writeComposerAgentCatalogSession([copilot]);

            const key = composerAgentCatalogSessionKey('alice');
            expect(key).to.be.a('string');
            expect(key).to.not.equal(COMPOSER_AGENT_CATALOG_SESSION_KEY);
            expect(window.sessionStorage.getItem(key!)).to.be.a('string');
            expect(readComposerAgentCatalogSession()).to.deep.equal([copilot]);
            // Per tab only: localStorage is never used for the catalog.
            expect(window.localStorage.getItem(key!)).to.equal(null);
        });

        it('does not paint another owner\'s catalog', () => {
            writeComposerAgentCatalogSession([copilot], 'bob');

            signIn('alice');
            expect(readComposerAgentCatalogSession()).to.deep.equal([]);
            expect(readComposerAgentCatalogSession('bob')).to.deep.equal([copilot]);
        });

        it('neither reads nor writes without a known owner', () => {
            // A leftover entry for alice is in the tab, but with no signed-in owner it must not be used.
            clearQaapAuthSession();
            const aliceKey = composerAgentCatalogSessionKey('alice')!;
            window.sessionStorage.setItem(aliceKey, JSON.stringify([copilot]));

            expect(readComposerAgentCatalogSession()).to.deep.equal([]);
            writeComposerAgentCatalogSession([{ ...copilot, label: 'Anonymous' }]);
            expect(window.sessionStorage.getItem(aliceKey)).to.equal(JSON.stringify([copilot]));
            expect(window.sessionStorage.getItem(COMPOSER_AGENT_CATALOG_SESSION_KEY)).to.equal(null);
        });

        it('clears the stored catalog on sign-out', () => {
            signIn('alice');
            writeComposerAgentCatalogSession([copilot]);
            const key = composerAgentCatalogSessionKey('alice')!;
            expect(window.sessionStorage.getItem(key)).to.be.a('string');

            clearQaapAuthSession();

            expect(window.sessionStorage.getItem(key)).to.equal(null);
        });
    });

    describe('read and write', () => {

        it('returns an empty catalog for missing or malformed entries', () => {
            signIn('alice');
            const key = composerAgentCatalogSessionKey('alice')!;
            expect(readComposerAgentCatalogSession()).to.deep.equal([]);
            window.sessionStorage.setItem(key, '{not json');
            expect(readComposerAgentCatalogSession()).to.deep.equal([]);
            window.sessionStorage.setItem(key, JSON.stringify({ id: 'copilot' }));
            expect(readComposerAgentCatalogSession()).to.deep.equal([]);
            window.sessionStorage.setItem(key, JSON.stringify([null, { label: 'no id' }, copilot]));
            expect(readComposerAgentCatalogSession()).to.deep.equal([copilot]);
        });

        it('never throws when sessionStorage is blocked', () => {
            signIn('alice');
            const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
            Object.defineProperty(window, 'sessionStorage', {
                configurable: true,
                get: () => { throw new Error('blocked'); },
            });
            try {
                expect(() => writeComposerAgentCatalogSession([copilot])).to.not.throw();
                expect(readComposerAgentCatalogSession()).to.deep.equal([]);
                expect(() => clearQaapAuthSession()).to.not.throw();
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

        it('paints the signed-in owner\'s session catalog after a reload, before any backend answer', () => {
            signIn('alice');
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

        it('does not paint another owner\'s catalog after a sign-in switch', () => {
            writeComposerAgentCatalogSession([{ ...copilot, label: 'Bob agent' }], 'bob');
            signIn('alice');
            const ui = new MobileProjectsStickyComposerAgentsUi(createHost());
            const renders: Array<readonly QaapAgentTaskAgentOption[]> = [];

            ui.loadComposerAgentPickerCatalog(createChrome(), {
                cached: [],
                load: () => new Promise(() => undefined),
                isCurrent: () => true,
                render: agents => renders.push(agents),
                onError: () => undefined,
            });

            // No catalog for alice: the skeleton stays, nothing from bob is painted.
            expect(renders).to.have.length(0);
        });

        it('prefers the in-memory catalog over the session copy', () => {
            signIn('alice');
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
            signIn('alice');
            const ui = new MobileProjectsStickyComposerAgentsUi(createHost({ backendAgents: [copilot] }));

            await ui.refreshStickyComposerAgents(project, { forceRefresh: true });

            expect(readComposerAgentCatalogSession().map(agent => agent.id)).to.include('copilot');
        });

        it('stores nothing when no owner is signed in', async () => {
            const ui = new MobileProjectsStickyComposerAgentsUi(createHost({ backendAgents: [copilot] }));

            await ui.refreshStickyComposerAgents(project, { forceRefresh: true });

            expect(window.sessionStorage.length).to.equal(0);
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
