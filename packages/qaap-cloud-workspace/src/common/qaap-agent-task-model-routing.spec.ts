// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentTaskKind } from './qaap-agent-task';
import {
    classifyAgentTaskKind,
    resolveEffectiveRequestAgentModel,
    resolveRoutedQaiqModelBinding,
} from './qaap-agent-task-model-routing';

describe('classifyAgentTaskKind', () => {
    it('treats ask mode as exploration', () => {
        expect(classifyAgentTaskKind('anything', 'ask')).to.equal('exploration');
    });

    it('detects implementation prompts', () => {
        expect(classifyAgentTaskKind('Refactor the auth module and open a PR')).to.equal('implementation');
        expect(classifyAgentTaskKind('Implementa el fix y haz commit')).to.equal('implementation');
    });

    it('detects exploration prompts', () => {
        expect(classifyAgentTaskKind('Where is the SSE handler defined?')).to.equal('exploration');
        expect(classifyAgentTaskKind('Explora cómo funciona el runner')).to.equal('exploration');
    });
});

describe('resolveRoutedQaiqModelBinding', () => {
    it('prefers universal alias for exploration', () => {
        const readPref = (key: string): unknown => {
            if (key === 'ai-features.languageModelAliases') {
                return {
                    'default/universal': { selectedModel: 'openrouter/meta-llama/llama-3.3-70b-instruct:free' },
                    'default/code': { selectedModel: 'anthropic/claude-sonnet-4-20250514' },
                };
            }
            return undefined;
        };
        const binding = resolveRoutedQaiqModelBinding(readPref, 'exploration');
        expect(binding?.modelId).to.equal('meta-llama/llama-3.3-70b-instruct:free');
    });

    it('prefers code alias for implementation', () => {
        const readPref = (key: string): unknown => {
            if (key === 'ai-features.languageModelAliases') {
                return {
                    'default/universal': { selectedModel: 'openrouter/meta-llama/llama-3.3-70b-instruct:free' },
                    'default/code': { selectedModel: 'anthropic/claude-sonnet-4-20250514' },
                };
            }
            return undefined;
        };
        const binding = resolveRoutedQaiqModelBinding(readPref, 'implementation');
        expect(binding?.modelId).to.equal('claude-sonnet-4-20250514');
    });
});

