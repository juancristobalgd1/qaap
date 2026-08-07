// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import type { QaapQaiqModelOption } from './qaap-agent-task-client';

/** Models exposed by OpenClaude's own built-in picker. This is not the QAIQ BYOK catalog. */
const OPENCLAUDE_NATIVE_MODELS: readonly QaapQaiqModelOption[] = [
    { vendor: 'anthropic', provider: 'anthropic', modelId: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { vendor: 'anthropic', provider: 'anthropic', modelId: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { vendor: 'anthropic', provider: 'anthropic', modelId: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { vendor: 'openai', provider: 'openai', modelId: 'gpt-4o', label: 'GPT-4o' },
    { vendor: 'openai', provider: 'openai', modelId: 'gpt-5.4', label: 'GPT-5.4' },
    { vendor: 'google', provider: 'gemini', modelId: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    { vendor: 'mistral', provider: 'mistral', modelId: 'mistral-large-latest', label: 'Mistral Large Latest' },
    { vendor: 'ollama', provider: 'ollama', modelId: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B' },
];

export function listOpenClaudeNativeModels(): QaapQaiqModelOption[] {
    return OPENCLAUDE_NATIVE_MODELS.map(model => ({ ...model }));
}
