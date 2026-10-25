// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapQaiqModelOption } from './qaap-agent-task-client';

/**
 * Free OpenCode models (zero `cost.input` and `cost.output` in `opencode models --verbose`).
 * Generated from the CLI listing (10 models). Usable without signing in.
 */
export const OPENCODE_FREE_MODEL_OPTIONS: readonly QaapQaiqModelOption[] = [
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/beam-free', label: 'Beam Free' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/big-pickle', label: 'Big Pickle' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek V4.1 Flash Free' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/flint-40b-free', label: 'Flint 40B Free' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/glm-5.3-flash-free', label: 'GLM-5.3-Flash Free' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/mimo-v2.6-flash-free', label: 'MiMo-V2.6-Flash Free' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/minimax-m3.1-flash-free', label: 'MiniMax M3.1 Flash Free' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra Free' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/nemotron-3.5-lightning-free', label: 'Nemotron 3.5 Lightning Free' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/nemotron-3.5-super-vl-free', label: 'Nemotron 3.5 Super VL Free' },
];

/**
 * Paid OpenCode models (non-zero `cost.input` or `cost.output` in `opencode models --verbose`).
 * Generated from the CLI listing (73 models). Regenerate when the OpenCode catalog changes.
 * The picker shows these locked until the user is signed in; no network call happens when the picker opens.
 */
export const OPENCODE_PAID_MODEL_OPTIONS: readonly QaapQaiqModelOption[] = [
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-fable-5', label: 'Claude Fable 5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-fable-5-1', label: 'Claude Fable 5.1' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-opus-4-5', label: 'Claude Opus 4.5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-opus-4-6', label: 'Claude Opus 4.6' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-opus-4-7', label: 'Claude Opus 4.7' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-opus-4-8', label: 'Claude Opus 4.8' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-opus-5', label: 'Claude Opus 5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-opus-5-5', label: 'Claude Opus 5.5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-sonnet-5', label: 'Claude Sonnet 5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gemini-3-flash', label: 'Gemini 3 Flash' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gemini-3.1-pro', label: 'Gemini 3.1 Pro Preview' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gemini-4-argon', label: 'Gemini 4 Argon' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/glm-5', label: 'GLM-5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/glm-5.1', label: 'GLM-5.1' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/glm-5.2', label: 'GLM-5.2' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/glm-5.3', label: 'GLM-5.3' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/glm-5.3-flash', label: 'GLM-5.3-Flash' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5', label: 'GPT-5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5-codex', label: 'GPT-5 Codex' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5-nano', label: 'GPT-5 Nano' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.1', label: 'GPT-5.1' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.1-codex', label: 'GPT-5.1 Codex' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.2', label: 'GPT-5.2' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.4', label: 'GPT-5.4' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.4-nano', label: 'GPT-5.4 Nano' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.4-pro', label: 'GPT-5.4 Pro' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.5', label: 'GPT-5.5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.5-pro', label: 'GPT-5.5 Pro' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-6-astra', label: 'GPT-6 Astra' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-6-luna', label: 'GPT-6 Luna' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-6-sol', label: 'GPT-6 Sol' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/gpt-6.1-sol', label: 'GPT-6.1 Sol' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/grok-4.5', label: 'Grok 4.5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/grok-4.6', label: 'Grok 4.6' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/grok-4.7', label: 'Grok 4.7' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/grok-build-0.1', label: 'Grok Build 0.1' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/kimi-k2.5', label: 'Kimi K2.5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/kimi-k2.6', label: 'Kimi K2.6' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/kimi-k2.7-code', label: 'Kimi K2.7 Code' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/kimi-k3', label: 'Kimi K3' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/minimax-m2.5', label: 'MiniMax-M2.5' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/minimax-m2.7', label: 'MiniMax-M2.7' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/minimax-m3', label: 'MiniMax-M3' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/mistral-large-4', label: 'Mistral Large 4' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/muse-spark-1.2', label: 'Muse Spark 1.2' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/muse-spark-1.3', label: 'Muse Spark 1.3' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/muse-wonder-1.0', label: 'Muse Wonder' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/qwen3.5-plus', label: 'Qwen3.5 Plus' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/qwen3.6-plus', label: 'Qwen3.6 Plus' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/qwen3.8-flash', label: 'Qwen3.8 Flash' },
    { provider: 'openai', vendor: 'opencode', modelId: 'opencode/qwen3.8-max', label: 'Qwen3.8 Max' },
];

/**
 * OpenCode models that are free to use without a paid plan: ids ending in `-free`, plus `big-pickle`.
 * Any model id that is not recognized as free is treated as paid, so the lock fails closed.
 */
export function isOpenCodeFreeModelId(modelId: string): boolean {
    const bareId = modelId.trim().toLowerCase().replace(/^opencode\//, '');
    return bareId.endsWith('-free') || bareId === 'big-pickle';
}
