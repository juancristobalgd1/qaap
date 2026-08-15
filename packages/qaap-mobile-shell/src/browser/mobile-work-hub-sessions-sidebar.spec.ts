// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import {
    MobileWorkHubSessionsSidebar,
    QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY,
    QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS,
    QAAP_SESSIONS_SIDEBAR_DISMISS_HINT_KEY,
    hasSeenSessionsSidebarDismissHint,
    markSessionsSidebarDismissHintSeen,
    isDesktopSessionsSidebarLayout,
    shouldKeepSessionsSidebarOpenAfterNavigation,
} from './mobile-work-hub-sessions-sidebar';
import { ensureWorkHubSessionsSidebarExtracted } from './mobile-projects-sessions-sidebar-ui-render2';

describe('mobile-work-hub-sessions-sidebar', () => {

    let disableJSDOM: (() => void) | undefined;
    let jsdomWindow: Window | undefined;
    const storage = new Map<string, string>();

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        storage.clear();
        jsdomWindow = window;
        (global as { window?: Window }).window = {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, value); },
                removeItem: (key: string) => { storage.delete(key); },
                clear: () => { storage.clear(); },
                key: () => null,
                length: 0,
            },
            requestAnimationFrame: (callback: FrameRequestCallback) => {
                return setTimeout(() => callback(performance.now()), 0) as unknown as number;
            },
            cancelAnimationFrame: (id: number) => {
                clearTimeout(id);
            },
        } as unknown as Window;
        document.body.innerHTML = '';
        FrontendApplicationConfigProvider.set({ applicationName: 'Qaap' });
    });

    afterEach(() => {
        (global as { window?: Window }).window = jsdomWindow;
        jsdomWindow = undefined;
    });

    it('shows dismiss hint only until marked seen', () => {
        expect(hasSeenSessionsSidebarDismissHint()).to.equal(false);
        markSessionsSidebarDismissHintSeen();
        expect(storage.get(QAAP_SESSIONS_SIDEBAR_DISMISS_HINT_KEY)).to.equal('1');
        expect(hasSeenSessionsSidebarDismissHint()).to.equal(true);
    });

    it('keeps a wide coarse-pointer viewport in the mobile sheet layout', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            matchMedia: (query: string) => ({
                matches: query === '(min-width: 768px)' ? true : false,
                media: query,
                onchange: null,
                addListener: () => undefined,
                removeListener: () => undefined,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                dispatchEvent: () => false,
            }),
        } as unknown as Window;

        expect(QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY).to.equal('(min-width: 768px) and (pointer: fine)');
        expect(isDesktopSessionsSidebarLayout()).to.equal(false);
    });

    it('uses the persistent sidebar only for a wide precise-pointer viewport', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            matchMedia: (query: string) => ({
                matches: query === QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY,
                media: query,
                onchange: null,
                addListener: () => undefined,
                removeListener: () => undefined,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                dispatchEvent: () => false,
            }),
        } as unknown as Window;

        expect(isDesktopSessionsSidebarLayout()).to.equal(true);
    });

    it('mounts appearance mode switch in the footer when delegate provides mode APIs', () => {
        let mode: 'light' | 'dark' | 'system' = 'dark';
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
            getAppearanceMode: () => mode,
            setAppearanceMode: next => { mode = next; },
            onAppearanceModeChanged: () => ({ dispose: () => undefined }),
        });
        document.body.append(sidebar.node);
        const switchRoot = sidebar.node.querySelector('.theia-qaap-appearance-mode-switch');
        expect(switchRoot).to.not.equal(null);
        const light = switchRoot!.querySelector<HTMLButtonElement>('[data-mode="light"]');
        expect(light).to.not.equal(null);
        light!.click();
        expect(mode).to.equal('light');
    });

    it('syncs the embedded state when the viewport layout changes while open', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);

        sidebar.show();
        expect(document.body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS)).to.equal(true);

        sidebar.syncEmbeddedState(true);
        expect(sidebar.node.classList.contains('theia-mod-embedded')).to.equal(true);
        expect(document.body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS)).to.equal(false);

        sidebar.syncEmbeddedState(false);
        expect(sidebar.node.classList.contains('theia-mod-embedded')).to.equal(false);
        expect(document.body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS)).to.equal(true);

        sidebar.hide();
    });

    it('removes orphan sidebar nodes when reconciling the current panel mount', () => {
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        const orphan = document.createElement('aside');
        orphan.className = 'theia-mobile-work-hub-sessions-sidebar';
        document.body.append(orphan, sidebar.node);

        ensureWorkHubSessionsSidebarExtracted({
            host: {
                sessionsSidebar: sidebar,
                sessionsSidebarContainer: () => undefined,
            },
        });

        expect(document.querySelectorAll('.theia-mobile-work-hub-sessions-sidebar')).to.have.length(1);
        expect(document.body.contains(sidebar.node)).to.equal(true);
    });

    it('scheduleRefreshList coalesces multiple refresh requests into one render pass', async () => {
        let renderCalls = 0;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                host.append(document.createElement('div'));
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);

        sidebar.scheduleRefreshList();
        sidebar.scheduleRefreshList();
        sidebar.scheduleRefreshList();
        await new Promise<void>(resolve => setTimeout(resolve, 20));

        expect(renderCalls).to.equal(1);
    });

    it('skips DOM rebuild when delegate reports unchanged sidebar fingerprint', () => {
        let renderCalls = 0;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                host.append(document.createElement('div'));
            },
            shouldSkipSessionListRefresh: () => renderCalls > 0,
            rememberSessionListFingerprint: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        sidebar.refreshList();
        expect(renderCalls).to.equal(1);
    });

    it('force refresh bypasses sidebar fingerprint short-circuit', () => {
        let renderCalls = 0;
        let skipEnabled = false;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                host.append(document.createElement('div'));
            },
            shouldSkipSessionListRefresh: () => skipEnabled,
            rememberSessionListFingerprint: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        skipEnabled = true;
        sidebar.refreshList();
        sidebar.refreshList({ force: true });
        expect(renderCalls).to.equal(2);
    });

    it('preserves scroll and focused conversation across list refresh', () => {
        let label = 'First';
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                const spacer = document.createElement('div');
                spacer.style.height = '400px';
                const row = document.createElement('div');
                row.dataset.qaapConversationId = 'conv-1';
                const button = document.createElement('button');
                button.textContent = label;
                row.append(button);
                host.append(spacer, row);
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        sidebar.getScrollElement().scrollTop = 120;
        sidebar.node.querySelector<HTMLButtonElement>('[data-qaap-conversation-id="conv-1"] button')?.focus();

        label = 'Updated';
        sidebar.refreshList({ force: true });

        expect(sidebar.getScrollElement().scrollTop).to.equal(120);
        expect(document.activeElement?.textContent).to.equal('Updated');
    });

    it('does not touch DOM when refreshed markup is unchanged', () => {
        let renderCalls = 0;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                const row = document.createElement('div');
                row.dataset.qaapConversationId = 'conv-1';
                row.textContent = 'Stable';
                host.append(row);
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        const firstRow = sidebar.node.querySelector('[data-qaap-conversation-id="conv-1"]');
        sidebar.refreshList();
        const secondRow = sidebar.node.querySelector('[data-qaap-conversation-id="conv-1"]');

        expect(renderCalls).to.equal(2);
        expect(secondRow).to.equal(firstRow);
    });

    it('runs tryPatch before shouldSkip so live progress can update without full rebuild', () => {
        let renderCalls = 0;
        let patchCalls = 0;
        let allowPatch = false;
        let skipAfterInitialRender = false;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                skipAfterInitialRender = true;
                host.append(document.createElement('div'));
            },
            shouldSkipSessionListRefresh: () => skipAfterInitialRender,
            tryPatchSessionList: () => {
                patchCalls++;
                return allowPatch;
            },
            rememberSessionListFingerprint: () => {
                allowPatch = true;
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        sidebar.refreshList();
        expect(renderCalls).to.equal(1);
        expect(patchCalls).to.equal(2);
    });

    it('patches rows in place when tryPatch succeeds', () => {
        let renderCalls = 0;
        let patchCalls = 0;
        let allowPatch = false;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                const row = document.createElement('div');
                row.className = 'theia-mobile-projects-task-row';
                row.dataset.qaapConversationId = 'conv-1';
                row.textContent = 'Initial';
                host.append(row);
            },
            tryPatchSessionList: () => {
                patchCalls++;
                return allowPatch;
            },
            rememberSessionListFingerprint: () => {
                allowPatch = true;
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        sidebar.refreshList();
        expect(renderCalls).to.equal(1);
        expect(patchCalls).to.equal(2);
    });

    it('keeps the sidebar open when navigation happens on desktop layout', () => {
        const matchMedia = (query: string): MediaQueryList => ({
            matches: query === QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY
                || query === '(max-width: 767px)' && false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
        (global as { window?: Window }).window = {
            ...(global as { window?: Window }).window,
            matchMedia,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;

        expect(shouldKeepSessionsSidebarOpenAfterNavigation()).to.equal(true);

        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => { host.append(document.createElement('div')); },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.show();
        expect(sidebar.isVisible()).to.equal(true);

        sidebar.hideForMobileOverlay();

        expect(sidebar.isVisible()).to.equal(true);
        expect(sidebar.node.classList.contains('theia-mod-visible')).to.equal(true);
        sidebar.hide();
    });

    it('keeps the sidebar open on wide coarse-pointer viewports after task navigation', () => {
        const matchMedia = (query: string): MediaQueryList => ({
            // Wide enough, but not the fine-pointer desktop sidebar layout.
            matches: query === '(max-width: 767px)' ? false : false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
        (global as { window?: Window }).window = {
            ...(global as { window?: Window }).window,
            matchMedia,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;

        expect(isDesktopSessionsSidebarLayout()).to.equal(false);
        expect(shouldKeepSessionsSidebarOpenAfterNavigation()).to.equal(true);

        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => { host.append(document.createElement('div')); },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.show();
        sidebar.hideForMobileOverlay();
        expect(sidebar.isVisible()).to.equal(true);
        sidebar.hide();
    });

    it('closes the sessions sheet after navigation on a narrow viewport', () => {
        const matchMedia = (query: string): MediaQueryList => ({
            matches: query === '(max-width: 767px)',
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
        (global as { window?: Window }).window = {
            ...(global as { window?: Window }).window,
            matchMedia,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;

        expect(shouldKeepSessionsSidebarOpenAfterNavigation()).to.equal(false);

        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => { host.append(document.createElement('div')); },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.show();
        sidebar.hideForMobileOverlay();
        expect(sidebar.isVisible()).to.equal(false);
        sidebar.hide();
    });

    it('closes the embedded chat sidebar after navigation in the classic IDE', () => {
        const matchMedia = (query: string): MediaQueryList => ({
            matches: query === QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY
                || (query === '(max-width: 767px)' ? false : false),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
        (global as { window?: Window }).window = {
            ...(global as { window?: Window }).window,
            matchMedia,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;
        document.body.classList.add('theia-mobile-mod-desktop-ide');

        expect(shouldKeepSessionsSidebarOpenAfterNavigation()).to.equal(false);

        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => { host.append(document.createElement('div')); },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.show();

        sidebar.hideForMobileOverlay();

        expect(sidebar.isVisible()).to.equal(false);
        expect(sidebar.node.classList.contains('theia-mod-visible')).to.equal(false);
        sidebar.hide();
        document.body.classList.remove('theia-mobile-mod-desktop-ide');
    });

    it('hide always clears the sessions-sidebar body class even when embedded mode flips', () => {
        const matchMedia = (query: string): MediaQueryList => ({
            matches: query.includes('min-width: 768px'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
        (global as { window?: Window }).window = {
            ...(global as { window?: Window }).window,
            matchMedia,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;

        let embedded = false;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => { host.append(document.createElement('div')); },
            onNewChat: () => undefined,
            onClose: () => undefined,
            isEmbedded: () => embedded,
        });
        document.body.append(sidebar.node);
        sidebar.show();
        expect(document.body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS)).to.equal(true);
        embedded = true;
        sidebar.hide();
        expect(document.body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS)).to.equal(false);
    });
});
