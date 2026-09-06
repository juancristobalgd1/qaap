// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveInteractiveAgentCliBin, resolveInteractiveAgentLoginCommand } from './qaap-agent-tui-command';

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
        expect(resolveInteractiveAgentLoginCommand('copilot')).to.equal('gh auth login --web');
        expect(resolveInteractiveAgentLoginCommand('grok')).to.equal('grok login --device-auth');
    });

    it('does NOT fall back to the bare interactive binary for BYOK/Settings agents', () => {
        // Regression guard: launching the bare TUI never signs anyone in, so login
        // intent must resolve to undefined (the UI then points to Settings).
        expect(resolveInteractiveAgentLoginCommand('qaiq')).to.equal(undefined);
        expect(resolveInteractiveAgentLoginCommand('opencode')).to.equal(undefined);
        expect(resolveInteractiveAgentLoginCommand('gemini')).to.equal(undefined);
        // The bare interactive binary still exists for opencode — proving the
        // login path deliberately declines it rather than there being no binary.
        expect(resolveInteractiveAgentCliBin('opencode')).to.equal('opencode');
    });

    it('returns undefined for unknown or empty ids', () => {
        expect(resolveInteractiveAgentLoginCommand(undefined)).to.equal(undefined);
        expect(resolveInteractiveAgentLoginCommand('')).to.equal(undefined);
        expect(resolveInteractiveAgentLoginCommand('not-an-agent')).to.equal(undefined);
    });
});
