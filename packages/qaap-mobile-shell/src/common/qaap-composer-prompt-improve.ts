// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_AGENT_TASK_API_PATH } from './qaap-agent-task-client';
import type { QaapAgentModelSelection } from './qaap-agent-model-selection';
import { parseAgentLogForTranscript, resolveAgentLogDisplayText } from './qaap-cli-transcript-stream';

/** Logical agent id recorded against the language-model session. */
export const COMPOSER_PROMPT_IMPROVER_AGENT_ID = 'qaap-composer-prompt-improver';

/** Backend one-shot improve using the same VPS agent/model as the composer. */
export const QAAP_COMPOSER_IMPROVE_API_PATH = `${QAAP_AGENT_TASK_API_PATH}/improve-prompt`;

export interface QaapImproveComposerPromptRequestBody {
    readonly prompt: string;
    readonly agentId: string;
    readonly agentModel?: QaapAgentModelSelection;
    readonly cwd?: string;
}

export interface QaapImproveComposerPromptResponseBody {
    readonly improved: string;
}

/** Model aliases tried when no composer model is selected. */
export const COMPOSER_PROMPT_IMPROVER_FALLBACK_ALIASES = [
    'default/universal',
    'default/summarize',
    'default/code',
] as const;

export const COMPOSER_PROMPT_IMPROVE_TIMEOUT_MS = 45_000;

/** Build the Theia language-model id from a composer model selection. */
export function formatAgentModelLanguageModelId(model: QaapAgentModelSelection): string {
    const modelId = model.modelId.trim();
    if (!modelId) {
        return '';
    }
    const vendor = model.vendor?.trim();
    if (vendor && vendor !== 'unknown') {
        return `${vendor}/${modelId}`;
    }
    return modelId;
}

const IMPROVE_PROMPT_AGENT_STDOUT_FALLBACK_IDS = [
    'opencode',
    'qaiq',
    'codex',
    'claude',
    'antigravity',
] as const;

/** True when stdout still looks like NDJSON agent stream rather than plain reply text. */
export function looksLikeAgentNdjsonStream(text: string): boolean {
    const lines = text.trim().split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) {
        return false;
    }
    const jsonLines = lines.filter(line => line.startsWith('{') && line.includes('"type"'));
    return jsonLines.length > 0 && jsonLines.length >= Math.min(2, lines.length);
}

/**
 * Extract plain improved prompt text from agent CLI stdout (NDJSON, Codex JSON, plain text).
 */
export function extractImprovedComposerPromptFromAgentStdout(
    agentId: string | undefined,
    rawStdout: string,
): string {
    const trimmed = rawStdout.trim();
    if (!trimmed) {
        return '';
    }
    let extracted = resolveAgentLogDisplayText(agentId, trimmed).trim();
    if (!extracted || looksLikeAgentNdjsonStream(extracted)) {
        for (const tryAgentId of IMPROVE_PROMPT_AGENT_STDOUT_FALLBACK_IDS) {
            if (tryAgentId === agentId) {
                continue;
            }
            const candidate = parseAgentLogForTranscript(tryAgentId, trimmed).content.trim();
            if (candidate && !looksLikeAgentNdjsonStream(candidate)) {
                extracted = candidate;
                break;
            }
        }
    }
    return sanitizeImprovedComposerPrompt(extracted);
}

/** Strip fences and common preambles from model output. */
export function sanitizeImprovedComposerPrompt(raw: string): string {
    const withoutFences = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
    const lines = withoutFences.split('\n');
    let start = 0;
    while (start < lines.length) {
        const line = lines[start].trim();
        if (!line) {
            start += 1;
            continue;
        }
        if (/^(here(?:'s| is)|sure[,!]?|certainly[,!]?|of course[,!]?)/i.test(line)) {
            start += 1;
            continue;
        }
        break;
    }
    return lines.slice(start).join('\n').trim();
}

/** User message sent to the language model for prompt refinement. */
export function buildImproveComposerPromptRequest(originalPrompt: string): string {
    return [
        'Rewrite the user prompt below so it is clearer, more structured, and more effective for an AI coding agent.',
        '',
        'Rules:',
        '- Preserve the original goal and intent.',
        '- Improve clarity, structure, and precision.',
        '- Add relevant technical context when it helps.',
        '- Remove ambiguity.',
        '- Keep the same language as the original prompt.',
        '- Do not add explanations, comments, labels, or markdown fences.',
        '- Return only the optimized prompt text.',
        '',
        'Original prompt:',
        originalPrompt.trim(),
    ].join('\n');
}

export class ComposerPromptImproveCancelledError extends Error {
    constructor() {
        super('Composer prompt improve cancelled');
        this.name = 'ComposerPromptImproveCancelledError';
    }
}

export function isComposerPromptImproveCancelled(error: unknown): boolean {
    return error instanceof ComposerPromptImproveCancelledError;
}
