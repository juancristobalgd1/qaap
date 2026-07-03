// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Heuristic conversation-title derivation shared by the backend store (where titles are first
 * set) and any frontend fallback. Pure and side-effect free so it can be unit tested and reused
 * everywhere. The goal is a short, human-readable summary of the first user prompt that never ends
 * mid-word and carries no trailing ellipsis/punctuation.
 *
 * LLM upgrade seam: the qaap backend only shells out to agent CLIs and has no `LanguageModel`
 * access in `src/node/` (upstream's {@link ChatSessionNamingAgent} lives in the browser DI graph),
 * so an LLM-generated title is not wire-able from this code path in a few lines. When a backend
 * naming pathway exists, add an async `upgradeConversationTitle(conv)` that replaces the heuristic
 * title and propagates it through the existing `{ type: 'updated' }` summary event — the sidebar
 * already refreshes rows from those events, so no extra plumbing is needed.
 */

/** Target character length for a derived title. */
const TITLE_TARGET_LENGTH = 48;
/** Lower bound of the window in which a clause boundary is preferred over a plain word cut. */
const CLAUSE_MIN = 24;
/** Upper bound of the window in which a clause boundary is preferred over a plain word cut. */
const CLAUSE_MAX = 56;

/**
 * Leading imperative boilerplate stripped (case-insensitive) only when the remainder is still
 * meaningful (>= 3 words). Multi-word phrases must be listed so they are matched before their
 * single-word prefixes. English and Spanish equivalents are both covered.
 */
const LEADING_BOILERPLATE: readonly string[] = [
    'i want you to',
    'i need you to',
    'i would like you to',
    'could you please',
    'can you please',
    'could you',
    'can you',
    'help me to',
    'help me',
    'please',
    'now',
    'immediately',
    'run',
    'lets',
    "let's",
    // Spanish
    'por favor',
    'quiero que',
    'necesito que',
    'me gustaria que',
    'me gustaría que',
    'ayudame a',
    'ayúdame a',
    'ayudame',
    'ayúdame',
    'podrias',
    'podrías',
    'puedes',
    'ejecuta',
    'ejecutá',
];

/** Trailing filler words trimmed from a plain word-boundary cut so titles do not dangle. */
const TRAILING_STOPWORDS: ReadonlySet<string> = new Set([
    'and', 'or', 'to', 'the', 'a', 'an', 'with', 'for', 'of', 'in', 'on', 'at', 'by',
    'then', 'that', 'this', 'y', 'o', 'de', 'la', 'el', 'los', 'las', 'con', 'para',
]);

/** Clause connectors (surrounded by spaces) that make a good cut point. */
const CLAUSE_CONNECTORS: readonly string[] = [' and ', ' then '];

/**
 * Derive a short, readable conversation title from the first user message.
 * Returns an empty string when there is nothing meaningful to derive from — callers supply their
 * own localized fallback (e.g. 'New conversation').
 */
export function deriveConversationTitle(firstUserMessage: string): string {
    const cleaned = cleanPromptText(firstUserMessage);
    if (!cleaned) {
        return '';
    }
    const base = stripLeadingBoilerplate(cleaned);
    const clipped = clipToTitle(base);
    return capitalizeFirst(clipped);
}

/** Strip markdown noise and collapse whitespace to a single readable line. */
function cleanPromptText(input: string): string {
    if (!input) {
        return '';
    }
    let text = input;
    // Fenced code blocks (``` ... ``` or ~~~ ... ~~~) — drop entirely.
    text = text.replace(/```[\s\S]*?```/g, ' ');
    text = text.replace(/~~~[\s\S]*?~~~/g, ' ');
    // Images ![alt](url) -> alt, then links [text](url) -> text.
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // Inline code `code` -> code.
    text = text.replace(/`([^`]*)`/g, '$1');
    // Leading block markers per line: headings, blockquotes, list bullets, ordered markers.
    text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    text = text.replace(/^\s{0,3}>\s?/gm, '');
    text = text.replace(/^\s*[-*+]\s+/gm, '');
    text = text.replace(/^\s*\d+[.)]\s+/gm, '');
    // Emphasis / strikethrough markers.
    text = text.replace(/(\*\*|__|~~|\*|_)/g, '');
    // Collapse all whitespace.
    return text.replace(/\s+/g, ' ').trim();
}

/** Number of whitespace-separated words. */
function countWords(text: string): number {
    return text.split(' ').filter(Boolean).length;
}

/**
 * Iteratively remove leading imperative phrases, but only while the remainder keeps at least three
 * words so single-clause prompts (e.g. 'Run ls -la') are left intact.
 */
function stripLeadingBoilerplate(text: string): string {
    let current = text;
    let changed = true;
    while (changed) {
        changed = false;
        const lower = current.toLowerCase();
        for (const phrase of LEADING_BOILERPLATE) {
            if (!lower.startsWith(phrase)) {
                continue;
            }
            // Require a word boundary immediately after the phrase.
            const after = current.charAt(phrase.length);
            if (after && /\w/.test(after)) {
                continue;
            }
            const candidate = current.slice(phrase.length).replace(/^[\s,:;.!?¡¿-]+/, '');
            if (countWords(candidate) < 3) {
                continue;
            }
            current = candidate;
            changed = true;
            break;
        }
    }
    return current;
}

/** Cut to ~{@link TITLE_TARGET_LENGTH} chars, preferring a clause boundary in the clause window. */
function clipToTitle(text: string): string {
    if (text.length <= TITLE_TARGET_LENGTH) {
        return trimTitleEnd(text);
    }
    const clausePos = findClauseBoundary(text);
    if (clausePos !== undefined) {
        return trimTitleEnd(text.slice(0, clausePos));
    }
    return trimTitleEnd(dropTrailingStopword(cutAtWordBoundary(text)));
}

/**
 * Find the last clause-boundary cut position that lands within [{@link CLAUSE_MIN}, {@link CLAUSE_MAX}].
 * Boundaries are commas, periods, and the connectors in {@link CLAUSE_CONNECTORS}. The cut position
 * is the index where the clause text ends (exclusive of the punctuation/connector).
 */
function findClauseBoundary(text: string): number | undefined {
    let best: number | undefined;
    const consider = (pos: number): void => {
        if (pos >= CLAUSE_MIN && pos <= CLAUSE_MAX && (best === undefined || pos > best)) {
            best = pos;
        }
    };
    for (let i = 0; i < text.length; i++) {
        const ch = text.charAt(i);
        if (ch === ',' || ch === '.' || ch === ';' || ch === '!' || ch === '?') {
            consider(i);
        }
    }
    for (const connector of CLAUSE_CONNECTORS) {
        let from = 0;
        for (;;) {
            const idx = text.indexOf(connector, from);
            if (idx < 0) {
                break;
            }
            consider(idx);
            from = idx + 1;
        }
    }
    return best;
}

/** Cut at the last space at or before the target length (hard cut only for a single giant token). */
function cutAtWordBoundary(text: string): string {
    if (text.length <= TITLE_TARGET_LENGTH) {
        return text;
    }
    const window = text.slice(0, TITLE_TARGET_LENGTH + 1);
    const lastSpace = window.lastIndexOf(' ');
    if (lastSpace > 0) {
        return text.slice(0, lastSpace);
    }
    // Single word longer than the target — no safe boundary; hard cut as a last resort.
    return text.slice(0, TITLE_TARGET_LENGTH);
}

/** Drop a single trailing connective/preposition so a word cut does not dangle. */
function dropTrailingStopword(text: string): string {
    const words = text.split(' ').filter(Boolean);
    while (words.length > 1 && TRAILING_STOPWORDS.has(words[words.length - 1].toLowerCase())) {
        words.pop();
    }
    return words.join(' ');
}

/** Remove trailing whitespace, punctuation and ellipsis. */
function trimTitleEnd(text: string): string {
    return text.replace(/[\s.,;:!?¡¿…–—-]+$/u, '').trim();
}

/** Capitalize the first alphabetic character without touching the rest. */
function capitalizeFirst(text: string): string {
    if (!text) {
        return text;
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
}
