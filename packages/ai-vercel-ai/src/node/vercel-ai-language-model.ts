// *****************************************************************************
// Copyright (C) 2025 EclipseSource GmbH.
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

import { LanguageModelV4 } from '@ai-sdk/provider';
import {
    LanguageModel,
    LanguageModelMessage,
    LanguageModelParsedResponse,
    LanguageModelRequest,
    LanguageModelResponse,
    LanguageModelStatus,
    LanguageModelStreamResponse,
    LanguageModelStreamResponsePart,
    LanguageModelTextResponse,
    ToolCall,
    UserRequest,
} from '@theia/ai-core';
import { CancellationToken, Disposable, ILogger } from '@theia/core';
import {
    generateObject,
    generateText,
    jsonSchema,
    ModelMessage,
    stepCountIs,
    streamText,
    TextStreamPart,
    tool,
    ToolExecutionOptions,
    ToolSet
} from 'ai';
import { VercelAiLanguageModelFactory, VercelAiProviderConfig } from './vercel-ai-language-model-factory';

interface VercelCancellationToken extends Disposable {
    signal: AbortSignal;
    cancellationToken: CancellationToken;
    isCancellationRequested: boolean;
}

interface VercelAiStream extends AsyncIterable<TextStreamPart<ToolSet>> {
    cancel: () => void;
}

interface StreamContext {
    logger: ILogger;
    cancellationToken?: VercelCancellationToken;
}

export class VercelAiStreamTransformer {
    private toolCallsMap = new Map<string, ToolCall>();

    constructor(
        protected readonly fullStream: VercelAiStream,
        protected readonly context: StreamContext
    ) { }

    async *transform(): AsyncGenerator<LanguageModelStreamResponsePart> {
        this.toolCallsMap.clear();
        try {
            for await (const part of this.fullStream) {
                this.context.logger.trace('Received stream part:', part);
                if (this.context.cancellationToken?.isCancellationRequested) {
                    this.context.logger.debug('Cancellation requested, stopping stream');
                    this.fullStream.cancel();
                    break;
                }

                let toolCallUpdated = false;

                switch (part.type) {
                    case 'text-delta':
                        if (part.text) {
                            yield { content: part.text };
                        }
                        break;

                    case 'tool-call':
                        if (part.toolCallId && part.toolName) {
                            const args = typeof part.input === 'string' ? part.input : JSON.stringify(part.input);
                            toolCallUpdated = this.updateToolCall(part.toolCallId, part.toolName, args);
                        }
                        break;

                    case 'tool-input-start':
                        if (part.id && part.toolName) {
                            toolCallUpdated = this.updateToolCall(part.id, part.toolName);
                        }
                        break;

                    case 'tool-input-delta':
                        if (part.id && part.delta) {
                            toolCallUpdated = this.appendToToolCallArgs(part.id, part.delta);
                        }
                        break;

                    case 'finish-step': {
                        const { usage } = part;
                        if (typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number') {
                            yield { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens };
                        }
                        break;
                    }

                    default: {
                        if (part.type === 'tool-result') {
                            toolCallUpdated = this.processToolResult(part);
                        }
                        break;
                    }
                }

                if (toolCallUpdated && this.toolCallsMap.size > 0) {
                    yield { tool_calls: Array.from(this.toolCallsMap.values()) };
                }
            }
        } catch (error) {
            this.context.logger.error('Error in AI SDK stream:', error);
        }
    }

    private updateToolCall(id: string, name: string, args?: string): boolean {
        const toolCall: ToolCall = {
            id,
            function: { name, arguments: args ? args : '' },
            finished: false
        };
        this.toolCallsMap.set(id, toolCall);
        return true;
    }

    private appendToToolCallArgs(id: string, argsTextDelta: string): boolean {
        const existingCall = this.toolCallsMap.get(id);
        if (existingCall?.function) {
            existingCall.function.arguments = (existingCall.function.arguments || '') + argsTextDelta;
            return true;
        }
        return false;
    }

