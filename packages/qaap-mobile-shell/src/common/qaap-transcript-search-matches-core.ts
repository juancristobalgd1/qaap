// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface TranscriptSearchMatch {
    readonly file: string;
    readonly line: number;
    readonly snippet: string;
}

const SEARCH_MATCH_LINE_PATTERN = /^(.+?):(\d+)[:|→]\s*(.*)$/;
const SEARCH_MATCH_LINE_ONLY_PATTERN = /^(\d+)[:|→]\s*(.*)$/;
const SEARCH_FILE_LINE_PATTERN = /^[^\s].+\.[A-Za-z0-9]{1,8}$/;
const SEARCH_HEADER_PATTERN = /^Found \d+ matching lines?$/i;

function compactSearchSnippet(text: string, maxLength = 88): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) {
        return '';
    }
    return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trimEnd()}…` : clean;
}

function compactSearchFilePath(path: string): string {
    const clean = path.replace(/\\/g, '/').replace(/^\.?\//, '').trim();
    const parts = clean.split('/').filter(Boolean);
    return parts.length > 3 ? parts.slice(-3).join('/') : clean;
}

function pushSearchMatch(
    matches: TranscriptSearchMatch[],
    file: string,
    line: number,
    snippet: string,
): void {
    const trimmedSnippet = compactSearchSnippet(snippet);
    if (!file.trim() || !Number.isInteger(line) || line <= 0) {
        return;
    }
    matches.push({
        file: compactSearchFilePath(file),
        line,
        snippet: trimmedSnippet || '(match)',
    });
}

/**
 * Parses grep/glob/search tool stdout into compact file + line + snippet rows.
 * Returns undefined when the payload does not look like workspace search output.
 */
export function parseTranscriptSearchMatches(raw: string | undefined): TranscriptSearchMatch[] | undefined {
    const text = raw?.trim();
    if (!text || /^ok$/i.test(text)) {
        return undefined;
    }
    if (text.startsWith('--- ') || text.startsWith('+++ ') || text.includes('@@')) {
        return undefined;
    }
    const matches: TranscriptSearchMatch[] = [];
    let pendingFile: string | undefined;
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trimEnd();
        const trimmed = line.trim();
        if (!trimmed || trimmed === '--' || SEARCH_HEADER_PATTERN.test(trimmed)) {
            continue;
        }
        const inline = SEARCH_MATCH_LINE_PATTERN.exec(trimmed);
        if (inline) {
            pushSearchMatch(matches, inline[1], Number(inline[2]), inline[3]);
            pendingFile = undefined;
            continue;
        }
        if (SEARCH_FILE_LINE_PATTERN.test(trimmed) && !trimmed.includes(':')) {
            pendingFile = trimmed;
            continue;
        }
        if (pendingFile) {
            const lineOnly = SEARCH_MATCH_LINE_ONLY_PATTERN.exec(trimmed);
            if (lineOnly) {
                pushSearchMatch(matches, pendingFile, Number(lineOnly[1]), lineOnly[2]);
                continue;
            }
        }
        pendingFile = undefined;
    }
    return matches.length > 0 ? matches : undefined;
}

export function looksLikeTranscriptSearchMatchResult(raw: string | undefined): boolean {
    return !!parseTranscriptSearchMatches(raw)?.length;
}
