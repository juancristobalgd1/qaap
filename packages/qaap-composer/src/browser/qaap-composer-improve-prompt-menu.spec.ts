// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { registerComposerImprovePromptAction } from './qaap-composer-improve-prompt-action';
import { dismissMobileContextAttachMenu, pickMobileContextVariable } from './qaap-mobile-context-attach-menu';

type VariableService = Parameters<typeof pickMobileContextVariable>[1];
type QuickInput = Parameters<typeof pickMobileContextVariable>[2];

/** A rect that is laid out, so the menu is not dismissed as anchored to nothing. */
function laidOut(element: HTMLElement): void {
    element.getBoundingClientRect = (): DOMRect => ({
        x: 100, y: 600, left: 100, top: 600, width: 40, height: 30, right: 140, bottom: 630, toJSON: () => ({}),
    }) as DOMRect;
}

describe('qaap-composer improve prompt menu item', () => {
    let disableJSDOM: () => void;
    let anchor: HTMLButtonElement;
    let input: HTMLTextAreaElement;
    let runs: number;
    let nodeAbortController: typeof AbortController;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        // The popover wiring hands an AbortSignal to window.addEventListener; it must be jsdom's own.
        nodeAbortController = globalThis.AbortController;
        globalThis.AbortController = window.AbortController;
        if (typeof window.requestAnimationFrame !== 'function') {
            window.requestAnimationFrame = (callback: FrameRequestCallback): number => window.setTimeout(() => callback(Date.now()), 0);
        }
        if (typeof window.cancelAnimationFrame !== 'function') {
            window.cancelAnimationFrame = (handle: number): void => window.clearTimeout(handle);
        }
        anchor = document.createElement('button');
        anchor.className = 'theia-mobile-projects-sticky-composer-attach';
        laidOut(anchor);
        input = document.createElement('textarea');
        document.body.append(anchor, input);
        runs = 0;
        registerComposerImprovePromptAction(anchor, {
            input,
            hasText: () => input.value.trim().length > 0,
            run: () => { runs++; },
        });
    });

    afterEach(() => {
        dismissMobileContextAttachMenu();
        document.body.replaceChildren();
        globalThis.AbortController = nodeAbortController;
        disableJSDOM();
    });

    function openMenu(): Promise<unknown> {
        return pickMobileContextVariable(
            anchor,
            { getContextVariables: () => [] } as unknown as VariableService,
            {} as QuickInput,
        );
    }

    function improveItem(): HTMLButtonElement | undefined {
        const labels = Array.from(document.querySelectorAll<HTMLElement>('.theia-mobile-projects-sticky-composer-attach-menu-item-label'));
        return labels.find(label => label.textContent === 'Improve prompt')?.closest<HTMLButtonElement>('button') ?? undefined;
    }

    it('is an item of the plus menu, disabled while the prompt is empty', () => {
        void openMenu();
        const item = improveItem();
        expect(item).to.not.equal(undefined);
        expect(item!.disabled).to.equal(true);
        expect(item!.getAttribute('aria-disabled')).to.equal('true');
    });

    it('becomes enabled as soon as the prompt has text, and reverts when it is cleared', () => {
        void openMenu();
        input.value = '   ';
        input.dispatchEvent(new window.Event('input'));
        expect(improveItem()!.disabled).to.equal(true);

        input.value = 'fix the login bug';
        input.dispatchEvent(new window.Event('input'));
        expect(improveItem()!.disabled).to.equal(false);
        expect(improveItem()!.getAttribute('aria-disabled')).to.equal('false');

        input.value = '';
        input.dispatchEvent(new window.Event('input'));
        expect(improveItem()!.disabled).to.equal(true);
    });

    it('runs the same improve action when picked and closes the menu', async () => {
        input.value = 'make this clearer';
        const pending = openMenu();
        improveItem()!.click();
        expect(runs).to.equal(1);
        expect(await pending).to.deep.equal([]);
        expect(document.querySelector('.theia-mobile-projects-sticky-composer-attach-menu')).to.equal(null);
    });

    it('does not run when the item is clicked while disabled', () => {
        void openMenu();
        improveItem()!.click();
        expect(runs).to.equal(0);
    });
});
