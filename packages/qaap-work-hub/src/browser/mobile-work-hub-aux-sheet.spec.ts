// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { MOBILE_NARROW_VIEWPORT_MEDIA_QUERY } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { Disposable } from '@theia/core/lib/common/disposable';
import { QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID } from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';
import { MobileProjectsExecutionSurfaceTabsUi, type MobileProjectsExecutionSurfaceTabsHost } from './mobile-projects-execution-surface-tabs-ui';
import { MobileWorkHubAuxSheet } from './mobile-work-hub-aux-sheet';
import { QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY } from './mobile-work-hub-sessions-sidebar';
import type { QaapWorkHubPullRequestTarget } from './qaap-work-hub-aux-pull-request-model';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const BRANCH_TARGET: QaapWorkHubPullRequestTarget = { owner: 'acme', repo: 'app', branch: 'feat/x', scope: 'branch' };

describe('mobile-work-hub-aux-sheet', () => {
    useSuiteJSDOM();

    let sheet: MobileWorkHubAuxSheet;
    let external: string[];

    beforeEach(() => {
        external = [];
        sheet = new MobileWorkHubAuxSheet({
            host: {
                resolvePullRequestTarget: () => BRANCH_TARGET,
                openExternal: url => { external.push(url); },
            },
        });
    });

    afterEach(() => {
        sheet.dispose();
        document.body.replaceChildren();
        document.body.className = '';
    });

    it('mounts the Side chat and Pull request views from the desktop panel classes', () => {
        sheet.open('side-chat');
        expect(sheet.node.isConnected).to.equal(true);
        expect(sheet.node.getAttribute('role')).to.equal('dialog');
        expect(sheet.node.getAttribute('aria-modal')).to.equal('true');
        expect(sheet.node.querySelector('.qaap-work-hub-aux-side-chat')).to.equal(sheet.sideChatView.element);
        expect(sheet.node.querySelector('.qaap-work-hub-aux-pr')).to.equal(sheet.pullRequestView.element);
        const tabs = Array.from(sheet.node.querySelectorAll<HTMLElement>('[role="tab"]')).map(tab => tab.dataset.tab);
        expect(tabs).to.deep.equal(['side-chat', 'pull-request']);
    });

    it('shows one view at a time and switches with the tabs', () => {
        sheet.open('side-chat');
        expect(sheet.sideChatView.element.hidden).to.equal(false);
        expect(sheet.pullRequestView.element.hidden).to.equal(true);
        sheet.node.querySelector<HTMLButtonElement>('[data-tab="pull-request"]')!.click();
        expect(sheet.activeTab).to.equal('pull-request');
        expect(sheet.sideChatView.element.hidden).to.equal(true);
        expect(sheet.pullRequestView.element.hidden).to.equal(false);
        expect(sheet.node.querySelector('[data-tab="pull-request"]')!.getAttribute('aria-selected')).to.equal('true');
        expect(sheet.node.querySelector('[data-tab="side-chat"]')!.getAttribute('aria-selected')).to.equal('false');
    });

    it('opens on the Pull request tab pinned to a transcript chip until it is closed', () => {
        const ref = { owner: 'acme', repo: 'app', number: 42 };
        sheet.open('pull-request', ref);
        expect(sheet.activeTab).to.equal('pull-request');
        expect(sheet.pullRequestView.element.textContent).to.contain('acme/app#42');
        sheet.close();
        sheet.open('pull-request');
        expect(sheet.pullRequestView.element.textContent).to.not.contain('acme/app#42');
    });

    it('closes with the close button, the backdrop and Escape, and hides the views', () => {
        sheet.open('side-chat');
        sheet.node.querySelector<HTMLButtonElement>('.theia-mobile-work-hub-aux-sheet-close')!.click();
        expect(sheet.isOpen).to.equal(false);
        expect(sheet.node.hidden).to.equal(true);
        expect(document.body.classList.contains('theia-mobile-mod-aux-sheet-open')).to.equal(false);

        sheet.open('side-chat');
        sheet.node.querySelector<HTMLElement>('.theia-mobile-work-hub-aux-sheet-backdrop')!.click();
        expect(sheet.isOpen).to.equal(false);

        sheet.open('pull-request');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(sheet.isOpen).to.equal(false);
    });

    it('focuses the active tab on open and gives focus back on close', () => {
        const opener = document.createElement('button');
        document.body.append(opener);
        opener.focus();
        sheet.open('side-chat');
        expect(document.activeElement).to.equal(sheet.node.querySelector('[data-tab="side-chat"]'));
        sheet.close();
        expect(document.activeElement).to.equal(opener);
    });

    it('moves between tabs with the arrow keys', () => {
        sheet.open('side-chat');
        sheet.node.querySelector('[role="tablist"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect(sheet.activeTab).to.equal('pull-request');
    });

    it('inside the sheet the views show no title or close button of their own; the desktop panel keeps them', () => {
        const styles = path.join(__dirname, '..', '..', 'src', 'browser', 'style');
        const mobileCss = fs.readFileSync(path.join(styles, 'qaap-work-hub-mobile-aux-sheet.css'), 'utf8');
        const desktopCss = fs.readFileSync(path.join(styles, 'qaap-work-hub-aux-side-chat.css'), 'utf8');
        sheet.open('side-chat');
        // The DOM still has them: the sheet only hides them with CSS scoped to its own body.
        expect(sheet.sideChatView.element.querySelector('.qaap-work-hub-aux-side-chat-title')).to.not.equal(null);
        expect(sheet.sideChatView.element.querySelector('.qaap-work-hub-aux-side-chat-close')).to.not.equal(null);
        const mobileBlock = mobileCss.slice(mobileCss.indexOf('@media (max-width: 767px)'));
        expect(mobileBlock).to.match(/\.theia-mobile-work-hub-aux-sheet-body \.qaap-work-hub-aux-side-chat-header \.qaap-work-hub-aux-side-chat-title,\s*\.theia-mobile-work-hub-aux-sheet-body \.qaap-work-hub-aux-side-chat-actions \.qaap-work-hub-aux-side-chat-close \{\s*display: none;/);
        // Nothing outside the sheet's scope hides them, so the desktop right panel keeps its title and ✕.
        expect(mobileCss.replace(/\.theia-mobile-work-hub-aux-sheet-body [^{]*\{/g, '')).to.not.match(/side-chat-(title|close)[^{]*\{\s*display: none/);
        expect(desktopCss).to.not.match(/side-chat-(title|close)[^{]*\{[^}]*display:\s*none/);
        // The Pull request view has no header or close button of its own in the sheet.
        sheet.open('pull-request');
        expect(sheet.pullRequestView.element.querySelector('.theia-mobile-work-hub-aux-sheet-close')).to.equal(null);
        expect(sheet.pullRequestView.element.querySelector('.qaap-work-hub-aux-pr-title-bar, .qaap-work-hub-aux-pr-close')).to.equal(null);
    });

    it('registers its scrollers with the touch scroll selector', () => {
        const selectors = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'qaap-mobile-shell', 'src', 'browser', 'mobile-vertical-touch-scroll.ts'), 'utf8');
        expect(selectors).to.contain('.qaap-work-hub-aux-pr-scroll');
        expect(selectors).to.contain('.qaap-work-hub-aux-side-chat-transcript');
    });
});

describe('mobile-work-hub-aux-sheet entry points', () => {
    useSuiteJSDOM();

    let originalMatchMedia: typeof window.matchMedia;
    const created: MobileProjectsExecutionSurfaceTabsUi[] = [];

    function mockViewport(mobile: boolean): void {
        window.matchMedia = ((query: string) => ({
            matches: mobile ? query === MOBILE_NARROW_VIEWPORT_MEDIA_QUERY : query === QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY,
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        })) as unknown as typeof window.matchMedia;
    }

    function createUi(overrides: Partial<MobileProjectsExecutionSurfaceTabsHost> = {}): MobileProjectsExecutionSurfaceTabsUi {
        const root = document.createElement('div');
        document.body.append(root);
        const host = {
            executionSurfaceTabByProjectId: new Map(),
            root,
            scroll: document.createElement('div'),
            executionTabOverflowDispose: Disposable.NULL,
            cardMenuUi: { closeCardMenu: () => undefined },
            projects: [],
            transcriptOpenProject: { id: 'p1', name: 'P' },
            transcriptOpenSummary: { id: 'c1', title: 'T' },
            ...overrides,
        } as unknown as MobileProjectsExecutionSurfaceTabsHost;
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);
        created.push(ui);
        return ui;
    }

    function openViewsMenu(strip: HTMLElement): { trigger: HTMLButtonElement; menu: HTMLElement } {
        const trigger = strip.querySelector<HTMLButtonElement>('.theia-mobile-transcript-tab-icon-select')!;
        trigger.click();
        const menu = document.querySelector<HTMLElement>('.theia-mobile-transcript-tab-icon-select-menu.theia-mod-open')!;
        return { trigger, menu };
    }

    beforeEach(() => {
        originalMatchMedia = window.matchMedia;
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
        created.splice(0).forEach(ui => {
            ui.closeExecutionTabOverflowMenu();
            ui.dispose();
        });
        document.body.replaceChildren();
    });

    it('adds Side chat and Pull request to the mobile views dropdown and opens the sheet on the picked tab', () => {
        mockViewport(true);
        const ui = createUi();
        const strip = ui.buildExecutionViewTabStrip('messages', () => undefined);
        document.body.append(strip);

        const { menu } = openViewsMenu(strip);
        const labels = Array.from(menu.querySelectorAll('.theia-mobile-transcript-tab-icon-select-option-label'))
            .map(label => label.textContent);
        expect(labels).to.deep.equal(['Browser', 'Changes', 'Files', 'Terminal', 'Side chat', 'Pull request']);

        const sideChatBtn = menu.querySelector<HTMLButtonElement>('[data-aux-tab="side-chat"]')!;
        const pullRequestBtn = menu.querySelector<HTMLButtonElement>('[data-aux-tab="pull-request"]')!;
        expect(sideChatBtn.disabled).to.equal(false);
        expect(pullRequestBtn.disabled).to.equal(false);

        sideChatBtn.click();
        const sheet = ui.resolveMobileAuxSheet()!;
        expect(sheet.isOpen).to.equal(true);
        expect(sheet.activeTab).to.equal('side-chat');
        expect(menu.hidden).to.equal(true);

        sheet.close();
        const reopened = openViewsMenu(strip);
        reopened.menu.querySelector<HTMLButtonElement>('[data-aux-tab="pull-request"]')!.click();
        expect(sheet.isOpen).to.equal(true);
        expect(sheet.activeTab).to.equal('pull-request');
    });

    it('disables Side chat and Pull request in the views dropdown when no conversation is open', () => {
        mockViewport(true);
        const noConversation = createUi({ transcriptOpenSummary: undefined });
        const strip = noConversation.buildExecutionViewTabStrip('messages', () => undefined);
        document.body.append(strip);

        const { menu } = openViewsMenu(strip);
        const sideChatBtn = menu.querySelector<HTMLButtonElement>('[data-aux-tab="side-chat"]')!;
        const pullRequestBtn = menu.querySelector<HTMLButtonElement>('[data-aux-tab="pull-request"]')!;
        expect(sideChatBtn.disabled).to.equal(true);
        expect(sideChatBtn.getAttribute('aria-disabled')).to.equal('true');
        expect(pullRequestBtn.disabled).to.equal(true);
        expect(pullRequestBtn.getAttribute('aria-disabled')).to.equal('true');
        sideChatBtn.click();
        pullRequestBtn.click();
        expect(noConversation.resolveMobileAuxSheet()?.isOpen).to.equal(false);

        // The synthetic idle landing summary also counts as having no open conversation.
        noConversation.closeExecutionTabOverflowMenu();
        noConversation.host.transcriptOpenSummary = {
            id: QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID,
            title: 'New task',
        } as unknown as MobileProjectsExecutionSurfaceTabsHost['transcriptOpenSummary'];
        const idleOpen = openViewsMenu(strip);
        expect(idleOpen.menu.querySelector<HTMLButtonElement>('[data-aux-tab="side-chat"]')!.disabled).to.equal(true);
        expect(idleOpen.menu.querySelector<HTMLButtonElement>('[data-aux-tab="pull-request"]')!.disabled).to.equal(true);

        // Opening a real conversation enables both options the next time the menu opens.
        noConversation.closeExecutionTabOverflowMenu();
        noConversation.host.transcriptOpenSummary = {
            id: 'conv-live',
            title: 'Fix bug',
        } as unknown as MobileProjectsExecutionSurfaceTabsHost['transcriptOpenSummary'];
        const liveOpen = openViewsMenu(strip);
        expect(liveOpen.menu.querySelector<HTMLButtonElement>('[data-aux-tab="side-chat"]')!.disabled).to.equal(false);
        expect(liveOpen.menu.querySelector<HTMLButtonElement>('[data-aux-tab="pull-request"]')!.disabled).to.equal(false);
    });

    it('a pull request chip opens the sheet on the Pull request tab with that pull request', () => {
        mockViewport(true);
        const ui = createUi();
        const opened = ui.openPullRequestInWorkHubAuxPanel({ owner: 'acme', repo: 'app', number: 7 });
        expect(opened).to.equal(true);
        const sheet = ui.resolveMobileAuxSheet()!;
        expect(sheet.isOpen).to.equal(true);
        expect(sheet.activeTab).to.equal('pull-request');
        expect(sheet.pullRequestView.element.textContent).to.contain('acme/app#7');
    });

    it('Escape and the close button hand focus back to the views dropdown trigger', () => {
        mockViewport(true);
        const ui = createUi();
        const strip = ui.buildExecutionViewTabStrip('messages', () => undefined);
        document.body.append(strip);

        const { trigger, menu } = openViewsMenu(strip);
        menu.querySelector<HTMLButtonElement>('[data-aux-tab="side-chat"]')!.click();
        const sheet = ui.resolveMobileAuxSheet()!;
        expect(document.activeElement).to.equal(sheet.node.querySelector('[data-tab="side-chat"]'));

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(sheet.isOpen).to.equal(false);
        expect(document.activeElement).to.equal(trigger);

        openViewsMenu(strip).menu.querySelector<HTMLButtonElement>('[data-aux-tab="side-chat"]')!.click();
        sheet.node.querySelector<HTMLButtonElement>('.theia-mobile-work-hub-aux-sheet-close')!.click();
        expect(sheet.isOpen).to.equal(false);
        expect(document.activeElement).to.equal(trigger);
    });

    it('a pull request chip returns focus to the element that was focused before the sheet opened', () => {
        mockViewport(true);
        const ui = createUi();
        const chip = document.createElement('button');
        document.body.append(chip);
        chip.focus();
        ui.openPullRequestInWorkHubAuxPanel({ owner: 'acme', repo: 'app', number: 9 });
        const sheet = ui.resolveMobileAuxSheet()!;
        sheet.close();
        expect(document.activeElement).to.equal(chip);
    });

    it('does not render a standalone aux-sheet trigger button in headers', () => {
        mockViewport(true);
        const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-work-hub-mobile-aux-sheet.css'), 'utf8');
        expect(css).to.not.contain('theia-mobile-work-hub-aux-sheet-trigger');
        expect(css).to.contain('@media (max-width: 767px)');
        const mobileBlock = css.slice(css.indexOf('@media (max-width: 767px)'));
        expect(mobileBlock).to.contain('min-height: 0');
        expect(mobileBlock).to.contain('safe-area-inset-bottom');
    });

    it('the desktop layout has no sheet, adds no mobile aux options to the dropdown, and keeps the right panel', () => {
        mockViewport(false);
        const ui = createUi();
        expect(ui.resolveMobileAuxSheet()).to.equal(undefined);
        expect(ui.openMobileAuxSheet('side-chat')).to.equal(false);
        expect(ui.resolveWorkHubAuxPanel()).to.not.equal(undefined);
        const strip = ui.buildExecutionViewTabStrip('messages', () => undefined);
        expect(strip.querySelector('[data-aux-tab]')).to.equal(null);
    });
});
