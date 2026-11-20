// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as sinon from 'sinon';
import { environment } from '@theia/core/shared/@theia/application-package/lib/environment';
import { QAAP_DESKTOP_GITHUB_SIGN_IN_EVENT, QaapGithubOAuthNavigation, startGithubOAuth } from './qaap-github-auth-client';

disableJSDOM();

// Live desktop bug (Nov 2026): "Connect GitHub" navigated the whole Electron window to the OAuth route,
// which dropped the app state and loaded GitHub inside the app.
describe('startGithubOAuth', () => {

    let electron: sinon.SinonStub;
    let assigned: string[];
    let requests: number;
    let handled: boolean;
    let originalAssign: (url: string) => void;
    const onRequest = (event: Event): void => {
        requests++;
        if (handled) {
            event.preventDefault();
        }
    };

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        electron = sinon.stub(environment.electron, 'is');
        assigned = [];
        requests = 0;
        handled = true;
        originalAssign = QaapGithubOAuthNavigation.assign;
        QaapGithubOAuthNavigation.assign = url => { assigned.push(url); };
        window.addEventListener(QAAP_DESKTOP_GITHUB_SIGN_IN_EVENT, onRequest);
    });

    afterEach(() => {
        window.removeEventListener(QAAP_DESKTOP_GITHUB_SIGN_IN_EVENT, onRequest);
        QaapGithubOAuthNavigation.assign = originalAssign;
        sinon.restore();
        disableJSDOM();
    });

    it('desktop: asks the in-app sign-in handler and never navigates the app window', () => {
        electron.returns(true);
        startGithubOAuth();
        expect(requests).to.equal(1);
        expect(assigned).to.deep.equal([]);
    });

    it('desktop without a handler: still never navigates the app window', () => {
        electron.returns(true);
        handled = false;
        const warn = sinon.stub(console, 'warn');
        startGithubOAuth();
        expect(assigned).to.deep.equal([]);
        expect(warn.calledOnce).to.equal(true);
    });

    it('web: unchanged, navigates to the OAuth start route', () => {
        electron.returns(false);
        startGithubOAuth();
        expect(requests).to.equal(0);
        expect(assigned).to.have.length(1);
        expect(assigned[0]).to.match(/oauth/i);
    });
});
