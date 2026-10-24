// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_BUILTIN_AGENT_DEFINITIONS, resolveQaapCodexTemplate } from './qaap-builtin-agents';

describe('Qaap built-in agent command templates', () => {
    it('sends OpenCode CLI errors to stderr so a quota stop reaches the task log', () => {
        const opencode = QAAP_BUILTIN_AGENT_DEFINITIONS.find(agent => agent.id === 'opencode');
        expect(opencode?.template).to.equal(
            'opencode run --format json --print-logs --log-level ERROR --dangerously-skip-permissions {model_flags} {prompt}',
        );
    });

    it('suppresses Codex update checks for detected modern and legacy CLIs', () => {
        expect(resolveQaapCodexTemplate('codex exec [OPTIONS]')).to.contain('-c check_for_update_on_startup=false');
        expect(resolveQaapCodexTemplate('codex -q [OPTIONS]')).to.contain('-c check_for_update_on_startup=false');
        expect(QAAP_BUILTIN_AGENT_DEFINITIONS.find(agent => agent.id === 'codex')?.template)
            .to.contain('-c check_for_update_on_startup=false');
    });
});
