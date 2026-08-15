// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// streaming2 pulls shell/layout modules that touch `document` at import time.
enableJSDOM();

import {
    toggleSessionsSidebarProjectSortPopoverExtracted,
    toggleSessionsSidebarStatusLegendPopoverExtracted,
} from './mobile-projects-sessions-sidebar-ui-streaming2';
import { stampSessionsSidebarRowFingerprintsExtracted } from './mobile-projects-sessions-sidebar-ui-render2';

describe('sessions sidebar head popovers', () => {
    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        document.body.replaceChildren();
        window.requestAnimationFrame = callback => {
            callback(performance.now());
            return 1;
        };
    });

    afterEach(() => {
        document.body.replaceChildren();
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('exposes expanded state and supports arrow, Home, End, and Escape keys', async () => {
        const anchor = document.createElement('button');
        anchor.setAttribute('aria-expanded', 'false');
        document.body.append(anchor);
        const ctx: any = {
            sessionsSidebarSortPopover: undefined,
            sessionsSidebarAddProjectPopover: undefined,
            sessionsSidebarStatusLegendPopover: undefined,
            getSessionsSidebarProjectSortMode: () => 'createdAt',
            setSessionsSidebarProjectSortMode: () => undefined,
            closeSessionsSidebarHeadPopovers(): void {
                this.sessionsSidebarSortPopover?.remove();
                this.sessionsSidebarSortPopover = undefined;
                this.sessionsSidebarAddProjectPopover?.remove();
                this.sessionsSidebarAddProjectPopover = undefined;
                this.sessionsSidebarStatusLegendPopover?.remove();
                this.sessionsSidebarStatusLegendPopover = undefined;
            },
        };

        toggleSessionsSidebarProjectSortPopoverExtracted(ctx, anchor);
        await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

        const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
        expect(anchor.getAttribute('aria-expanded')).to.equal('true');
        expect(items).to.have.length(4);
        expect(document.activeElement).to.equal(items[2]);

        items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement).to.equal(items[3]);
        items[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(document.activeElement).to.equal(items[0]);
        items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect(document.activeElement).to.equal(items[3]);
        items[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        expect(anchor.getAttribute('aria-expanded')).to.equal('false');
        expect(document.activeElement).to.equal(anchor);
        expect(document.querySelector('[role="menu"]')).to.equal(null);
    });

    it('opens a status legend dialog with one row per core visual status', async () => {
        const anchor = document.createElement('button');
        anchor.setAttribute('aria-expanded', 'false');
        document.body.append(anchor);
        const ctx: any = {
            sessionsSidebarSortPopover: undefined,
            sessionsSidebarAddProjectPopover: undefined,
            sessionsSidebarStatusLegendPopover: undefined,
            closeSessionsSidebarHeadPopovers(): void {
                this.sessionsSidebarSortPopover?.remove();
                this.sessionsSidebarSortPopover = undefined;
                this.sessionsSidebarAddProjectPopover?.remove();
                this.sessionsSidebarAddProjectPopover = undefined;
                this.sessionsSidebarStatusLegendPopover?.remove();
                this.sessionsSidebarStatusLegendPopover = undefined;
            },
        };

        toggleSessionsSidebarStatusLegendPopoverExtracted(ctx, anchor);
        await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

        expect(anchor.getAttribute('aria-expanded')).to.equal('true');
        expect(document.querySelector('.theia-mod-status-legend[role="dialog"]')).to.not.equal(null);
        expect(document.querySelectorAll('[role="listitem"]')).to.have.length(16);
        expect(document.querySelector('.theia-mod-legend-running')).to.not.equal(null);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        expect(anchor.getAttribute('aria-expanded')).to.equal('false');
        expect(document.querySelector('.theia-mod-status-legend')).to.equal(null);
    });
});

describe('sessions sidebar row fingerprint stamping', () => {
    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('indexes visible rows with one DOM query instead of querying once per conversation', () => {
        const list = document.createElement('div');
        for (const id of ['conversation-a', 'conversation-b']) {
            const row = document.createElement('div');
            row.className = 'theia-mobile-projects-task-row';
            row.dataset.qaapConversationId = id;
            list.append(row);
        }
        const originalQuerySelectorAll = list.querySelectorAll.bind(list);
        let queryCount = 0;
        list.querySelectorAll = ((selectors: string) => {
            queryCount++;
            return originalQuerySelectorAll(selectors);
        }) as typeof list.querySelectorAll;
        const ctx: any = {
            collectSessionsSidebarConversationEntries: () => [
                { summary: { id: 'conversation-a' } },
                { summary: { id: 'conversation-b' } },
            ],
            buildSidebarRowFingerprint: (entry: { summary: { id: string } }) => `fingerprint:${entry.summary.id}`,
        };

        stampSessionsSidebarRowFingerprintsExtracted(ctx, list);

        expect(queryCount).to.equal(1);
        expect(list.children[0].getAttribute('data-qaap-sessions-sidebar-row-fp')).to.equal('fingerprint:conversation-a');
        expect(list.children[1].getAttribute('data-qaap-sessions-sidebar-row-fp')).to.equal('fingerprint:conversation-b');
    });
});
