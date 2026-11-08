// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_BUILTIN_AGENT_DEFINITIONS,
    QAAP_HARNESS_DEFINITIONS,
    QAAP_RETIRED_AGENT_DEFINITIONS,
    isUiHiddenVpsAgent,
    resolveQaapBuiltinAgentMentionId,
    resolveQaapCodexTemplate,
} from './qaap-builtin-agents';

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

    it('registers the builtin CLIs as harnesses; retired qaiq is hidden', () => {
        expect(QAAP_HARNESS_DEFINITIONS.map(harness => harness.id).sort())
            .to.deep.equal(['antigravity', 'claude', 'codex', 'copilot', 'cursor', 'grok', 'opencode', 'pi']);
        expect(isUiHiddenVpsAgent('qaiq')).to.equal(true);
    });

    it('runs Pi non-interactively in JSON mode behind the gate extension, with folder trust from {trust_flags}', () => {
        const pi = QAAP_BUILTIN_AGENT_DEFINITIONS.find(agent => agent.id === 'pi');
        expect(pi?.bin).to.equal('pi');
        expect(pi?.label).to.equal('Pi');
        expect(pi?.template).to.equal('pi --mode json -p --no-session -ne -e {gate_ext} {trust_flags} {model_flags} {prompt}');
    });

    it('keeps retired CLIs out of the registry and the mention resolver', () => {
        const retired = QAAP_RETIRED_AGENT_DEFINITIONS.map(agent => agent.id).sort();
        expect(retired).to.deep.equal(['hermes', 'kimi', 'openclaude', 'openclaw', 'qwen']);
        for (const id of retired) {
            expect(resolveQaapBuiltinAgentMentionId(id), id).to.equal(undefined);
        }
        expect(resolveQaapBuiltinAgentMentionId('cursor-agent')).to.equal('cursor');
        expect(resolveQaapBuiltinAgentMentionId('gemini')).to.equal('antigravity');
        expect(resolveQaapBuiltinAgentMentionId('grok-build')).to.equal('grok');
        expect(resolveQaapBuiltinAgentMentionId('PI')).to.equal('pi');
    });
});
