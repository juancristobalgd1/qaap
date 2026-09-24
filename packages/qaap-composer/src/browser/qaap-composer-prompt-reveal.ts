// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ComposerPromptImproveCancelledError } from '../common/qaap-composer-prompt-improve';

export interface AnimateComposerPromptReplaceOptions {
    readonly durationMs?: number;
    readonly onProgress?: (value: string) => void;
    readonly signal?: AbortSignal;
}

function throwIfPromptReplaceAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw new ComposerPromptImproveCancelledError();
    }
}

const DEFAULT_DURATION_MS = 480;

/** Set textarea value, caret at end, and notify listeners (draft sync is via onProgress). */
export function finalizeComposerPromptReplace(
    input: HTMLTextAreaElement,
    value: string,
    onProgress?: (value: string) => void,
): void {
    input.value = value;
    onProgress?.(value);
    const end = value.length;
    input.setSelectionRange(end, end);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        window.requestAnimationFrame(() => resolve());
    });
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => {
        window.setTimeout(resolve, ms);
    });
}

/** Morph the textarea content from the current value to `nextText` with a soft fade + typing reveal. */
export async function animateComposerPromptReplace(
    input: HTMLTextAreaElement,
    nextText: string,
    options?: AnimateComposerPromptReplaceOptions,
): Promise<void> {
    const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
    const fadeMs = Math.round(durationMs * 0.35);
    const typeMs = Math.max(durationMs - fadeMs, 120);
    const scrollTop = input.scrollTop;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const signal = options?.signal;

    throwIfPromptReplaceAborted(signal);

    if (reducedMotion || nextText === input.value) {
        finalizeComposerPromptReplace(input, nextText, options?.onProgress);
        input.scrollTop = scrollTop;
        throwIfPromptReplaceAborted(signal);
        return;
    }

    input.classList.add('qaap-composer-prompt-morphing');
    try {
        await wait(fadeMs);
        throwIfPromptReplaceAborted(signal);

        const startedAt = performance.now();
        while (true) {
            const elapsed = performance.now() - startedAt;
            const ratio = Math.min(1, elapsed / typeMs);
            const targetLength = Math.max(0, Math.round(nextText.length * ratio));
            const partial = nextText.slice(0, targetLength);
            input.value = partial;
            options?.onProgress?.(partial);
            input.scrollTop = scrollTop;
            if (ratio >= 1) {
                break;
            }
            throwIfPromptReplaceAborted(signal);
            await nextFrame();
        }

        throwIfPromptReplaceAborted(signal);
        finalizeComposerPromptReplace(input, nextText, options?.onProgress);
        input.scrollTop = scrollTop;
    } finally {
        input.classList.remove('qaap-composer-prompt-morphing');
    }
}
