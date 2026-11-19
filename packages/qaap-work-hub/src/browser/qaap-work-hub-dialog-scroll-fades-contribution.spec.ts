// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { QaapWorkHubDialogScrollFadesContribution } from './qaap-work-hub-dialog-scroll-fades-contribution';

describe('qaap-work-hub-dialog-scroll-fades-contribution', () => {

    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    /** Adds a Theia-shaped dialog overlay to the body whose body has the given scroll geometry. */
    function addDialog(scrollTop: number, scrollHeight: number, clientHeight: number): { overlay: HTMLElement; body: HTMLElement } {
        const overlay = document.createElement('div');
        overlay.classList.add('dialogOverlay');
        const block = document.createElement('div');
        block.classList.add('dialogBlock');
        const body = document.createElement('div');
        body.classList.add('dialogContent');
        Object.defineProperty(body, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
        Object.defineProperty(body, 'scrollHeight', { value: scrollHeight, configurable: true });
        Object.defineProperty(body, 'clientHeight', { value: clientHeight, configurable: true });
        block.append(body);
        overlay.append(block);
        document.body.append(overlay);
        return { overlay, body };
    }

    /** Lets the MutationObserver callbacks run. */
    function flush(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 10));
    }

    it('shows only the bottom fade for a dialog body scrolled to the top', async () => {
        const { body } = addDialog(0, 500, 200);
        const contribution = new QaapWorkHubDialogScrollFadesContribution();
        contribution.onStart(undefined as unknown as FrontendApplication);
        await flush();
        expect(body.classList.contains('qaap-scroll-fades')).to.be.true;
        expect(body.classList.contains('qaap-mod-scroll-fade-top')).to.be.false;
        expect(body.classList.contains('qaap-mod-scroll-fade-bottom')).to.be.true;
        contribution.onStop(undefined as unknown as FrontendApplication);
    });

    it('shows no fade when the dialog body does not scroll', async () => {
        const { body } = addDialog(0, 200, 200);
        const contribution = new QaapWorkHubDialogScrollFadesContribution();
        contribution.onStart(undefined as unknown as FrontendApplication);
        await flush();
        expect(body.classList.contains('qaap-mod-scroll-fade-top')).to.be.false;
        expect(body.classList.contains('qaap-mod-scroll-fade-bottom')).to.be.false;
        contribution.onStop(undefined as unknown as FrontendApplication);
    });

    it('attaches fades to a dialog opened after start and removes them when it closes', async () => {
        const contribution = new QaapWorkHubDialogScrollFadesContribution();
        contribution.onStart(undefined as unknown as FrontendApplication);
        const { overlay, body } = addDialog(0, 500, 200);
        await flush();
        expect(body.classList.contains('qaap-scroll-fades')).to.be.true;

        overlay.remove();
        await flush();
        expect(body.classList.contains('qaap-scroll-fades')).to.be.false;
        contribution.onStop(undefined as unknown as FrontendApplication);
    });
});
