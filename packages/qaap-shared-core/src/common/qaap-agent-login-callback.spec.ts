// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_AGENT_LOGIN_CALLBACK_PATH,
    resolveQaapAgentLoginRedirectUrl,
    rewriteQaapAgentLoginCallbackUrl,
} from './qaap-agent-login-callback';

const PI_SIGN_IN_URL = 'https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A3000%2Fcallback&code_challenge=abc&code_challenge_method=S256';
const NONCE = '6f1c2d3e-aaaa-bbbb-cccc-0123456789ab';

describe('qaap-agent-login-callback', () => {

    it('points a loopback callback_url at the Qaap callback page on a hosted origin', () => {
        const rewrite = rewriteQaapAgentLoginCallbackUrl(PI_SIGN_IN_URL, 'https://app.qaap.dev', NONCE);
        expect(rewrite?.loopbackCallback).to.equal('http://127.0.0.1:3000/callback');
        const url = new URL(rewrite!.url);
        expect(url.origin).to.equal('https://openrouter.ai');
        expect(url.searchParams.get('callback_url')).to.equal(`https://app.qaap.dev${QAAP_AGENT_LOGIN_CALLBACK_PATH}/${NONCE}`);
        expect(url.searchParams.get('code_challenge')).to.equal('abc');
    });

    it('leaves the sign-in URL alone when the app itself runs on a loopback origin', () => {
        expect(rewriteQaapAgentLoginCallbackUrl(PI_SIGN_IN_URL, 'http://localhost:3000', NONCE)).to.equal(undefined);
        expect(rewriteQaapAgentLoginCallbackUrl(PI_SIGN_IN_URL, 'http://127.0.0.1:3000', NONCE)).to.equal(undefined);
    });

    it('ignores non-loopback callbacks, missing callbacks and malformed nonces', () => {
        const remote = 'https://openrouter.ai/auth?callback_url=https%3A%2F%2Fevil.example%2Fcb';
        expect(rewriteQaapAgentLoginCallbackUrl(remote, 'https://app.qaap.dev', NONCE)).to.equal(undefined);
        expect(rewriteQaapAgentLoginCallbackUrl('https://auth.openai.com/codex/device', 'https://app.qaap.dev', NONCE)).to.equal(undefined);
        expect(rewriteQaapAgentLoginCallbackUrl(PI_SIGN_IN_URL, 'https://app.qaap.dev', '../x')).to.equal(undefined);
    });

    it('rebuilds the loopback redirect from the callback page query', () => {
        expect(resolveQaapAgentLoginRedirectUrl('http://127.0.0.1:3000/callback', '?code=xyz'))
            .to.equal('http://127.0.0.1:3000/callback?code=xyz');
        expect(resolveQaapAgentLoginRedirectUrl('http://127.0.0.1:3000/callback', '')).to.equal(undefined);
    });
});
