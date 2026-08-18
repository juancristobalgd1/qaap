// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import { QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY } from './mobile-work-hub-sessions-sidebar';
import {
    MobileProjectsPanelChromeUi,
    mountHeaderProjectButtonContents,
    type MobileProjectsPanelChromeHost,
} from './mobile-projects-panel-chrome-ui';
import type { MobileViewToggleId } from './qaap-workbench-account-menu';

describe('MobileProjectsPanelChromeUi header IDE/Agents switch', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        document.body.innerHTML = '';
        document.body.classList.remove('theia-mobile-mod-desktop-ide');
    });

    function stubMatchMedia(desktop: boolean): void {
        window.matchMedia = (query: string): MediaQueryList => ({
            matches: query.includes('max-width: 767px')
                ? !desktop
                : desktop && query === QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
    }

    function createHost(): MobileProjectsPanelChromeHost & { selectedView: MobileViewToggleId } {
        const host = {
            homeMode: true,
            root: document.createElement('div'),
            selectedView: 'agent' as MobileViewToggleId,
            onAccountClick: () => undefined,
            handleHeaderBackClick: () => undefined,
            openWorkHubSessionsSidebar: () => undefined,
            onHeaderProjectClick: () => undefined,
            onHeaderNewChatClick: async () => undefined,
            onHeaderOverflowMenuClick: () => undefined,
            workHubSearchUi: { openWorkHubSearchQuickPick: () => undefined },
            onNewClick: async () => undefined,
            onTitleTap: () => undefined,
            composerHeaderUi: {
                resolveActiveViewToggleId: () => host.selectedView,
                updateStickyComposerFabLift: () => undefined,
            },
            onHeaderViewModeChange: (id: MobileViewToggleId) => {
                host.selectedView = id;
            },
            updateAccountAvatar: () => undefined,
            hide: () => undefined,
            refreshInboxPullRequests: async () => undefined,
            refreshProjects: async () => undefined,
            delegate: { onDismiss: () => undefined },
            hubView: 'tasks',
            dragDismissDispose: Disposable.NULL,
            pullToRefreshDispose: Disposable.NULL,
        } as unknown as MobileProjectsPanelChromeHost & { selectedView: MobileViewToggleId };
        return host;
    }

    it('mounts the IDE/Agents switch in the header main row, not the sidebar', () => {
        stubMatchMedia(true);
        const host = createHost();
        const chrome = new MobileProjectsPanelChromeUi(host);
        chrome.constructPanelShell();
        document.body.append(host.root);

        const headerMain = host.root.querySelector('.theia-mobile-projects-header-main');
        const switchHost = host.root.querySelector<HTMLElement>('.theia-mobile-projects-header-ide-agents-switch');
        expect(headerMain).to.not.equal(null);
        expect(switchHost).to.not.equal(null);
        expect(headerMain!.contains(switchHost)).to.equal(true);
        expect(switchHost!.querySelector('.theia-workbench-view-mode-switch')).to.not.equal(null);
        expect(switchHost!.querySelector('.theia-qaap-segmented-bar')).to.not.equal(null);
        expect(host.root.querySelector('.theia-mobile-work-hub-sessions-sidebar-view-switch')).to.equal(null);
        expect(switchHost!.hidden).to.equal(false);
        chrome.dispose();
    });

    it('hides the header switch on mobile and in the classic IDE', () => {
        stubMatchMedia(false);
        const host = createHost();
        const chrome = new MobileProjectsPanelChromeUi(host);
        chrome.constructPanelShell();
        expect(host.headerIdeAgentsSwitchHost.hidden).to.equal(true);

        stubMatchMedia(true);
        chrome.syncHeaderIdeAgentsSwitch();
        expect(host.headerIdeAgentsSwitchHost.hidden).to.equal(false);

        document.body.classList.add('theia-mobile-mod-desktop-ide');
        chrome.syncHeaderIdeAgentsSwitch();
        expect(host.headerIdeAgentsSwitchHost.hidden).to.equal(true);
        chrome.dispose();
    });

    it('mounts the header project cluster with folder and conversations chevrons', () => {
        stubMatchMedia(true);
        const host = createHost();
        const chrome = new MobileProjectsPanelChromeUi(host);
        chrome.constructPanelShell();
        expect(host.titleRow.contains(host.headerProjectCluster)).to.equal(true);
        expect(host.headerProjectCluster.contains(host.headerProjectBtn)).to.equal(true);
        expect(host.headerProjectCluster.contains(host.headerConversationsBtn)).to.equal(true);
        expect(host.headerProjectBtn.querySelector('.codicon-folder')).to.not.equal(null);
        expect(host.headerProjectBtn.querySelector('.codicon-chevron-down')).to.not.equal(null);
        expect(host.headerConversationsBtn.querySelector('.theia-mobile-projects-header-conversations-icon')).to.not.equal(null);
        let clicked = false;
        host.onHeaderProjectClick = () => { clicked = true; };
        host.headerProjectBtn.click();
        expect(clicked).to.equal(true);
        chrome.dispose();
    });

    it('forwards IDE/Agents selection from the header switch', () => {
        stubMatchMedia(true);
        const host = createHost();
        const chrome = new MobileProjectsPanelChromeUi(host);
        chrome.constructPanelShell();
        const ide = host.headerIdeAgentsSwitchHost.querySelector<HTMLButtonElement>('[data-segment-id="editor"]');
        expect(ide).to.not.equal(null);
        ide!.click();
        expect(host.selectedView).to.equal('editor');
        chrome.dispose();
    });
});

describe('mountHeaderProjectButtonContents', () => {

    beforeEach(() => {
        if (typeof document === 'undefined') {
            enableJSDOM();
        }
    });

    it('puts the project chevron beside the folder and a conversations chevron after the title', () => {
        const cluster = document.createElement('div');
        const switcher = document.createElement('button');
        const conversations = document.createElement('button');
        const label = document.createElement('span');
        label.textContent = 'sample-files1';
        const { folder, separator, projectChevron, conversationsChevron } = mountHeaderProjectButtonContents(
            cluster, switcher, conversations, label,
        );

        expect(folder.classList.contains('codicon-folder')).to.equal(true);
        expect(separator.textContent).to.equal('|');
        expect(separator.hidden).to.equal(true);
        expect(projectChevron.classList.contains('codicon-chevron-down')).to.equal(true);
        expect(conversationsChevron.classList.contains('codicon-chevron-down')).to.equal(true);
        expect(conversationsChevron.classList.contains('theia-mobile-projects-header-conversations-icon')).to.equal(true);
        expect(Array.from(cluster.childNodes)).to.deep.equal([switcher, separator, conversations]);
        expect(Array.from(switcher.childNodes)).to.deep.equal([folder, projectChevron]);
        expect(Array.from(conversations.childNodes)).to.deep.equal([label, conversationsChevron]);
        expect(label.className).to.equal('theia-mobile-projects-header-project-label');
    });
});
