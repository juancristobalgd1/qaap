// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { hashString } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { confirmPaidModelSend, hasConfirmedPaidSendForProject } from './qaap-paid-model-send-confirm';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

/**
 * The paid-send gate lets free models and already-confirmed projects through without asking; the
 * confirmation itself is remembered per project in sessionStorage.
 */
describe('paid model send confirmation', () => {

    useSuiteJSDOM();

    const cwd = '/repo/paid-send';
    const freeModel = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'google/gemma-4-31b-it:free' };
    const paidModel = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'openai/gpt-5' };

    beforeEach(() => {
        window.sessionStorage.clear();
    });

    it('lets free models and a missing model through without a dialog', async () => {
        expect(await confirmPaidModelSend(cwd, freeModel)).to.be.true;
        expect(await confirmPaidModelSend(cwd, undefined)).to.be.true;
    });

    it('passes a paid model through once this project was confirmed in this session', async () => {
        expect(hasConfirmedPaidSendForProject(cwd)).to.be.false;
        window.sessionStorage.setItem(`qaap.paidModelSendConfirmed.${hashString(cwd)}`, 'true');
        expect(hasConfirmedPaidSendForProject(cwd)).to.be.true;
        expect(await confirmPaidModelSend(cwd, paidModel)).to.be.true;
        // Confirmation is per project: another project is still asked.
        expect(hasConfirmedPaidSendForProject('/repo/other')).to.be.false;
    });
});
