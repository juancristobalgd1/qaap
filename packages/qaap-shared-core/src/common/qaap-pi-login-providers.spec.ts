// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { extractAgentAuthLoginChallenge } from './qaap-agent-auth-login';
import {
    QAAP_PI_DEFAULT_LOGIN_PROVIDER,
    QAAP_PI_LOGIN_PROVIDERS,
    resolvePiLoginProvider,
} from './qaap-pi-login-providers';
import { resolveAgentConnectionFlow, resolvePiTuiLoginInput } from './qaap-agent-tui-command';

describe('QAAP_PI_LOGIN_PROVIDERS', () => {
    it('lists the Pi account providers in picker order, with OpenRouter as the default', () => {
        expect(QAAP_PI_LOGIN_PROVIDERS.map(provider => provider.id)).to.deep.equal([
            'openrouter',
            'anthropic',
            'openai',
            'github-copilot',
        ]);
        expect(QAAP_PI_DEFAULT_LOGIN_PROVIDER).to.equal('openrouter');
        expect(resolvePiLoginProvider(undefined)).to.equal(undefined);
    });

    it('names each provider as Pi does and never offers Google, which Pi 1.4.0 has no account sign-in for', () => {
        expect(QAAP_PI_LOGIN_PROVIDERS.map(provider => provider.name)).to.deep.equal([
            'OpenRouter',
            'Anthropic (Claude Pro/Max)',
            'OpenAI (ChatGPT subscription)',
            'GitHub Copilot',
        ]);
        expect(QAAP_PI_LOGIN_PROVIDERS.some(provider => /google|gemini|antigravity/i.test(provider.id))).to.equal(false);
    });

    it('resolves a provider by id case-insensitively and rejects anything else', () => {
        expect(resolvePiLoginProvider(' Anthropic ')?.name).to.equal('Anthropic (Claude Pro/Max)');
        expect(resolvePiLoginProvider('openai-codex')).to.equal(undefined);
        expect(resolvePiLoginProvider('openrouter\r/quit')).to.equal(undefined);
    });
});

describe('resolvePiTuiLoginInput per provider', () => {
    it('keeps the verified OpenRouter keystrokes: `/login`, then Enter through the autocomplete and the picker', () => {
        const steps = resolvePiTuiLoginInput('openrouter');
        expect(steps.map(step => step.text)).to.deep.equal(['/login openrouter', '\r', '\r', '\r']);
    });

    it('adds the Anthropic login-method Enter after the picker, waiting for its screen', () => {
        const steps = resolvePiTuiLoginInput('anthropic');
        expect(steps.map(step => step.text)).to.deep.equal(['/login anthropic', '\r', '\r', '\r', '\r']);
        expect(new RegExp(steps[4].waitFor!, 'i').test('Select Anthropic login method:')).to.equal(true);
    });

    it('adds the GitHub Enterprise domain Enter (blank for github.com) after the picker', () => {
        const steps = resolvePiTuiLoginInput('github-copilot');
        expect(steps.map(step => step.text)).to.deep.equal(['/login github-copilot', '\r', '\r', '\r', '\r']);
        expect(new RegExp(steps[4].waitFor!, 'i').test('GitHub Enterprise URL/domain (blank for github.com)')).to.equal(true);
    });

    it('needs no extra screen for OpenAI, which opens the browser sign-in right after the picker', () => {
        expect(resolvePiTuiLoginInput('openai').map(step => step.text)).to.deep.equal(['/login openai', '\r', '\r', '\r']);
    });
});

describe('resolveAgentConnectionFlow for Pi providers', () => {
    it('defaults to OpenRouter and falls back to it for an unsupported provider', () => {
        const flow = resolveAgentConnectionFlow('pi');
        expect(flow.kind === 'tui-login' && flow.provider).to.equal('openrouter');
        const unsupported = resolveAgentConnectionFlow('pi', { provider: 'google-gemini-cli' });
        expect(unsupported.kind === 'tui-login' && unsupported.provider).to.equal('openrouter');
    });

    it('restarts with the chosen provider: its id, its keystrokes, the same Pi command', () => {
        const flow = resolveAgentConnectionFlow('pi', { provider: 'github-copilot' });
        expect(flow.kind).to.equal('tui-login');
        if (flow.kind !== 'tui-login') {
            return;
        }
        expect(flow.provider).to.equal('github-copilot');
        expect(flow.input[0].text).to.equal('/login github-copilot');
        expect(flow.input.length).to.equal(5);
        expect(flow.command).to.equal('pi --tui-mode regular --no-session --no-approve');
        expect(flow.fallbackCommand).to.equal('pi');
    });
});

describe('Pi authorize-host allowlist per provider', () => {
    const challengeUrl = (text: string): string | undefined => extractAgentAuthLoginChallenge(text, { agentId: 'pi' })?.url;

    it('accepts each provider\'s exact authorize or device page', () => {
        expect(challengeUrl('Open https://claude.ai/oauth/authorize?code=true&state=abc to sign in')).to.equal(
            'https://claude.ai/oauth/authorize?code=true&state=abc');
        expect(challengeUrl('Open https://auth.openai.com/api/accounts/authorize?response_type=code to sign in')).to.equal(
            'https://auth.openai.com/api/accounts/authorize?response_type=code');
        expect(challengeUrl('Open https://github.com/login/device and enter code ABCD-1234')).to.equal(
            'https://github.com/login/device');
        expect(challengeUrl('Open https://openrouter.ai/auth?callback_url=x to sign in')).to.equal(
            'https://openrouter.ai/auth?callback_url=x');
    });

    it('rejects other pages of the same hosts and lookalike hosts for Pi', () => {
        for (const url of [
            'https://claude.ai/login',
            'https://auth.openai.com/oauth/authorize?client_id=x',
            'https://github.com/login/oauth/authorize?client_id=x',
            'https://evil-claude.ai/oauth/authorize?code=true',
            'https://claude.ai.evil.example/oauth/authorize',
        ]) {
            expect(challengeUrl(`Open ${url} to sign in`), url).to.equal(undefined);
        }
    });
});
