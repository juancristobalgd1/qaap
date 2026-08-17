// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { bindingFromQaiqModelSelection } from './qaap-qaiq-model-binding';
import { formatModelFlagsForAgent } from './qaap-agent-model-flags';

describe('formatModelFlagsForAgent', () => {
    it('formats qaiq and grok flags differently', () => {
        const binding = bindingFromQaiqModelSelection({
            provider: 'openai',
            vendor: 'openrouter',
            modelId: 'deepseek/deepseek-chat:free',
        });
        expect(formatModelFlagsForAgent('qaiq', binding)).to.equal('--provider openai --model deepseek/deepseek-chat:free');
        expect(formatModelFlagsForAgent('grok', binding)).to.equal('-m deepseek/deepseek-chat:free');
    });

    it('keeps OpenClaude on the QAIQ provider flag contract without sharing QAIQ identity', () => {
        const binding = bindingFromQaiqModelSelection({
            provider: 'anthropic',
            vendor: 'anthropic',
            modelId: 'claude-opus-4-7',
        });
        expect(formatModelFlagsForAgent('openclaude', binding)).to.equal('--provider anthropic --model claude-opus-4-7');
    });

    it('uses -m for codex and --model for other CLIs', () => {
        const binding = bindingFromQaiqModelSelection({
            provider: 'openai',
            vendor: 'codex',
            modelId: 'o4-mini',
        });
        expect(formatModelFlagsForAgent('codex', binding)).to.equal('-m o4-mini');
        expect(formatModelFlagsForAgent('opencode', binding)).to.equal('--model o4-mini');
        expect(formatModelFlagsForAgent('hermes', {
            provider: 'anthropic',
            vendor: 'anthropic',
            modelId: 'anthropic/claude-fable-5',
            contextWindow: 128_000,
        })).to.equal('--model anthropic/claude-fable-5');
    });

    it('leaves antigravity model flags empty (settings.json override instead)', () => {
        const binding = bindingFromQaiqModelSelection({
            provider: 'anthropic',
            vendor: 'antigravity',
            modelId: 'Claude Opus 4.6 (Thinking)',
        });
        expect(formatModelFlagsForAgent('antigravity', binding)).to.equal('');
    });
});