describe('resolveEffectiveRequestAgentModel', () => {
    it('keeps an explicit picker model', () => {
        const explicit = { provider: 'anthropic' as const, vendor: 'anthropic', modelId: 'claude-opus' };
        expect(resolveEffectiveRequestAgentModel(
            { prompt: 'explore foo', agentModel: explicit },
            () => undefined,
            'qaiq',
        )).to.deep.equal(explicit);
    });

    it('routes when no explicit model is provided', () => {
        const readPref = (key: string): unknown => {
            if (key === 'ai-features.languageModelAliases') {
                return {
                    'default/code': { selectedModel: 'anthropic/claude-sonnet-4-20250514' },
                };
            }
            return undefined;
        };
        const routed = resolveEffectiveRequestAgentModel(
            { prompt: 'Implement the OAuth callback fix' },
            readPref,
            'qaiq',
        );
        expect(routed?.modelId).to.equal('claude-sonnet-4-20250514');
    });

    it('never routes a Settings alias model to a native-catalog agent (claude/codex)', () => {
        const readPref = (key: string): unknown => {
            if (key === 'ai-features.languageModelAliases') {
                return {
                    'default/code': { selectedModel: 'nvidia/meta/llama-3.3-70b-instruct' },
                    'default/universal': { selectedModel: 'nvidia/meta/llama-3.3-70b-instruct' },
                };
            }
            return undefined;
        };
        for (const agentId of ['claude', 'codex', 'grok', 'opencode']) {
            const routed = resolveEffectiveRequestAgentModel(
                { prompt: 'Implement the OAuth callback fix' },
                readPref,
                agentId,
            );
            expect(routed, agentId).to.equal(undefined);
        }
    });

    it('keeps an explicit picker model for a native-catalog agent', () => {
        const explicit = { provider: 'anthropic' as const, vendor: 'claude', modelId: 'claude-haiku-4-5' };
        expect(resolveEffectiveRequestAgentModel(
            { prompt: 'Implement the OAuth callback fix', agentModel: explicit },
            () => undefined,
            'claude',
        )).to.deep.equal(explicit);
    });

    // Precedence: explicit agentModel > caller-supplied taskKind > text-heuristic classifyAgentTaskKind.
    describe('taskKind precedence', () => {
        const readPref = (key: string): unknown => {
            if (key === 'ai-features.languageModelAliases') {
                return {
                    'default/universal': { selectedModel: 'openrouter/meta-llama/llama-3.3-70b-instruct:free' },
                    'default/code': { selectedModel: 'anthropic/claude-sonnet-4-20250514' },
                };
            }
            return undefined;
        };

        it('an explicit agentModel wins over a supplied taskKind', () => {
            const explicit = { provider: 'anthropic' as const, vendor: 'anthropic', modelId: 'claude-opus' };
            const routed = resolveEffectiveRequestAgentModel(
                { prompt: 'Explore the auth module', taskKind: 'implementation', agentModel: explicit },
                readPref,
                'qaiq',
            );
            expect(routed).to.deep.equal(explicit);
        });

        it('a supplied taskKind wins over the text-heuristic classifier', () => {
            // Prompt text reads as exploration, but the caller (e.g. a workflow 'implement' node)
            // asserts it is implementation work — the hint must override the heuristic.
            const routed = resolveEffectiveRequestAgentModel(
                { prompt: 'Where should this refactor land? Explore first.', taskKind: 'implementation' },
                readPref,
                'qaiq',
            );
            expect(routed?.modelId).to.equal('claude-sonnet-4-20250514');
        });

        it('falls back to the text-heuristic classifier when taskKind is undefined', () => {
            const routed = resolveEffectiveRequestAgentModel(
                { prompt: 'Where is the SSE handler defined?', taskKind: undefined },
                readPref,
                'qaiq',
            );
            expect(routed?.modelId).to.equal('meta-llama/llama-3.3-70b-instruct:free');
        });

        it('keeps prior behavior for an empty prompt when taskKind is undefined: no routing at all', () => {
            const routed = resolveEffectiveRequestAgentModel(
                { prompt: '', taskKind: undefined },
                readPref,
                'qaiq',
            );
            expect(routed).to.equal(undefined);
        });

        it('routes an empty prompt when taskKind is explicitly supplied', () => {
            // A workflow-originated request always carries taskKind, so an (unlikely) empty prompt
            // must still route rather than silently falling through like the no-hint case above.
            const routed = resolveEffectiveRequestAgentModel(
                { prompt: '', taskKind: 'exploration' },
                readPref,
                'qaiq',
            );
            expect(routed?.modelId).to.equal('meta-llama/llama-3.3-70b-instruct:free');
        });
    });
});

describe('QaapAgentTaskKind.is', () => {

    it('accepts the three kinds', () => {
        for (const kind of ['exploration', 'implementation', 'general']) {
            expect(QaapAgentTaskKind.is(kind), kind).to.equal(true);
        }
    });

    it('rejects anything else an untyped HTTP body could carry', () => {
        // The task-create endpoint narrows `body.taskKind` with this guard: an unknown string would
        // otherwise reach the routing switch and silently take the default branch, which reads as
        // "the hint did nothing" rather than "the hint was invalid".
        for (const value of ['Exploration', 'implement', '', 'general ', 0, 1, true, null, undefined, {}, ['general']]) {
            expect(QaapAgentTaskKind.is(value), JSON.stringify(value) ?? 'undefined').to.equal(false);
        }
    });
});
