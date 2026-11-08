// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Name fragments that read as acronyms or brands and keep their casing. */
const UPPERCASE_FRAGMENTS = new Set(['gpt', 'glm', 'llm', 'api', 'ai', 'ui']);

/**
 * Readable name for a model id until its catalog label is known: drops the provider path
 * (`openrouter/anthropic/claude-opus-4.6` → `claude-opus-4.6`), turns hyphens into spaces and
 * capitalises each word. `gpt-5.6-sol` reads `GPT 5.6 Sol`.
 */
export function humanizeModelSlug(modelId: string): string {
    const trimmed = modelId.trim();
    const name = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    if (!name) {
        return trimmed;
    }
    return name
        .split('-')
        .filter(word => word.length > 0)
        .map(word => UPPERCASE_FRAGMENTS.has(word.toLowerCase())
            ? word.toUpperCase()
            : word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