    private processToolResult(part: { toolCallId: string; output: unknown }): boolean {
        if (!part.toolCallId) {
            return false;
        }

        const completedCall = this.toolCallsMap.get(part.toolCallId);
        if (!completedCall) {
            return false;
        }

        if (part.output === undefined || typeof part.output === 'string') {
            completedCall.result = part.output;
        } else if (typeof part.output === 'object' && part.output) {
            completedCall.result = part.output;
        } else {
            completedCall.result = JSON.stringify(part.output);
        }
        completedCall.finished = true;
        return true;
    }

}

export class VercelAiModel implements LanguageModel {

    constructor(
        public readonly id: string,
        public model: string,
        public status: LanguageModelStatus,
        public enableStreaming: boolean,
        public supportsStructuredOutput: boolean,
        public url: string | undefined,
        protected readonly logger: ILogger,
        protected readonly languageModelFactory: VercelAiLanguageModelFactory,
        protected providerConfig: () => VercelAiProviderConfig,
        public maxRetries: number = 3,
    ) { }

    protected getSettings(request: LanguageModelRequest): Record<string, unknown> {
        return request.settings ?? {};
    }

    async request(request: UserRequest, cancellationToken?: CancellationToken): Promise<LanguageModelResponse> {
        const settings = this.getSettings(request);
        const model = this.languageModelFactory.createLanguageModel(
            {
                id: this.id,
                model: this.model,
                url: this.url,
                apiKey: true, // We'll use the provider's API key
                enableStreaming: this.enableStreaming,
                supportsStructuredOutput: this.supportsStructuredOutput,
                maxRetries: this.maxRetries
            },
            this.providerConfig()
        );
        const cancel = this.createCancellationToken(cancellationToken);

        try {
            if (request.response_format?.type === 'json_schema' && this.supportsStructuredOutput) {
                return this.handleStructuredOutputRequest(model, request, cancel);
            }
            if (!this.enableStreaming || (typeof settings.stream === 'boolean' && !settings.stream)) {
                return this.handleNonStreamingRequest(model, request, cancel);
            }
            return this.handleStreamingRequest(model, request, cancel);
        } catch (error) {
            this.logger.error('Error in Vercel AI model request:', error);
            throw error;
        } finally {
            cancel.dispose();
        }
    }

    protected createCancellationToken(cancellationToken?: CancellationToken): VercelCancellationToken {
        const abortController = new AbortController();
        const abortSignal = abortController.signal;
        if (cancellationToken?.isCancellationRequested) {
            abortController.abort();
        }
        const cancellationListener = cancellationToken ?
            cancellationToken.onCancellationRequested(() => {
                abortController.abort();
            }) : undefined;
        return {
            signal: abortSignal,
            cancellationToken: cancellationToken ?? CancellationToken.None,
            get isCancellationRequested(): boolean {
                return cancellationToken?.isCancellationRequested ?? abortSignal.aborted;
            },
            dispose: () => cancellationListener?.dispose()
        };
    }

    protected async handleNonStreamingRequest(
        model: LanguageModelV4,
        request: UserRequest,
        cancellationToken?: VercelCancellationToken
    ): Promise<LanguageModelTextResponse> {
        const settings = this.getSettings(request);
        const messages = this.processMessages(request.messages);
        const tools = this.createTools(request);
        const abortSignal = cancellationToken?.signal;

        const response = await generateText({
            model,
            messages,
            tools,
            toolChoice: 'auto',
            abortSignal,
            ...settings
        });

        const result: LanguageModelTextResponse = { text: response.text };
        if (typeof response.usage.inputTokens === 'number' && typeof response.usage.outputTokens === 'number') {
            result.usage = {
                input_tokens: response.usage.inputTokens,
                output_tokens: response.usage.outputTokens,
            };
        }
        return result;
    }

