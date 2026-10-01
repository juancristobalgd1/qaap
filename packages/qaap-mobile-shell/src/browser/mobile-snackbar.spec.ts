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
});
