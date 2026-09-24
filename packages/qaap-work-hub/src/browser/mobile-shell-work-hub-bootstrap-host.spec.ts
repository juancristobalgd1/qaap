// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { initWorkHubBootstrapControllerExtracted } from './mobile-one-column-shell-contribution-render';
import { MobileShellSessionState } from '@theia/qaap-shared-core/lib/browser/mobile-shell-session-state';
import type { MobileOneColumnShellContributionContext } from './mobile-one-column-shell-contribution-context';
import { useSuiteJSDOM } from './test/qaap-jsdom-suite';

disableImportJSDOM();

describe('mobile-shell-work-hub-bootstrap host wiring', () => {

    useSuiteJSDOM();

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

        initWorkHubBootstrapControllerExtracted(context as unknown as MobileOneColumnShellContributionContext);

        expect(context.workHubBootstrapHost?.syncWorkHubSessionsSidebarLayout).to.be.a('function');
        context.workHubBootstrapHost?.syncWorkHubSessionsSidebarLayout?.();
        expect(syncCalls).to.equal(1);
    });
});
