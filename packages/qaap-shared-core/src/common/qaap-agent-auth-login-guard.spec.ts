// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { detectAgentAuthFailureMode, extractAgentAuthLoginChallenge, isUnauthenticatedCliDeclaration } from './qaap-agent-auth-login';
import { detectAgentFailureKind } from './qaap-agent-failure-message';

describe('auth reclassifier: pre-spawn sign-in guard refusals', () => {
    const refusals = [
        'Sign in to Codex to use gpt-5.5.\n',
        'Sign in to GitHub Copilot to use claude-sonnet-4.5.',
        "Couldn't confirm your sign-in to Claude Code; try again.\n",
        'Couldn’t confirm your sign-in to Grok; try again.',
    ];

    it('reads every guard refusal as a session sign-in failure, so the transcript offers the Sign in chip', () => {
        for (const refusal of refusals) {
            expect(detectAgentAuthFailureMode(refusal), refusal).to.equal('session');
            expect(extractAgentAuthLoginChallenge(refusal, { agentId: 'codex' }), refusal).to.deep.equal({ mode: 'session' });
            expect(detectAgentFailureKind(refusal), refusal).to.equal('auth');
        }
    });

    it('does not take agent prose that mentions signing in for a refusal', () => {
        const prose = [
            'I added a banner: Sign in to GitHub to use the API. Then the tests pass.',
            'Updated README:\n- Sign in to GitHub to use the API (see docs).\n- Run npm test.',
            'The modal says "Couldn\'t confirm your sign-in" when the token expired.',
        ];
        for (const text of prose) {
            expect(detectAgentAuthFailureMode(text), text).to.equal(undefined);
            expect(detectAgentFailureKind(text), text).to.not.equal('auth');
        }
    });

    it('never fails a clean exit on its own: the strict exit-0 declaration list is unchanged', () => {
        for (const refusal of refusals) {
            expect(isUnauthenticatedCliDeclaration(refusal), refusal).to.equal(false);
        }
    });
});
