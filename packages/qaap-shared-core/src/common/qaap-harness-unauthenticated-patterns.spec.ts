// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { detectAgentAuthFailureMode, isUnauthenticatedCliDeclaration } from './qaap-agent-auth-login';
import { detectAgentFailureKind, resolveAgentTurnFailureMessage } from './qaap-agent-failure-message';

const CURSOR = "Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.";
const CODEX_401 = 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses, cf-ray: a5b6da1cae010383-MAD';
const CODEX_HOLLOW = 'plan type is required for chatgpt authentication';

describe('harness unauthenticated declarations', () => {

    it('classifies the Cursor and Codex sign-in failures as auth (Sign in chip), with or without an error envelope', () => {
        for (const text of [CURSOR, `Error: ${CURSOR}`, CODEX_401, `Error: ${CODEX_401}`, CODEX_HOLLOW,
            `{"type":"turn.failed","error":{"message":"${CODEX_401}"}}`]) {
            expect(detectAgentFailureKind(text), text).to.equal('auth');
            expect(isUnauthenticatedCliDeclaration(text), text).to.equal(true);
        }
    });

    it('offers the harness sign-in, not the Settings API key, for these failures', () => {
        expect(detectAgentAuthFailureMode(CURSOR)).to.equal('session');
        expect(detectAgentAuthFailureMode(CODEX_401)).to.equal('session');
        expect(resolveAgentTurnFailureMessage(CURSOR, { state: 'failed', agentId: 'cursor' })).to.match(/sign in/i);
    });

    it('does not fire on prose that only mentions auth', () => {
        for (const text of [
            'I added a 401 handler that returns Unauthorized when the bearer token is missing.',
            'The agent login page now asks for authentication.',
            'Updated the plan type selector.',
        ]) {
            expect(isUnauthenticatedCliDeclaration(text), text).to.equal(false);
        }
    });
});
