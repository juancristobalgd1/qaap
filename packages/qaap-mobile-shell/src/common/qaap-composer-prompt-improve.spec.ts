// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildImproveComposerPromptRequest,
    extractImprovedComposerPromptFromAgentStdout,
    formatAgentModelLanguageModelId,
    looksLikeAgentNdjsonStream,
    sanitizeImprovedComposerPrompt,
} from '../common/qaap-composer-prompt-improve';

describe('qaap-composer-prompt-improve', () => {

    it('formatAgentModelLanguageModelId builds vendor/model ids', () => {
        expect(formatAgentModelLanguageModelId({
            provider: 'openai',
            vendor: 'openrouter',
            modelId: 'meta/llama',
        })).to.equal('openrouter/meta/llama');
        expect(formatAgentModelLanguageModelId({
            provider: 'openai',
            vendor: 'unknown',
            modelId: 'gpt-4o',
        })).to.equal('gpt-4o');
    });

    it('sanitizeImprovedComposerPrompt strips fences and preambles', () => {
        expect(sanitizeImprovedComposerPrompt('```markdown\nFix login bug\n```')).to.equal('Fix login bug');
        expect(sanitizeImprovedComposerPrompt("Here's the improved prompt:\n\nRefactor auth module")).to.equal('Refactor auth module');
    });

    it('buildImproveComposerPromptRequest preserves the original prompt', () => {
        const request = buildImproveComposerPromptRequest('Add dark mode toggle');
        expect(request).to.include('Add dark mode toggle');
        expect(request).to.include('Return only the optimized prompt text.');
    });

    it('looksLikeAgentNdjsonStream detects structured agent stdout', () => {
        const ndjson = [
            '{"type":"step_start","part":{"type":"step-start"}}',
            '{"type":"text","part":{"type":"text","text":"Hello"}}',
        ].join('\n');
        expect(looksLikeAgentNdjsonStream(ndjson)).to.equal(true);
        expect(looksLikeAgentNdjsonStream('Rewrite the login flow for clarity.')).to.equal(false);
    });

    it('extractImprovedComposerPromptFromAgentStdout parses OpenCode NDJSON', () => {
        const stdout = [
            '{"type":"step_start","timestamp":1781571411263,"sessionID":"ses_x","part":{"id":"prt_a","type":"step-start"}}',
            '{"type":"text","timestamp":1781571413438,"sessionID":"ses_x","part":{"id":"prt_b","type":"text","text":"Revisa y mejora esta interfaz de usuario."}}',
            '{"type":"step_finish","timestamp":1781571413493,"sessionID":"ses_x","part":{"id":"prt_c","type":"step-finish","reason":"stop"}}',
        ].join('\n');
        expect(extractImprovedComposerPromptFromAgentStdout('opencode', stdout))
            .to.equal('Revisa y mejora esta interfaz de usuario.');
    });
});
