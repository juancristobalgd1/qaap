// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    MOBILE_PROCESS_ACCORDION_DISCARD_CLASS,
    MOBILE_PROCESS_ACCORDION_RETRY_ATTEMPT_CLASS,
    syncMobileProcessAccordionState,
    wrapMobileProcessAccordion,
} from './mobile-process-accordion';

describe('mobile-process-accordion recovery actions', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('shows "Discard changes" only on a stopped, settled turn with a handler', () => {
        let discarded = 0;
        const accordion = wrapMobileProcessAccordion(document.createElement('div'), {
            isWorking: false,
            isError: false,
            isCancelled: true,
            onDiscardChanges: () => { discarded++; },
        });
        const button = accordion.querySelector<HTMLButtonElement>(`.${MOBILE_PROCESS_ACCORDION_DISCARD_CLASS}`);
        expect(button?.textContent).to.equal('Discard changes');
        button!.click();
        expect(discarded).to.equal(1);

        syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false, isCancelled: true });
        expect(!!accordion.querySelector(`.${MOBILE_PROCESS_ACCORDION_DISCARD_CLASS}`)).to.equal(false);

        syncMobileProcessAccordionState(accordion, {
            isWorking: true,
            isError: false,
            isCancelled: true,
            onDiscardChanges: () => undefined,
        });
        expect(!!accordion.querySelector(`.${MOBILE_PROCESS_ACCORDION_DISCARD_CLASS}`)).to.equal(false);
    });

    it('badges retried turns with their attempt number', () => {
        const accordion = wrapMobileProcessAccordion(document.createElement('div'), {
            isWorking: false,
            isError: false,
            retryAttempt: 2,
        });
        expect(accordion.querySelector(`.${MOBILE_PROCESS_ACCORDION_RETRY_ATTEMPT_CLASS}`)?.textContent).to.equal('Attempt 2');
        syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false, retryAttempt: 3 });
        expect(accordion.querySelector(`.${MOBILE_PROCESS_ACCORDION_RETRY_ATTEMPT_CLASS}`)?.textContent).to.equal('Attempt 3');
        syncMobileProcessAccordionState(accordion, { isWorking: false, isError: false });
        expect(!!accordion.querySelector(`.${MOBILE_PROCESS_ACCORDION_RETRY_ATTEMPT_CLASS}`)).to.equal(false);
    });
});
