// *****************************************************************************
// Copyright (C) 2026 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { MockLogger } from '@theia/core/lib/common/test/mock-logger';
import { LanguageModelMessage } from '@theia/ai-core';
import { ModelMessage } from 'ai';
import { VercelAiModel, VercelAiStreamTransformer } from './vercel-ai-language-model';
import { VercelAiLanguageModelFactory } from './vercel-ai-language-model-factory';

class TestableVercelAiModel extends VercelAiModel {
    constructor() {
        super(
            'test-id',
            'test-model',
            { status: 'ready' },
            true,
            false,
            undefined,
            new MockLogger(),
            new VercelAiLanguageModelFactory(),
            () => ({ provider: 'openai', apiKey: 'k' })
        );
    }

    public callProcessMessages(messages: LanguageModelMessage[]): Array<ModelMessage> {
        return this.processMessages(messages);
    }
}

describe('VercelAiModel - processMessages', () => {
    const model = new TestableVercelAiModel();

    it('should merge consecutive assistant text messages with a newline separator', () => {
        const messages: LanguageModelMessage[] = [
            { actor: 'user', type: 'text', text: 'q' },
            { actor: 'ai', type: 'text', text: 'part one' },
            { actor: 'ai', type: 'text', text: 'part two' }
        ];
        const result = model.callProcessMessages(messages);
        expect(result).to.deep.equal([
            { role: 'user', content: 'q' },
            { role: 'assistant', content: 'part one\npart two' }
        ]);
    });

    it('should leave alternating user/assistant messages unchanged', () => {
        const messages: LanguageModelMessage[] = [
            { actor: 'user', type: 'text', text: 'q1' },
            { actor: 'ai', type: 'text', text: 'a1' },
            { actor: 'user', type: 'text', text: 'q2' },
            { actor: 'ai', type: 'text', text: 'a2' }
        ];
        const result = model.callProcessMessages(messages);
        expect(result).to.deep.equal([
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q2' },
            { role: 'assistant', content: 'a2' }
        ]);
    });

    it('should reproduce the bug scenario from issue #17104 (consecutive ai messages)', () => {
        const messages: LanguageModelMessage[] = [
            { actor: 'user', type: 'text', text: 'first request' },
            { actor: 'ai', type: 'text', text: 'reasoning' },
            { actor: 'ai', type: 'text', text: 'final answer' }
        ];
        const result = model.callProcessMessages(messages);
        for (let i = 1; i < result.length; i++) {
            expect(result[i - 1].role === 'assistant' && result[i].role === 'assistant').to.equal(false);
        }
        expect(result).to.have.lengthOf(2);
        expect(result[1]).to.deep.equal({ role: 'assistant', content: 'reasoning\nfinal answer' });
    });
});

describe('VercelAiModel - AI SDK 7 compatibility', () => {
    it('keeps OpenAI-compatible models on the Chat Completions protocol', () => {
        const languageModel = new VercelAiLanguageModelFactory().createLanguageModel({
            id: 'openai/test',
            model: 'gpt-4o-mini',
            apiKey: true,
            enableStreaming: true,
            supportsStructuredOutput: true,
            maxRetries: 3,
        }, {
            provider: 'openai',
            apiKey: 'test-key',
        });

        expect(languageModel.provider).to.equal('openai.chat');
    });

    it('translates v7 text, tool input/output, and token usage stream parts', async () => {
        const parts = [
            { type: 'text-delta', id: 'text-1', text: 'hello' },
            { type: 'tool-input-start', id: 'call-1', toolName: 'lookup' },
            { type: 'tool-input-delta', id: 'call-1', delta: '{"q":"x"}' },
            { type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup', input: { q: 'x' }, output: 'found', dynamic: true },
            {
                type: 'finish-step',
                response: { id: 'response-1', timestamp: new Date(), modelId: 'test-model' },
                usage: {
                    inputTokens: 7,
                    inputTokenDetails: { noCacheTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 },
                    outputTokens: 3,
                    outputTokenDetails: { textTokens: 3, reasoningTokens: 0 },
                    totalTokens: 10,
                },
                finishReason: 'stop',
                rawFinishReason: 'stop',
                providerMetadata: undefined,
            },
        ];
        const stream = {
            cancel: () => undefined,
            async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
                yield* parts;
            },
        };
        const transformer = new VercelAiStreamTransformer(stream as never, { logger: new MockLogger() });
        const translated: unknown[] = [];
        for await (const part of transformer.transform()) {
            translated.push(JSON.parse(JSON.stringify(part)));
        }

        expect(translated[0]).to.deep.equal({ content: 'hello' });
        expect(translated).to.deep.include({
            tool_calls: [{
                id: 'call-1',
                function: { name: 'lookup', arguments: '{"q":"x"}' },
                finished: true,
                result: 'found',
            }],
        });
        expect(translated.at(-1)).to.deep.equal({ input_tokens: 7, output_tokens: 3 });
    });
});
