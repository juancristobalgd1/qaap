// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { extractAgentAuthLoginChallenge } from './qaap-agent-auth-login';
import {
    QAAP_PI_API_KEY_SAVED_PATTERN,
    QAAP_PI_DEFAULT_LOGIN_PROVIDER,
    QAAP_PI_LOGIN_PROVIDERS,
    QAAP_PI_SECRET_PROMPT_PATTERN,
    resolvePiLoginProvider,
} from './qaap-pi-login-providers';
import { resolveAgentConnectionFlow, resolvePiTuiLoginInput } from './qaap-agent-tui-command';

describe('QAAP_PI_LOGIN_PROVIDERS', () => {
    it('lists the account sign-ins first, OpenRouter as the default, then the API-key providers', () => {
        const ids = QAAP_PI_LOGIN_PROVIDERS.map(provider => provider.id);
        expect(ids.slice(0, 4)).to.deep.equal(['openrouter', 'anthropic', 'openai', 'github-copilot']);
        expect(QAAP_PI_LOGIN_PROVIDERS.slice(0, 4).every(provider => provider.method === 'account')).to.equal(true);
        expect(QAAP_PI_LOGIN_PROVIDERS.slice(4).every(provider => provider.method === 'api_key')).to.equal(true);
        expect(ids).to.include.members(['google', 'xai', 'groq', 'deepseek', 'mistral', 'huggingface', 'kimi-coding', 'zai', 'together']);
        expect(new Set(ids).size).to.equal(ids.length);
        expect(QAAP_PI_DEFAULT_LOGIN_PROVIDER).to.equal('openrouter');
        expect(resolvePiLoginProvider(undefined)).to.equal(undefined);
    });

    it('never offers a provider configured outside /login, a legacy entry or the custom gateway', () => {
        for (const id of ['amazon-bedrock', 'google-vertex', 'azure', 'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'openai-codex', 'radius']) {
            expect(resolvePiLoginProvider(id), id).to.equal(undefined);
        }
    });

    it('only uses ids Pi accepts as a single /login argument', () => {
        for (const provider of QAAP_PI_LOGIN_PROVIDERS) {
            expect(provider.id, provider.id).to.match(/^[a-z0-9][a-z0-9-]*$/);
        }
    });

    it('resolves a provider by id case-insensitively and rejects anything else', () => {
        expect(resolvePiLoginProvider(' Anthropic ')?.name).to.equal('Anthropic (Claude Pro/Max)');
        expect(resolvePiLoginProvider('openai-codex')).to.equal(undefined);
        expect(resolvePiLoginProvider('openrouter\r/quit')).to.equal(undefined);
    });

    it('reads what Pi asks for from its API-key prompt, and its saved line', () => {
        const prompt = new RegExp(QAAP_PI_SECRET_PROMPT_PATTERN, 'i');
        expect(prompt.exec('Enter Groq API key')?.[1]).to.equal('Groq API key');
        // As a PTY draws it (`\r\r\n` line ends, trailing spaces), verified in the staging container.
        expect(prompt.exec(' Enter Groq API key \r\r\n> ')?.[1]).to.equal('Groq API key');
        expect(prompt.exec(' Enter Hugging Face token ')?.[1]).to.equal('Hugging Face token');
        expect(prompt.exec('Enter Qwen Token Plan API key')?.[1]).to.equal('Qwen Token Plan API key');
        expect(prompt.test('Press Enter to continue')).to.equal(false);
        expect(new RegExp(QAAP_PI_API_KEY_SAVED_PATTERN, 'i').test('Saved API key for Groq')).to.equal(true);
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

    it('goes straight to the key prompt for an API-key-only provider (verified with Groq in a PTY)', () => {
        expect(resolvePiTuiLoginInput('groq').map(step => step.text)).to.deep.equal(['/login groq', '\r', '\r']);
    });

    it('picks "Sign in with an API key" (Down, Enter) for a provider that also has an account sign-in', () => {
        const steps = resolvePiTuiLoginInput('xai');
        expect(steps.map(step => step.text)).to.deep.equal(['/login xai', '\r', '\r', '\x1b[B', '\r']);
        expect(new RegExp(steps[3].waitFor!, 'i').test('Select authentication method for xAI:')).to.equal(true);
        expect(new RegExp(steps[2].skipWhen!, 'i').test('Select authentication method for xAI:')).to.equal(true);
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
