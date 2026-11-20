// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
/** A list marker pasted after sentence text (`asked. * **Canvas`, `done: 2. **Next`). */
const LIST_MARKER_AFTER_PROSE_RE = /([.!?:)\]]|\*\*)[ \t]+(?=(?:[-*+]|\d{1,2}\.)[ \t]+(?:\*\*|[A-ZÀ-Ý`]))/g;
const PASTED_LIST_MARKER_HINT_RE = /[.!?:)\]*][ \t]+(?:[-*+]|\d{1,2}\.)[ \t]/;
/** Single-backtick code spans; even indices of a split are prose, odd ones are code. */
const INLINE_CODE_SPLIT_RE = /(`[^`\n]*`)/;

/**
 * Put a list marker that a model emitted inline after sentence text on its own paragraph, so the
 * markdown parser sees a real list. Fenced code blocks, inline code spans and table rows are left
 * untouched; only the conservative shapes above are rewritten.
 */
export function normalizeChatMarkdownListBreaks(markdown: string): string {
    if (!markdown || !PASTED_LIST_MARKER_HINT_RE.test(markdown)) {
        return markdown;
    }
    let fence: string | undefined;
    return markdown.split('\n').map(line => {
        if (fence !== undefined) {
            const close = FENCE_CLOSE_RE.exec(line);
            if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
                fence = undefined;
            }
            return line;
        }
        const open = FENCE_OPEN_RE.exec(line);
        if (open) {
            fence = open[1];
            return line;
        }
        if (line.trimStart().startsWith('|')) {
            return line;
        }
        return line.split(INLINE_CODE_SPLIT_RE)
            .map((part, index) => index % 2 === 0 ? part.replace(LIST_MARKER_AFTER_PROSE_RE, '$1\n\n') : part)
            .join('');
    }).join('\n');
}
