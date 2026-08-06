// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { initWorkHubBootstrapControllerExtracted } from './mobile-one-column-shell-contribution-render2';
import { MobileShellSessionState } from './mobile-shell-session-state';

describe('mobile-shell-work-hub-bootstrap host wiring', () => {

    it('provides the sessions sidebar layout synchronizer', () => {
        let syncCalls = 0;
        const context: {
            projectsPanel: { syncSessionsSidebarLayout: () => void };
            workHubBootstrapHost?: { syncWorkHubSessionsSidebarLayout?: () => void };
            [key: string]: unknown;
        } = {
            projectsPanel: {
                syncSessionsSidebarLayout: () => { syncCalls++; },
            },
            shell: { node: document.createElement('div') },
            workspaceService: { ready: Promise.resolve() },
            projectsService: { setHubView: () => undefined },
            sessionState: new MobileShellSessionState(),
        };

        initWorkHubBootstrapControllerExtracted(context);

        expect(context.workHubBootstrapHost?.syncWorkHubSessionsSidebarLayout).to.be.a('function');
        context.workHubBootstrapHost?.syncWorkHubSessionsSidebarLayout?.();
        expect(syncCalls).to.equal(1);
    });
});
