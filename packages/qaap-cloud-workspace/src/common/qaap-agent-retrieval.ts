// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Common English/Spanish stopwords + agent-boilerplate verbs that make useless search terms. */
const RETRIEVAL_STOPWORDS = new Set<string>([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you', 'are', 'can', 'was',
    'will', 'would', 'should', 'could', 'have', 'has', 'not', 'but', 'all', 'any', 'add', 'fix',
    'make', 'use', 'get', 'set', 'run', 'new', 'now', 'when', 'where', 'what', 'how', 'why', 'please',
    'want', 'need', 'like', 'them', 'they', 'then', 'than', 'also', 'each', 'some', 'more', 'most',
    'file', 'files', 'code', 'change', 'changes', 'update', 'create', 'implement', 'function', 'error',
    'el', 'la', 'los', 'las', 'que', 'con', 'por', 'para', 'una', 'uno', 'del', 'este', 'esta', 'como',
    'haz', 'hacer', 'quiero', 'arregla', 'corrige', 'agrega', 'cambia', 'archivo', 'codigo', 'funcion',
]);

/** Max keywords used to build the retrieval query — keeps ripgrep fast and the query focused. */
export const RETRIEVAL_MAX_KEYWORDS = 8;

/**
 * Extract meaningful search terms from a user message for lightweight relevance retrieval. Splits on
 * non-identifier chars, drops stopwords / boilerplate verbs and very short tokens, dedupes
 * (case-insensitive), and keeps identifier-ish tokens (camelCase, snake_case, dotted names) which are
 * the strongest signals for locating code. Returns at most {@link RETRIEVAL_MAX_KEYWORDS} terms.
 */
export function extractRetrievalKeywords(text: string | undefined): string[] {
    if (!text) {
        return [];
    }
    const seen = new Set<string>();
    const keywords: string[] = [];
    // Tokens: identifier-ish runs, optionally dotted/dashed (e.g. foo.bar, my-widget, snake_case).
    for (const raw of text.match(/[A-Za-z_$][\w$.-]{2,}/g) ?? []) {
        const token = raw.replace(/^[.-]+|[.-]+$/g, '');
        const lower = token.toLowerCase();
        if (token.length < 3 || seen.has(lower) || RETRIEVAL_STOPWORDS.has(lower)) {
            continue;
        }
        seen.add(lower);
        keywords.push(token);
        if (keywords.length >= RETRIEVAL_MAX_KEYWORDS) {
            break;
        }
    }
    return keywords;
}

/** Format the relevant-file paths into the injected hint block, capped to a char budget. */
export function formatRelevantFilesHint(paths: readonly string[], maxChars: number): string | undefined {
    if (paths.length === 0) {
        return undefined;
    }
    const lines: string[] = [];
    let used = 0;
    for (const p of paths) {
        const line = `- ${p}`;
        if (used + line.length + 1 > maxChars) {
            break;
        }
        lines.push(line);
        used += line.length + 1;
    }
    return lines.length ? lines.join('\n') : undefined;
}
