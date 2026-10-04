// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { writeStoredAgent } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { MobileProjectsStickyComposerAgentsUi, type MobileProjectsStickyComposerAgentsHost } from './mobile-projects-sticky-composer-agents-ui';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('MobileProjectsStickyComposerAgentsUi', () => {

    useSuiteJSDOM();

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

    function createHost(stickyComposerPinnedAgentId?: string): MobileProjectsStickyComposerAgentsHost {
        return {
            stickyComposerPinnedAgentId,
            stickyComposerBackendAgents: [{ id: 'copilot', label: 'Copilot CLI', available: true }],
            stickyComposerQaiqModels: [],
            preparedCwdByProjectId: new Map(),
            projectsService: {
                getProjectCwd: () => '/workspace/project',
            } as unknown as MobileProjectsStickyComposerAgentsHost['projectsService'],
            stickyComposerRenderUi: {} as MobileProjectsStickyComposerAgentsHost['stickyComposerRenderUi'],
            loadBackendAgentSnapshot: async () => ({
                agents: [],
                agentConfigured: false,
                qaiqInstalled: false,
                qaiqModels: [],
            }),
            resolveConversationAgentLabel: () => 'Copilot CLI',
            projectRowsUi: {} as MobileProjectsStickyComposerAgentsHost['projectRowsUi'],
        };
    }

    beforeEach(() => {
        window.localStorage.clear();
    });

    it('keeps an explicit shell selection when the VPS catalog contains coding agents', () => {
        const ui = new MobileProjectsStickyComposerAgentsUi(createHost('shell'));

        expect(ui.resolveStickyComposerPinnedAgentId(project)).to.equal('shell');
    });

    it('keeps a stored shell fallback actionable while the catalog is warming', () => {
        writeStoredAgent('/workspace/project', 'shell');
        const ui = new MobileProjectsStickyComposerAgentsUi(createHost());

        expect(ui.resolveStickyComposerPinnedAgentId(project)).to.equal('shell');
    });

    it('keeps the visible shell fallback stable until a coding agent is explicitly selected', () => {
        const ui = new MobileProjectsStickyComposerAgentsUi(createHost());

        expect(ui.resolveStickyComposerPinnedAgentId(project)).to.equal('shell');
    });

    it('recognizes a harness as connected after the backend catalog refreshes', () => {
        const host = createHost();
        host.stickyComposerBackendAgents = [
            { id: 'Codex', label: 'Codex', available: true, connectionState: 'connected' },
            { id: 'opencode', label: 'OpenCode', available: false, connectionState: 'disconnected' },
        ];
        const ui = new MobileProjectsStickyComposerAgentsUi(host);

        expect(ui.isAgentConnected('codex')).to.equal(true);
        expect(ui.isAgentConnected('opencode')).to.equal(false);
        expect(ui.isAgentConnected('missing')).to.equal(false);
    });

    describe('loadComposerAgentPickerCatalog', () => {
        type PickerAgents = readonly { readonly id: string; readonly available?: boolean }[];

        function createChrome(): ComposerAgentPickerChrome {
            return {
                list: document.createElement('div'),
                header: document.createElement('div'),
            } as unknown as ComposerAgentPickerChrome;
        }

        const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

        it('paints the cached catalog before the backend answers and skips an unchanged refresh', async () => {
            const ui = new MobileProjectsStickyComposerAgentsUi(createHost());
            const renders: PickerAgents[] = [];
            let finishLoad: (agents: PickerAgents) => void = () => undefined;
            const cached = [{ id: 'codex', label: 'Codex', available: true }];
            ui.loadComposerAgentPickerCatalog(createChrome(), {
                cached,
                load: () => new Promise(resolve => { finishLoad = resolve as (agents: PickerAgents) => void; }),
                isCurrent: () => true,
                render: agents => renders.push(agents),
                onError: () => expect.fail('cached catalog must not show the error state'),
            });

            expect(renders).to.have.length(1);
            expect(renders[0].map(agent => agent.id)).to.include('codex');
            finishLoad(ui.getComposerAgentPickerAgents(cached));
            await flush();
            expect(renders).to.have.length(1);
        });

        it('repaints a changed catalog unless the user drilled into a model list', async () => {
            const cached = [{ id: 'codex', label: 'Codex', available: true }];
            const refreshed = [{ id: 'codex', label: 'Codex', available: false, connectionState: 'disconnected' as const }];
            for (const drilledDown of [false, true]) {
                const ui = new MobileProjectsStickyComposerAgentsUi(createHost());
                const chrome = createChrome();
                const renders: PickerAgents[] = [];
                ui.loadComposerAgentPickerCatalog(chrome, {
                    cached,
                    load: async () => {
                        chrome.header.classList.toggle('theia-mod-drilldown', drilledDown);
                        return ui.getComposerAgentPickerAgents(refreshed);
                    },
                    isCurrent: () => true,
                    render: agents => renders.push(agents),
                    onError: () => undefined,
                });
                await flush();
                expect(renders, String(drilledDown)).to.have.length(drilledDown ? 1 : 2);
            }
        });

        it('shows the skeleton without a cache and the retry state only when nothing is painted', async () => {
            const ui = new MobileProjectsStickyComposerAgentsUi(createHost());
            const chrome = createChrome();
            const renders: PickerAgents[] = [];
            let errors = 0;
            ui.loadComposerAgentPickerCatalog(chrome, {
                cached: [],
                load: () => Promise.reject(new Error('offline')),
                isCurrent: () => true,
                render: agents => renders.push(agents),
                onError: () => { errors++; },
            });
            expect(chrome.list.childElementCount).to.be.greaterThan(0);
            await flush();
            expect(renders).to.have.length(0);
            expect(errors).to.equal(1);

            ui.loadComposerAgentPickerCatalog(createChrome(), {
                cached: [{ id: 'codex', label: 'Codex', available: true }],
                load: () => Promise.reject(new Error('offline')),
                isCurrent: () => true,
                render: agents => renders.push(agents),
                onError: () => { errors++; },
            });
            await flush();
            expect(renders).to.have.length(1);
            expect(errors).to.equal(1);
        });
    });
});
