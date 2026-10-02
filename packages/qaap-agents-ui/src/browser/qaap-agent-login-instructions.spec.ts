// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveAgentLoginDialogSubtitle,
    resolveAgentPickerConnectionDescription,
} from './qaap-agent-login-instructions';

describe('Qaap agent login instructions', () => {
    it('names the account needed to connect Codex and Claude Code in the picker', () => {
        expect(resolveAgentPickerConnectionDescription('codex', 'Codex', 'OpenAI coding agent'))
            .to.contain('ChatGPT');
        expect(resolveAgentPickerConnectionDescription('claude', 'Claude Code', 'Anthropic coding agent'))
            .to.contain('Claude account');
    });

    it('explains the browser sign-in step for Codex and Claude Code', () => {
        expect(resolveAgentLoginDialogSubtitle('codex')).to.contain('ChatGPT account');
        expect(resolveAgentLoginDialogSubtitle('codex')).to.contain('browser verification');
        expect(resolveAgentLoginDialogSubtitle('claude')).to.contain('Claude account');
        expect(resolveAgentLoginDialogSubtitle('claude')).to.contain('browser authorization');
    });

    it('keeps a generic localized instruction for other CLI agents', () => {
        expect(resolveAgentPickerConnectionDescription('hermes', 'Hermes', 'Hermes coding agent'))
            .to.contain('Not connected on this workspace');
        expect(resolveAgentLoginDialogSubtitle('hermes')).to.contain('own subscription');
    });
});
