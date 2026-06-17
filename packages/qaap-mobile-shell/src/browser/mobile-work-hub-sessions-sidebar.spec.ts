// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import {
    MobileWorkHubSessionsSidebar,
    QAAP_SESSIONS_SIDEBAR_DISMISS_HINT_KEY,
    hasSeenSessionsSidebarDismissHint,
    markSessionsSidebarDismissHintSeen,
} from './mobile-work-hub-sessions-sidebar';

describe('mobile-work-hub-sessions-sidebar', () => {

    let disableJSDOM: (() => void) | undefined;
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
        delete (global as { window?: Window }).window;
    });

    it('shows dismiss hint only until marked seen', () => {
        expect(hasSeenSessionsSidebarDismissHint()).to.equal(false);
        markSessionsSidebarDismissHintSeen();
        expect(storage.get(QAAP_SESSIONS_SIDEBAR_DISMISS_HINT_KEY)).to.equal('1');
        expect(hasSeenSessionsSidebarDismissHint()).to.equal(true);
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
});
