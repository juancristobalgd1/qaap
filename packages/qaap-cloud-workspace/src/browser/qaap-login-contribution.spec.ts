// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
let disableJSDOM = enableJSDOM();
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { QaapLoginContribution } from './qaap-login-contribution';

disableJSDOM();

describe('QaapLoginContribution OAuth failure message', () => {

    before(() => disableJSDOM = enableJSDOM());
    after(() => disableJSDOM());

    const failureMessage = (reason: string | undefined): string =>
        (Object.create(QaapLoginContribution.prototype) as unknown as { describeOAuthFailure(r: string | undefined): string }).describeOAuthFailure(reason);

    it('explains a lost OAuth state instead of showing the raw state_lost code', () => {
        const message = failureMessage('state_lost');
        expect(message).not.to.include('state_lost');
        expect(message).to.include('Sign in again from this browser');
    });

    it('keeps the backend reason for other failures', () => {
        expect(failureMessage('access_denied')).to.equal('GitHub sign-in failed: access_denied');
        expect(failureMessage(undefined)).to.equal('GitHub sign-in failed.');
    });
});
