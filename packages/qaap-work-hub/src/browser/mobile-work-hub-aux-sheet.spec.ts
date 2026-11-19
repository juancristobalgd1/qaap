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
import { MobileProjectsExecutionSurfaceTabsUi, type MobileProjectsExecutionSurfaceTabsHost } from './mobile-projects-execution-surface-tabs-ui';
import { createMobileAuxSheetTrigger } from './mobile-projects-execution-surface-tabs-ui-render';
import { MobileProjectsHubHeaderUi, type MobileProjectsHubHeaderHost } from './mobile-projects-hub-header-ui';
import { MOBILE_WORK_HUB_AUX_SHEET_TRIGGER_CLASS, MobileWorkHubAuxSheet } from './mobile-work-hub-aux-sheet';
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

    function createUi(): MobileProjectsExecutionSurfaceTabsUi {
        const host = {
            executionSurfaceTabByProjectId: new Map(),
            root: document.createElement('div'),
            executionTabOverflowDispose: Disposable.NULL,
            projects: [],
            transcriptOpenProject: { id: 'p1', name: 'P' },
            transcriptOpenSummary: { id: 'c1', title: 'T' },
        } as unknown as MobileProjectsExecutionSurfaceTabsHost;
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);
        created.push(ui);
        return ui;
    }

    beforeEach(() => {
        originalMatchMedia = window.matchMedia;
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
        created.splice(0).forEach(ui => ui.dispose());
        document.body.replaceChildren();
    });

    it('the conversation header trigger opens the sheet on the Side chat tab in the mobile layout', () => {
        mockViewport(true);
        const ui = createUi();
        const trigger = createMobileAuxSheetTrigger(ui);
        expect(trigger.classList.contains(MOBILE_WORK_HUB_AUX_SHEET_TRIGGER_CLASS)).to.equal(true);
        document.body.append(trigger);
        trigger.click();
        const sheet = ui.resolveMobileAuxSheet()!;
        expect(sheet.isOpen).to.equal(true);
        expect(sheet.activeTab).to.equal('side-chat');
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

    it('Escape and the close button hand focus back to the header trigger that opened the sheet', () => {
        mockViewport(true);
        const ui = createUi();
        const trigger = createMobileAuxSheetTrigger(ui);
        document.body.append(trigger);
        trigger.click();
        const sheet = ui.resolveMobileAuxSheet()!;
        expect(document.activeElement).to.equal(sheet.node.querySelector('[data-tab="side-chat"]'));

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(sheet.isOpen).to.equal(false);
        expect(document.activeElement).to.equal(trigger);

        trigger.click();
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

    describe('Work Hub header trigger', () => {
        function createHeader(overrides: Record<string, unknown> = {}): { ui: MobileProjectsHubHeaderUi; exec: MobileProjectsExecutionSurfaceTabsUi; titleRow: HTMLElement } {
            const titleRow = document.createElement('div');
            titleRow.className = 'theia-mobile-projects-title-row';
            document.body.append(titleRow);
            const exec = createUi();
            const host = {
                titleRow,
                executionSurfaceTabsUi: exec,
                hubView: 'tasks',
                agentsHubInlineActive: true,
                transcriptOpenProject: { id: 'p1', name: 'P' },
                transcriptOpenSummary: { id: 'c1', title: 'T' },
                // The hub stays in landing mode while a conversation is open inline: the trigger must still show.
                shouldUseAgentsHubLanding: () => true,
                ...overrides,
            } as unknown as MobileProjectsHubHeaderHost;
            return { ui: new MobileProjectsHubHeaderUi(host), exec, titleRow };
        }
        function headerTrigger(titleRow: HTMLElement): HTMLButtonElement | null {
            return titleRow.querySelector<HTMLButtonElement>(`.${MOBILE_WORK_HUB_AUX_SHEET_TRIGGER_CLASS}`);
        }

        it('shows with a conversation open in the mobile layout and opens the sheet', () => {
            mockViewport(true);
            const { ui, exec, titleRow } = createHeader();
            ui.syncAuxSheetTrigger();
            const trigger = headerTrigger(titleRow)!;
            expect(trigger).to.not.equal(null);
            expect(trigger.hidden).to.equal(false);
            expect(trigger.getAttribute('aria-label')).to.equal('Open views');
            trigger.click();
            expect(exec.resolveMobileAuxSheet()!.isOpen).to.equal(true);
        });

        it('stays hidden on the landing (no open conversation) and on desktop', () => {
            mockViewport(true);
            const landing = createHeader({ transcriptOpenSummary: undefined, agentsHubInlineActive: false });
            landing.ui.syncAuxSheetTrigger();
            expect(headerTrigger(landing.titleRow)!.hidden).to.equal(true);

            const noInlineConversation = createHeader({ agentsHubInlineActive: false });
            noInlineConversation.ui.syncAuxSheetTrigger();
            expect(headerTrigger(noInlineConversation.titleRow)!.hidden).to.equal(true);

            mockViewport(false);
            const desktop = createHeader();
            desktop.ui.syncAuxSheetTrigger();
            expect(headerTrigger(desktop.titleRow)!.hidden).to.equal(true);
        });

        it('never shows two triggers at once: the transcript sheet keeps its own and this one steps aside', () => {
            mockViewport(true);
            const { ui, exec, titleRow } = createHeader();
            ui.syncAuxSheetTrigger();
            const sheetTrigger = createMobileAuxSheetTrigger(exec);
            const transcriptRoot = document.createElement('div');
            transcriptRoot.className = 'theia-mobile-agent-transcript-root';
            transcriptRoot.append(sheetTrigger);
            document.body.append(transcriptRoot);
            ui.syncAuxSheetTrigger();
            const visible = Array.from(document.querySelectorAll<HTMLButtonElement>(`.${MOBILE_WORK_HUB_AUX_SHEET_TRIGGER_CLASS}`))
                .filter(button => !button.hidden);
            expect(visible).to.deep.equal([sheetTrigger]);
            expect(headerTrigger(titleRow)!.hidden).to.equal(true);
        });

        it('the trigger CSS respects the hidden attribute', () => {
            const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-work-hub-mobile-aux-sheet.css'), 'utf8');
            expect(css).to.contain('.theia-mobile-work-hub-aux-sheet-trigger[hidden]');
        });
    });

    it('the desktop layout has no sheet and keeps the right panel', () => {
        mockViewport(false);
        const ui = createUi();
        expect(ui.resolveMobileAuxSheet()).to.equal(undefined);
        expect(ui.openMobileAuxSheet('side-chat')).to.equal(false);
        expect(ui.resolveWorkHubAuxPanel()).to.not.equal(undefined);
    });

    it('shows the trigger only below the 767px breakpoint', () => {
        const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-work-hub-mobile-aux-sheet.css'), 'utf8');
        expect(css).to.match(/^\.theia-mobile-work-hub-aux-sheet-trigger \{\s*display: none;/m);
        expect(css).to.contain('@media (max-width: 767px)');
        const mobileBlock = css.slice(css.indexOf('@media (max-width: 767px)'));
        expect(mobileBlock).to.contain('.theia-mobile-work-hub-aux-sheet-trigger {');
        expect(mobileBlock).to.contain('display: inline-flex');
        expect(mobileBlock).to.contain('min-height: 0');
        expect(mobileBlock).to.contain('safe-area-inset-bottom');
    });
});
