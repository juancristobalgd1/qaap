// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_HARNESS_DEFINITIONS } from './qaap-builtin-agents';
import { resolveAgentConnectionFlow, resolveInteractiveAgentCliBin, resolveInteractiveAgentLoginCommand } from './qaap-agent-tui-command';
import { rememberQaapHostedRuntime } from './qaap-hosted-agent-auth-policy';

describe('resolveInteractiveAgentCliBin', () => {
    it('maps composer agents to interactive TUI binaries', () => {
        expect(resolveInteractiveAgentCliBin('qaiq')).to.equal('qaiq');
        expect(resolveInteractiveAgentCliBin('openclaude')).to.equal('openclaude');
        expect(resolveInteractiveAgentCliBin('codex')).to.equal('codex');
        expect(resolveInteractiveAgentCliBin('claude')).to.equal('claude');
        expect(resolveInteractiveAgentCliBin('grok')).to.equal('grok');
        expect(resolveInteractiveAgentCliBin('antigravity')).to.equal('agy');
        expect(resolveInteractiveAgentCliBin('gemini')).to.equal('agy');
        expect(resolveInteractiveAgentCliBin('opencode')).to.equal('opencode');
    });

    it('returns undefined for unknown or empty ids', () => {
        expect(resolveInteractiveAgentCliBin(undefined)).to.equal(undefined);
        expect(resolveInteractiveAgentCliBin('')).to.equal(undefined);
        expect(resolveInteractiveAgentCliBin('not-an-agent')).to.equal(undefined);
    });
});

describe('resolveInteractiveAgentLoginCommand', () => {
    afterEach(() => {
        rememberQaapHostedRuntime(false);
    });

    it('omits Cursor login on a hosted runtime', () => {
        rememberQaapHostedRuntime(true);
        expect(resolveInteractiveAgentLoginCommand('cursor')).to.equal(undefined);
        expect(resolveInteractiveAgentLoginCommand('codex')).to.equal('codex login --device-auth');
    });

    it('returns the real CLI login command for OAuth agents', () => {
        // Commands audited against the installed CLIs (Aug 2026): headless cloud
        // workspaces need device-code / paste flows, so prefer those flags.
        expect(resolveInteractiveAgentLoginCommand('codex')).to.equal('codex login --device-auth');
        expect(resolveInteractiveAgentLoginCommand('claude')).to.equal('claude auth login');
        expect(resolveInteractiveAgentLoginCommand('cursor')).to.equal(
            process.platform === 'win32'
                ? '$env:NO_OPEN_BROWSER=\'1\'; cursor-agent login'
                : 'NO_OPEN_BROWSER=1 cursor-agent login',
        );
        expect(resolveInteractiveAgentLoginCommand('copilot')).to.equal('copilot login --device-code');
        expect(resolveInteractiveAgentLoginCommand('grok')).to.equal('grok login --device-auth');
    });

    it('does not start an inaccessible TUI as a sign-in flow', () => {
        expect(resolveInteractiveAgentLoginCommand('qaiq')).to.equal(undefined);
        expect(resolveInteractiveAgentLoginCommand('gemini')).to.equal(undefined);
        expect(resolveInteractiveAgentCliBin('opencode')).to.equal('opencode');
    });

    it('returns undefined for unknown or empty ids', () => {
        expect(resolveInteractiveAgentLoginCommand(undefined)).to.equal(undefined);
        expect(resolveInteractiveAgentLoginCommand('')).to.equal(undefined);
        expect(resolveInteractiveAgentLoginCommand('not-an-agent')).to.equal(undefined);
    });
});

describe('resolveAgentConnectionFlow', () => {
    afterEach(() => {
        rememberQaapHostedRuntime(false);
    });

    const expectedKinds: Readonly<Record<string, string>> = {
        qaiq: 'settings-api-key',
        codex: 'cli-login',
        claude: 'cli-login',
        openclaude: 'settings-api-key',
        grok: 'cli-login',
        opencode: 'cli-login',
        hermes: 'settings-api-key',
        openclaw: 'tenant-terminal',
        cursor: 'cli-login',
        antigravity: 'settings-api-key',
        copilot: 'cli-login',
        qwen: 'tenant-terminal',
        kimi: 'tenant-terminal',
    };

    for (const harness of QAAP_HARNESS_DEFINITIONS) {
        it(`resolves ${harness.label} to an explicit connection flow`, () => {
            expect(resolveAgentConnectionFlow(harness.id).kind, harness.id).to.equal(expectedKinds[harness.id]);
        });
    }

    it('routes OpenCode to its headless device-code method instead of the provider picker', () => {
        expect(resolveAgentConnectionFlow('opencode')).to.deep.equal({
            kind: 'cli-login',
            command: 'opencode auth login -p openai -m \'ChatGPT Pro/Plus (headless)\'',
        });
    });

    it('routes Copilot through its remote device-code login command', () => {
        expect(resolveAgentConnectionFlow('copilot')).to.deep.equal({
            kind: 'cli-login',
            command: 'copilot login --device-code',
        });
    });

    it('maps the Gemini alias to its supported Google API-key settings flow', () => {
        expect(resolveAgentConnectionFlow('gemini')).to.deep.equal({
            kind: 'settings-api-key',
            settingsQuery: 'ai-features',
        });
    });

    it('provides no false sign-in route for an unknown harness', () => {
        expect(resolveAgentConnectionFlow('my-custom-agent')).to.deep.equal({ kind: 'unsupported' });
    });

    it('blocks browser callback login on hosted runtimes with a clear restricted route', () => {
        rememberQaapHostedRuntime(true);
        expect(resolveAgentConnectionFlow('cursor')).to.deep.equal({ kind: 'hosted-restricted' });
    });
});
