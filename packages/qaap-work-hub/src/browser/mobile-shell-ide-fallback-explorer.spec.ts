// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { clearPreferDesktopIde, markPreferDesktopIde } from '@theia/qaap-shared-core/lib/browser/mobile-projects-open';
import { MobileShellSessionState } from '@theia/qaap-shared-core/lib/browser/mobile-shell-session-state';
import { MobileShellIdeFallbackController, MobileShellIdeFallbackHost } from './mobile-shell-ide-fallback';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const EXPLORER = 'explorer-view-container';

/** The shell's left side panel as the IDE <-> Work Hub switch sees it. */
interface LeftPanel {
    expanded: boolean;
    active?: string;
}

function harness(left: LeftPanel): { controller: MobileShellIdeFallbackController; reveals: () => number } {
    let reveals = 0;
    const noop = (): void => undefined;
    const host = {
        isMobileActive: () => true,
        shouldActivateMobileLayout: () => true,
        enterMobileLayout: noop,
        // Like restoreDesktopSplitLayout on a Work Hub boot: the desktop sidebars start collapsed.
        leaveMobileLayout: () => { left.expanded = false; },
        onMediaChange: noop,
        cancelAgentsBootstrap: noop,
        getProjectsPanel: () => undefined,
        setProjectsPanel: noop,
        tryBootstrapMobileAgentsChat: () => true,
        restoreAgentsSurfaceAfterReload: async () => undefined,
        syncMobileHubPrimaryBottomChrome: noop,
        refreshBottomBar: noop,
        refreshWorkbenchTopBar: noop,
        syncWorkHubSessionsSidebarLayout: noop,
        forceCenterColumnFullWidth: noop,
        scheduleSnapAndUiRefresh: noop,
        ensureDesktopSidePanelSizes: async () => undefined,
        requestFullShellRelayout: noop,
        syncOverlayEdgeSwipeZones: noop,
        isDesktopIdeSidePanelExpanded: () => left.expanded,
        // Like `workbench.files.action.focusFilesExplorer`: activating the Explorer expands the panel.
        revealDesktopIdeExplorer: async () => {
            reveals++;
            left.expanded = true;
            left.active = EXPLORER;
        },
    } as MobileShellIdeFallbackHost;
    const controller = new MobileShellIdeFallbackController({ host, sessionState: new MobileShellSessionState() });
    return { controller, reveals: () => reveals };
}

describe('MobileShellIdeFallbackController side panel on Work Hub -> IDE', () => {

    useSuiteJSDOM();

    beforeEach(() => {
        clearPreferDesktopIde();
        window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        };
    });

    afterEach(() => {
        clearPreferDesktopIde();
    });

    it('opens the side panel on the Explorer when the Work Hub left it collapsed (prod d9d2f81: empty IDE, "Show Side Panel" unchecked)', () => {
        const left: LeftPanel = { expanded: false };
        const { controller } = harness(left);
        controller.openDesktopIde();
        expect(left).to.deep.equal({ expanded: true, active: EXPLORER });
    });

    it('opens it again on every switch while the user keeps it open in the IDE', () => {
        const left: LeftPanel = { expanded: false };
        const { controller, reveals } = harness(left);
        controller.openDesktopIde();
        controller.returnToAgentsFromDesktopIde();
        // The Work Hub hides the IDE side panels.
        left.expanded = false;
        controller.openDesktopIde();
        expect(left.expanded).to.equal(true);
        expect(reveals()).to.equal(2);
    });

    it('keeps the side panel closed when the user closed it in the IDE', () => {
        const left: LeftPanel = { expanded: false };
        const { controller, reveals } = harness(left);
        controller.openDesktopIde();
        // "Toggle Side Panel" in the IDE.
        left.expanded = false;
        controller.returnToAgentsFromDesktopIde();
        controller.openDesktopIde();
        controller.returnToAgentsFromDesktopIde();
        controller.openDesktopIde();
        expect(left.expanded).to.equal(false);
        expect(reveals()).to.equal(1);
    });

    it('opens it again once the user reopened it in the IDE', () => {
        const left: LeftPanel = { expanded: false };
        const { controller, reveals } = harness(left);
        controller.openDesktopIde();
        left.expanded = false;
        controller.returnToAgentsFromDesktopIde();
        controller.openDesktopIde();
        left.expanded = true;
        controller.returnToAgentsFromDesktopIde();
        left.expanded = false;
        controller.openDesktopIde();
        expect(left.expanded).to.equal(true);
        expect(reveals()).to.equal(2);
    });

    it('does not read the Work Hub panel state when Agents is shown without coming from the IDE', () => {
        const left: LeftPanel = { expanded: false };
        const { controller } = harness(left);
        // Not in the IDE: the collapsed panel is the Work Hub's doing, not the user's.
        controller.returnToAgentsFromDesktopIde();
        controller.openDesktopIde();
        expect(left.expanded).to.equal(true);
    });

    it('opens the Explorer after an in-place project open marked the IDE preference first', () => {
        // onProjectsPanelOpenInIdeExtracted marks the preference before calling openDesktopIde.
        markPreferDesktopIde();
        const left: LeftPanel = { expanded: false };
        const { controller } = harness(left);
        controller.openDesktopIde();
        expect(left).to.deep.equal({ expanded: true, active: EXPLORER });
    });
});
