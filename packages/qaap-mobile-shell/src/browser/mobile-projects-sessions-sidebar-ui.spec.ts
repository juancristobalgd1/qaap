// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT,
    MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE,
    MobileProjectsSessionsSidebarUi,
    type MobileProjectsSessionsSidebarHost,
} from './mobile-projects-sessions-sidebar-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('mobile-projects-sessions-sidebar-ui', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('show more forces a sidebar refresh after increasing the visible conversation limit', () => {
        const project = { id: 'proj-1', name: 'Mockup', status: 'working' } as MobileProjectEntry;
        let refreshOptions: { force?: boolean } | undefined;
        const visibleCounts = new Map<string, number>();
        const host = {
            sessionsSidebarVisibleConversationCountByProjectId: visibleCounts,
            sessionsSidebar: {
                refreshList: (options?: { force?: boolean }) => { refreshOptions = options; },
            },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        const button = ui.createSessionsSidebarShowMoreControl(project, 20, 25);

        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(visibleCounts.get(project.id)).to.equal(
            MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT
            + MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE,
        );
        expect(refreshOptions).to.deep.equal({ force: true });
    });

});
