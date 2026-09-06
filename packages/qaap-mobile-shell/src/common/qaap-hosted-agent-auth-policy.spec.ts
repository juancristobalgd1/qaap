// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    assertAgentAllowedOnHostedRuntime,
    isAgentHiddenOnHostedRuntime,
    isHostedLocalhostOAuthAgent,
    localizeHostedLocalhostOAuthAgentMessage,
    rememberQaapHostedRuntime,
} from './qaap-hosted-agent-auth-policy';

describe('qaap-hosted-agent-auth-policy', () => {
    afterEach(() => {
        rememberQaapHostedRuntime(false);
    });

    it('treats Cursor (and cursor-agent) as localhost OAuth', () => {
        expect(isHostedLocalhostOAuthAgent('cursor')).to.equal(true);
        expect(isHostedLocalhostOAuthAgent('cursor-agent')).to.equal(true);
        expect(isHostedLocalhostOAuthAgent('codex')).to.equal(false);
        expect(isHostedLocalhostOAuthAgent('claude')).to.equal(false);
        expect(isHostedLocalhostOAuthAgent('qaiq')).to.equal(false);
        expect(isHostedLocalhostOAuthAgent('shell')).to.equal(false);
    });

    it('hides Cursor only on a hosted runtime', () => {
        expect(isAgentHiddenOnHostedRuntime('cursor', false)).to.equal(false);
        expect(isAgentHiddenOnHostedRuntime('cursor', true)).to.equal(true);
        expect(isAgentHiddenOnHostedRuntime('codex', true)).to.equal(false);
        rememberQaapHostedRuntime(true);
        expect(isAgentHiddenOnHostedRuntime('cursor')).to.equal(true);
        expect(isAgentHiddenOnHostedRuntime('codex')).to.equal(false);
    });

    it('refuses Cursor on hosted and keeps the message actionable', () => {
        rememberQaapHostedRuntime(true);
        expect(() => assertAgentAllowedOnHostedRuntime('cursor')).to.throw(/desktop browser login/i);
        expect(() => assertAgentAllowedOnHostedRuntime('codex')).to.not.throw();
        expect(localizeHostedLocalhostOAuthAgentMessage('cursor')).to.match(/QAIQ|Codex|Claude|Grok/);
    });
});
