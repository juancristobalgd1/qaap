// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    detectAgentAuthFailureMode,
    extractAgentAuthLoginChallenge,
    localizeAgentAuthFailureMessage,
    resolveAgentLoginCliCommand,
} from './qaap-agent-auth-login';
import { detectAgentFailureKind, resolveAgentTurnFailureMessage } from './qaap-agent-failure-message';
import { resolveAgentLogDisplayText } from './qaap-cli-transcript-stream';

describe('qaap-agent-auth-login', () => {

    it('extracts Codex device-auth URL and one-time code', () => {
        const log = [
            'Follow these steps to sign in with ChatGPT using device code ABCD-EFGHI:',
            '',
            '1. Open this link in your browser and sign in to your account',
            '   https://auth.openai.com/codex/device',
            '',
            '2. Enter this one-time code (expires in 15 minutes)',
            '   ABCD-EFGHI',
        ].join('\n');
        const challenge = extractAgentAuthLoginChallenge(log);
        expect(challenge?.mode).to.equal('session');
        expect(challenge?.url).to.equal('https://auth.openai.com/codex/device');
        expect(challenge?.userCode).to.equal('ABCD-EFGHI');
    });

    it('extracts Claude OAuth authorize URLs', () => {
        const log = 'Browser didn\'t open? Use the url below to sign in\n'
            + 'https://claude.ai/oauth/authorize?code=true&client_id=abc';
        const challenge = extractAgentAuthLoginChallenge(log);
        expect(challenge?.url).to.equal('https://claude.ai/oauth/authorize?code=true&client_id=abc');
        expect(challenge?.mode).to.equal('session');
    });

    it('detects session auth without a URL (Not logged in · Please run /login)', () => {
        expect(detectAgentAuthFailureMode('Not logged in · Please run /login')).to.equal('session');
        expect(detectAgentFailureKind('Not logged in · Please run /login')).to.equal('auth');
        const challenge = extractAgentAuthLoginChallenge('Not logged in · Please run /login');
        expect(challenge?.mode).to.equal('session');
        expect(challenge?.url).to.equal(undefined);
    });

    it('detects API-key auth mode separately from session login', () => {
        expect(detectAgentAuthFailureMode('invalid_api_key')).to.equal('api_key');
        expect(localizeAgentAuthFailureMessage({ mode: 'api_key' })).to.match(/API key/i);
        expect(localizeAgentAuthFailureMessage({ mode: 'session' })).to.match(/sign in/i);
    });

    it('resolveAgentLoginCliCommand maps agents to TUI login commands', () => {
        expect(resolveAgentLoginCliCommand('codex')).to.equal('codex login --device-auth');
        expect(resolveAgentLoginCliCommand('claude')).to.equal('claude auth login');
        expect(resolveAgentLoginCliCommand('cursor')).to.equal('cursor-agent login');
        expect(resolveAgentLoginCliCommand('qaiq')).to.equal(undefined);
    });

    it('resolveAgentTurnFailureMessage uses session-login copy for OAuth expiry', () => {
        const message = resolveAgentTurnFailureMessage(
            'Failed to authenticate: OAuth session expired and could not be refreshed',
        );
        expect(message).to.match(/sign in/i);
        expect(message).to.not.match(/API key/i);
    });

    it('resolveAgentLogDisplayText keeps the login URL instead of wiping it', () => {
        const log = [
            '{"type":"assistant","message":{"content":[{"type":"text","text":"Not logged in"}]}}',
            'Open https://auth.openai.com/codex/device and enter ABCD-EFGHI',
        ].join('\n');
        const display = resolveAgentLogDisplayText('codex', log);
        expect(display).to.include('https://auth.openai.com/codex/device');
        expect(display).to.include('ABCD-EFGHI');
        expect(display).to.not.match(/Check your API key/i);
    });
});
