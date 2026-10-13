// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { MobileSnackbar } from './mobile-snackbar';

describe('mobile-snackbar', () => {

    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        MobileSnackbar.dismiss();
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function snackbar(): HTMLElement {
        return document.querySelector<HTMLElement>('.theia-mobile-snackbar')!;
    }

    function mountComposer(top: number): HTMLElement {
        const composer = document.createElement('div');
        composer.className = 'theia-mobile-projects-sticky-composer';
        composer.getBoundingClientRect = () => ({ top } as DOMRect);
        composer.getClientRects = () => ({ length: 1 } as DOMRectList);
        document.body.append(composer);
        return composer;
    }

    it('lifts the snackbar above the visible sticky composer', () => {
        mountComposer(window.innerHeight - 140);
        MobileSnackbar.show('Task started', { actionLabel: 'Open', onAction: () => undefined });
        expect(snackbar().style.getPropertyValue(MobileSnackbar.COMPOSER_LIFT_PROPERTY)).to.equal('140px');
    });

    it('does not lift when no composer is visible', () => {
        const composer = mountComposer(window.innerHeight - 140);
        composer.hidden = true;
        MobileSnackbar.show('Task started');
        expect(snackbar().style.getPropertyValue(MobileSnackbar.COMPOSER_LIFT_PROPERTY)).to.equal('0px');
    });

    it('a late auto-dismiss from an earlier window never cancels a timer of the current window', async () => {
        // Capture the auto-dismiss timer the toast schedules on this window.
        const firstWindow = window;
        const originalSetTimeout = firstWindow.setTimeout;
        let autoDismiss: { handler: () => void; handle: number } | undefined;
        firstWindow.setTimeout = ((handler: () => void, timeout?: number) => {
            const timerHandle = originalSetTimeout(handler, timeout);
            autoDismiss ??= { handler, handle: timerHandle };
            return timerHandle;
        }) as typeof firstWindow.setTimeout;
        try {
            MobileSnackbar.show('Task started');
        } finally {
            firstWindow.setTimeout = originalSetTimeout;
        }
        expect(autoDismiss).to.not.equal(undefined);

        // A later suite gets a fresh window whose timer handles restart and collide with the old one.
        disableJSDOM?.();
        disableJSDOM = enableJSDOM();
        expect(window).to.not.equal(firstWindow);
        let collidingTimerFired = false;
        let handle = 0;
        while (handle < autoDismiss!.handle) {
            const candidate = window.setTimeout(() => {
                if (candidate === autoDismiss!.handle) {
                    collidingTimerFired = true;
                }
            }, 20);
            handle = candidate;
        }
        expect(handle).to.equal(autoDismiss!.handle);

        // The old toast's auto-dismiss fires now, while the new window's timer is pending.
        autoDismiss!.handler();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(collidingTimerFired).to.equal(true);
    });
});
