// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type QaapAgentTaskEstimateSize = 'small' | 'medium' | 'large';

export interface QaapAgentTaskEstimate {
    readonly size: QaapAgentTaskEstimateSize;
    readonly minTokens: number;
    readonly maxTokens: number;
    /** True when the composer should surface the estimate before submit. */
    readonly visible: boolean;
}

const MULTI_STEP_LINE_REGEX = /^\s*(?:[-*]|\d+[.)])\s+/gm;
const BROAD_SCOPE_REGEX = /\b(?:entire|whole|all (?:files|pages|components)|across the (?:app|repo)|migrat|redesign|architecture|end[- ]to[- ]end|full stack|desde cero|toda la|todo el|arquitectura|migrar|rediseñ)/i;
const IMPLEMENTATION_REGEX = /\b(?:implement|build|create|refactor|fix|audit|integrat|implementa|crea|construye|refactoriza|corrige|audita|integra)/i;
const UI_VALIDATION_REGEX = /\b(?:ui|ux|frontend|page|screen|component|responsive|accessib|interfaz|pantalla|componente|visual)/i;

/**
 * Conservative preflight estimate from the user prompt. This is a planning range, not billing:
 * actual provider usage depends on repository context, tool output, retries, and model behavior.
 */
export function estimateQaapAgentTask(prompt: string): QaapAgentTaskEstimate {
    const text = prompt.trim();
    let score = 0;
    if (text.length >= 180) { score++; }
    if (text.length >= 600) { score += 2; }
    if (IMPLEMENTATION_REGEX.test(text)) { score++; }
    if (BROAD_SCOPE_REGEX.test(text)) { score += 2; }
    if (UI_VALIDATION_REGEX.test(text)) { score++; }
    const listedSteps = text.match(MULTI_STEP_LINE_REGEX)?.length ?? 0;
    if (listedSteps >= 3) { score += 2; }
    if (listedSteps >= 6) { score++; }

    if (score >= 5) {
        return { size: 'large', minTokens: 20_000, maxTokens: 60_000, visible: true };
    }
    if (score >= 2) {
        return { size: 'medium', minTokens: 8_000, maxTokens: 24_000, visible: true };
    }
    return { size: 'small', minTokens: 2_000, maxTokens: 8_000, visible: false };
}

function compactTokens(tokens: number): string {
    return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

export function formatQaapAgentTaskEstimate(estimate: QaapAgentTaskEstimate): string {
    return `~${compactTokens(estimate.minTokens)}–${compactTokens(estimate.maxTokens)} tokens`;
}
