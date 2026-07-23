// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import {
    closeStickyComposerStepMenu,
    STEP_MENU_CLASS,
    STEP_PILL_CLASS,
    syncStickyComposerStepPill,
} from './qaap-sticky-composer-step-pill';
import { ensureWorkingControlShell } from './qaap-sticky-composer-working-agents-popover';

describe('qaap-sticky-composer-step-pill', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
        globalThis.AbortController = window.AbortController;
        window.matchMedia = ((query: string) => ({
            matches: query.includes('hover: hover'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;
    });

    after(() => {
        disableJSDOM();
    });

    beforeEach(() => {
        closeStickyComposerStepMenu(true);
        document.body.replaceChildren();
    });

    afterEach(() => {
        closeStickyComposerStepMenu(true);
        document.body.replaceChildren();
    });

    function createComposerWrap(withChangesRow = true): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-projects-sticky-composer-inner';
        if (withChangesRow) {
            const host = document.createElement('div');
            host.className = 'theia-mobile-sticky-composer-changes-pill-host';
            const section = document.createElement('div');
            section.className = 'theia-mobile-sticky-composer-activity-section theia-mod-files theia-mod-changes-pill';
            const row = document.createElement('div');
            row.className = 'theia-mobile-sticky-composer-changes-pill-row';
            const working = document.createElement('button');
            working.type = 'button';
            working.className = 'theia-mobile-sticky-composer-working-pill';
            working.textContent = '1 Working';
            const shell = ensureWorkingControlShell(working);
            const changes = document.createElement('button');
            changes.className = 'theia-mobile-sticky-composer-changes-pill';
            changes.textContent = 'Changes';
            row.append(shell, changes);
            section.append(row);
            host.append(section);
            wrap.append(host);
        }
        const card = document.createElement('div');
        card.className = 'theia-mobile-projects-sticky-composer-card theia-mod-codex';
        wrap.append(card);
        return wrap;
    }

    it('inserts Step X/Y to the right of Working and opens the menu on click', () => {
        const wrap = createComposerWrap();
        document.body.append(wrap);
        syncStickyComposerStepPill(wrap, {
            progress: {
                current: 2,
                total: 3,
                items: [
                    { label: 'Done task', status: 'completed' },
                    { label: 'Active task', status: 'in_progress' },
                    { label: 'Pending task', status: 'pending' },
                ],
            },
        });

        const row = wrap.querySelector('.theia-mobile-sticky-composer-changes-pill-row');
        const children = Array.from(row?.children ?? []);
        const step = wrap.querySelector<HTMLButtonElement>(`.${STEP_PILL_CLASS}`);
        expect(step?.textContent).to.equal('Step 2/3');
        expect(children[0]?.classList.contains('theia-mobile-sticky-composer-working-control')).to.equal(true);
        expect(children[1]).to.equal(step);
        expect(children[2]?.classList.contains('theia-mobile-sticky-composer-changes-pill')).to.equal(true);

        step?.click();
        const menu = document.querySelector(`.${STEP_MENU_CLASS}`);
        expect(menu).to.not.equal(null);
        const labels = Array.from(menu!.querySelectorAll('.theia-mobile-sticky-composer-step-menu-label'))
            .map(node => node.textContent);
        expect(labels).to.deep.equal(['Done task', 'Active task', 'Pending task']);
        expect(menu!.querySelector('.theia-mod-in-progress')).to.not.equal(null);
    });

    it('removes the pill when progress is cleared', () => {
        const wrap = createComposerWrap();
        document.body.append(wrap);
        syncStickyComposerStepPill(wrap, {
            progress: {
                current: 1,
                total: 1,
                items: [{ label: 'Only', status: 'in_progress' }],
            },
        });
        expect(wrap.querySelector(`.${STEP_PILL_CLASS}`)).to.not.equal(null);
        syncStickyComposerStepPill(wrap, { progress: undefined });
        expect(wrap.querySelector(`.${STEP_PILL_CLASS}`)).to.equal(null);
        expect(document.querySelector(`.${STEP_MENU_CLASS}`)).to.equal(null);
    });

    it('opens the step menu above the pill when there is room', () => {
        const wrap = createComposerWrap();
        document.body.append(wrap);
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
        const offsetHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
        const offsetWidthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
            configurable: true,
            get(this: HTMLElement): number {
                return this.classList.contains(STEP_MENU_CLASS) ? 120 : 0;
            },
        });
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
            configurable: true,
            get(this: HTMLElement): number {
                return this.classList.contains(STEP_MENU_CLASS) ? 260 : 0;
            },
        });
        try {
            syncStickyComposerStepPill(wrap, {
                progress: {
                    current: 1,
                    total: 2,
                    items: [
                        { label: 'First', status: 'in_progress' },
                        { label: 'Second', status: 'pending' },
                    ],
                },
            });
            const step = wrap.querySelector<HTMLButtonElement>(`.${STEP_PILL_CLASS}`);
            expect(step).to.not.equal(null);
            step!.getBoundingClientRect = () => ({
                x: 100, y: 600, top: 600, left: 100, bottom: 630, right: 170, width: 70, height: 30, toJSON: () => ({}),
            });
            step!.click();
            const menu = document.querySelector<HTMLElement>(`.${STEP_MENU_CLASS}`);
            expect(menu).to.not.equal(null);
            expect(menu?.dataset.placement).to.equal('above');
            expect(Number.parseFloat(menu!.style.top)).to.be.below(600);
        } finally {
            if (offsetHeightDesc) {
                Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDesc);
            }
            if (offsetWidthDesc) {
                Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDesc);
            }
        }
    });
});