    protected createTools(request: UserRequest): ToolSet | undefined {
        if (!request.tools) {
            return undefined;
        }

        const toolSet: ToolSet = {};
        for (const toolRequest of request.tools) {
            toolSet[toolRequest.name] = tool<object, string | object, Record<string, unknown>>({
                description: toolRequest.description,
                inputSchema: jsonSchema<object>(toolRequest.parameters),
                execute: async (args: object, options: ToolExecutionOptions<Record<string, unknown>>) => {
                    try {
                        const result = await toolRequest.handler(JSON.stringify(args), options);
                        return JSON.stringify(result);
                    } catch (error) {
                        this.logger.error(`Error executing tool (${toolRequest.name}):`, error);
                        return { status: 'error', error: 'Tool execution failed', details: error };
                    }
                }
            });
        }
        return toolSet;
    }

    protected async handleStructuredOutputRequest(
        model: LanguageModelV4,
        request: UserRequest,
        cancellationToken?: VercelCancellationToken
    ): Promise<LanguageModelParsedResponse | LanguageModelStreamResponse> {
        if (request.response_format?.type !== 'json_schema' || !request.response_format.json_schema.schema) {
            throw Error('Invalid response format for structured output request');
        }

        const schema = jsonSchema(request.response_format.json_schema.schema);
        if (!schema) {
            throw new Error('Schema extraction failed.');
        }

        const settings = this.getSettings(request);
        const messages = this.processMessages(request.messages);
        const abortSignal = cancellationToken?.signal;

        const response = await generateObject({
            model,
            output: 'object',
            messages,
            schema,
            abortSignal,
            ...settings
        });

        const result: LanguageModelParsedResponse = {
            content: JSON.stringify(response.object),
            parsed: response.object
        };
        if (typeof response.usage.inputTokens === 'number' && typeof response.usage.outputTokens === 'number') {
            result.usage = {
                input_tokens: response.usage.inputTokens,
                output_tokens: response.usage.outputTokens,
            };
        }
        return result;
    }

    protected async handleStreamingRequest(
        model: LanguageModelV4,
        request: UserRequest,
        cancellationToken?: VercelCancellationToken
    ): Promise<LanguageModelStreamResponse> {
        const settings = this.getSettings(request);
        const messages = this.processMessages(request.messages);
        const tools = this.createTools(request);
        const abortSignal = cancellationToken?.signal;

        const { fullStream } = streamText({
            model,
            messages,
            tools,
            toolChoice: 'auto',
            stopWhen: stepCountIs(100),
            maxRetries: this.maxRetries,
            abortSignal,
            ...settings
        });

        const transformer = new VercelAiStreamTransformer(
            fullStream, { cancellationToken, logger: this.logger }
        );

        return {
            stream: transformer.transform()
        };
    }

    protected processMessages(messages: LanguageModelMessage[]): Array<ModelMessage> {
        const converted = messages.map(message => {
            const content = LanguageModelMessage.isTextMessage(message) ? message.text : '';
            let role: 'user' | 'assistant' | 'system';
            switch (message.actor) {
                case 'user':
                    role = 'user';
                    break;
                case 'ai':
                    role = 'assistant';
                    break;
                case 'system':
                    role = 'system';
                    break;
                default:
                    role = 'user';
            }
            return {
                role,
                content,
            };
        });
        return this.mergeConsecutiveAssistantMessages(converted);
    }

    protected mergeConsecutiveAssistantMessages(messages: Array<ModelMessage>): Array<ModelMessage> {
        const result: Array<ModelMessage> = [];
        for (const message of messages) {
            const previous = result[result.length - 1];
            if (previous?.role === 'assistant' && message.role === 'assistant') {
                const merged: ModelMessage = { ...previous, role: 'assistant' };

                const previousContent = typeof previous.content === 'string' ? previous.content : undefined;
                const nextContent = typeof message.content === 'string' ? message.content : undefined;
                if (previousContent && nextContent) {
                    merged.content = `${previousContent}\n${nextContent}`;
                } else if (nextContent) {
                    merged.content = nextContent;
                } else if (previousContent) {
                    merged.content = previousContent;
                }

                result[result.length - 1] = merged;
            } else {
                result.push(message);
            }
        }
        return result;
    }
}
