// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    agentHasCliOAuthLogin,
    agentNeedsSettingsApiKeyPath,
    localizeAddApiKeyInSettingsCta,
    detectAgentAuthFailureMode,
    extractAgentAuthLoginChallenge,
    isUnauthenticatedCliDeclaration,
    localizeAgentAuthFailureMessage,
    localizeAgentSettingsApiKeyLoginMessage,
    resolveAgentLoginCliCommand,
} from './qaap-agent-auth-login';
import { detectAgentFailureKind, resolveAgentTurnFailureMessage } from './qaap-agent-failure-message';
import { resolveAgentLogDisplayText } from './qaap-cli-transcript-stream';
import { rememberQaapHostedRuntime } from './qaap-hosted-agent-auth-policy';

describe('qaap-agent-auth-login', () => {
    afterEach(() => {
        rememberQaapHostedRuntime(false);
    });


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
        const challenge = extractAgentAuthLoginChallenge(log, { agentId: 'claude' });
        expect(challenge?.url).to.equal('https://claude.ai/oauth/authorize?code=true&client_id=abc');
        expect(challenge?.mode).to.equal('session');
    });

    it('rejects deceptive, insecure, and unrelated login-looking URLs', () => {
        const samples = [
            'Open http://auth.openai.com/codex/device to sign in',
            'Open https://auth.openai.com.attacker.example/codex/device to sign in',
            'Open https://attacker.example/oauth?next=https://auth.openai.com/codex/device to sign in',
            'Open https://github.com/example/oauth-demo to sign in',
            'Open https://auth.openai.com:8443/codex/device to sign in',
        ];
        for (const sample of samples) {
            expect(extractAgentAuthLoginChallenge(sample, { agentId: 'codex' })?.url).to.equal(undefined);
        }
    });

    it('applies the supported agent origin policy when agent provenance is known', () => {
        const openAiLogin = 'Sign in at https://auth.openai.com/codex/device';
        expect(extractAgentAuthLoginChallenge(openAiLogin, { agentId: 'codex' })?.url)
            .to.equal('https://auth.openai.com/codex/device');
        expect(extractAgentAuthLoginChallenge(openAiLogin, { agentId: 'claude' })?.url).to.equal(undefined);

        const githubLogin = 'Sign in at https://github.com/login/device';
        expect(extractAgentAuthLoginChallenge(githubLogin, { agentId: 'copilot' })?.url)
            .to.equal('https://github.com/login/device');
        expect(extractAgentAuthLoginChallenge(githubLogin, { agentId: 'cursor' })?.url).to.equal(undefined);
    });

    it('detects session auth without a URL (Not logged in · Please run /login)', () => {
        expect(detectAgentAuthFailureMode('Not logged in · Please run /login')).to.equal('session');
        expect(detectAgentFailureKind('Not logged in · Please run /login')).to.equal('auth');
        const challenge = extractAgentAuthLoginChallenge('Not logged in · Please run /login');
        expect(challenge?.mode).to.equal('session');
        expect(challenge?.url).to.equal(undefined);
    });

    it('detects Copilot CLI sign-out (exit-0 stdout refusal, no URL/code) as session login', () => {
        const log = [
            'Error: No authentication information found.',
            'Copilot can be authenticated with GitHub using an OAuth Token or a Fine-Grained Personal Access Token.',
            "To authenticate, you can use any of the following methods: • Start 'copilot' and run the '/login' command"
            + ' • Set the COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN environment variable'
            + " • Run 'gh auth login' to authenticate with the GitHub CLI",
        ].join('\n');
        // Not an API key failure (BYOK) — this is a terminal sign-in, so the Sign-in card must show.
        expect(detectAgentAuthFailureMode(log)).to.equal('session');
        expect(detectAgentFailureKind(log)).to.equal('auth');
        expect(extractAgentAuthLoginChallenge(log)?.mode).to.equal('session');
        // Strong enough to fail an otherwise-clean (exit 0) turn.
        expect(isUnauthenticatedCliDeclaration(log)).to.equal(true);
    });

    it('isUnauthenticatedCliDeclaration ignores prose that merely mentions auth', () => {
        // A successful turn that edited auth code must NOT be reclassified as a sign-in failure.
        expect(isUnauthenticatedCliDeclaration(
            'Updated src/auth/login.ts to handle the OAuth session and the login redirect.',
        )).to.equal(false);
        expect(isUnauthenticatedCliDeclaration('Done — everything is authenticated now.')).to.equal(false);
    });

    it('detects API-key auth mode separately from session login', () => {
        expect(detectAgentAuthFailureMode('invalid_api_key')).to.equal('api_key');
        expect(localizeAgentAuthFailureMessage({ mode: 'api_key' })).to.match(/API key/i);
        expect(localizeAgentAuthFailureMessage({ mode: 'session' })).to.match(/sign in/i);
    });

    it('classifies QAIQ Codex credential refusal as auth, not a generic turn failure', () => {
        const log = 'Codex auth is required for gpt-5.5. Set CODEX_API_KEY or run qaiq login.';
        expect(detectAgentFailureKind(log)).to.equal('auth');
        const message = resolveAgentTurnFailureMessage(log, { state: 'failed', exitCode: 1 });
        expect(message).to.not.match(/could not finish this task/i);
        expect(message.toLowerCase()).to.match(/sign in|api key/);
    });

    it('omits Cursor login on a hosted runtime because localhost OAuth cannot finish', () => {
        rememberQaapHostedRuntime(true);
        expect(resolveAgentLoginCliCommand('cursor')).to.equal(undefined);
        expect(agentHasCliOAuthLogin('cursor')).to.equal(false);
        expect(resolveAgentLoginCliCommand('codex')).to.equal('codex login --device-auth');
        expect(agentHasCliOAuthLogin('codex')).to.equal(true);
    });

    it('resolveAgentLoginCliCommand maps agents to their audited device-code login command', () => {
        // Verified against the installed CLIs (Aug 2026): device-code where the CLI offers one.
        expect(resolveAgentLoginCliCommand('codex')).to.equal('codex login --device-auth');
        expect(resolveAgentLoginCliCommand('claude')).to.equal('claude auth login');
        expect(resolveAgentLoginCliCommand('grok')).to.equal('grok login --device-auth');
        expect(resolveAgentLoginCliCommand('copilot')).to.equal('gh auth login --web');
        expect(resolveAgentLoginCliCommand('cursor')).to.equal(
            process.platform === 'win32'
                ? '$env:NO_OPEN_BROWSER=\'1\'; cursor-agent login'
                : 'NO_OPEN_BROWSER=1 cursor-agent login',
        );
        // BYOK / no login subcommand — routed to Settings, never a bare TUI.
        expect(resolveAgentLoginCliCommand('qaiq')).to.equal(undefined);
        expect(resolveAgentLoginCliCommand('antigravity')).to.equal(undefined);
        expect(resolveAgentLoginCliCommand('opencode')).to.equal(undefined);
    });

    it('agentHasCliOAuthLogin is true only for CLI OAuth agents, false for BYOK/Settings', () => {
        // Agents with a real terminal sign-in — the proactive login entry appears.
        expect(agentHasCliOAuthLogin('codex')).to.equal(true);
        expect(agentHasCliOAuthLogin('claude')).to.equal(true);
        expect(agentHasCliOAuthLogin('cursor')).to.equal(true);
        expect(agentHasCliOAuthLogin('copilot')).to.equal(true);
        // grok has a real device-code login — corrected from BYOK after auditing its CLI.
        expect(agentHasCliOAuthLogin('grok')).to.equal(true);
        // BYOK / Settings-catalog agents — no terminal sign-in, no proactive entry.
        expect(agentHasCliOAuthLogin('qaiq')).to.equal(false);
        expect(agentHasCliOAuthLogin('opencode')).to.equal(false);
        // antigravity's `agy` only launches the TUI — no login, so BYOK.
        expect(agentHasCliOAuthLogin('antigravity')).to.equal(false);
        expect(agentHasCliOAuthLogin(undefined)).to.equal(false);
        expect(agentHasCliOAuthLogin('')).to.equal(false);
    });

    it('agentNeedsSettingsApiKeyPath is true for BYOK agents and false for OAuth or Shell', () => {
        expect(agentNeedsSettingsApiKeyPath('qaiq')).to.equal(true);
        expect(agentNeedsSettingsApiKeyPath('opencode')).to.equal(true);
        expect(agentNeedsSettingsApiKeyPath('antigravity')).to.equal(true);
        expect(agentNeedsSettingsApiKeyPath('codex')).to.equal(false);
        expect(agentNeedsSettingsApiKeyPath('cursor')).to.equal(false);
        expect(agentNeedsSettingsApiKeyPath('shell')).to.equal(false);
        rememberQaapHostedRuntime(true);
        expect(agentNeedsSettingsApiKeyPath('cursor')).to.equal(false);
        expect(agentNeedsSettingsApiKeyPath('qaiq')).to.equal(true);
        expect(localizeAddApiKeyInSettingsCta()).to.match(/API key/i);
    });

    it('localizeAgentSettingsApiKeyLoginMessage points BYOK agents to the Settings API key', () => {
        const named = localizeAgentSettingsApiKeyLoginMessage('QAIQ');
        expect(named).to.match(/QAIQ/);
        expect(named).to.match(/API key/i);
        expect(named).to.match(/Settings/i);
        const generic = localizeAgentSettingsApiKeyLoginMessage();
        expect(generic).to.match(/API key/i);
        expect(generic).to.match(/Settings/i);
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
