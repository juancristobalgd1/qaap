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
});
