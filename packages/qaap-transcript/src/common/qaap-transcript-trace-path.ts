// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

function normalizeTranscriptTracePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function truncateTranscriptTraceText(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/** Format a workspace path for transcript rows: keep basename emphasis, compact middle dirs. */
export function formatTranscriptTraceMonoPath(path: string, maxChars = 42): string {
    const normalized = normalizeTranscriptTracePath(path);
    if (!normalized) {
        return '';
    }
    if (normalized.length <= maxChars) {
        return normalized;
    }
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length <= 1) {
        return truncateTranscriptTraceText(normalized, maxChars);
    }
    const basename = parts[parts.length - 1]!;
    const firstDir = parts[0]!;
    const leadingPattern = `${firstDir}/…/${basename}`;
    if (leadingPattern.length <= maxChars) {
        return leadingPattern;
    }
    for (let dirSegments = 2; dirSegments >= 1; dirSegments -= 1) {
        if (parts.length <= dirSegments) {
            continue;
        }
        const tailParts = parts.slice(-(dirSegments + 1));
        const tailPattern = `…/${tailParts.join('/')}`;
        if (tailPattern.length <= maxChars) {
            return tailPattern;
        }
    }
    const tailKeep = Math.max(basename.length + 1, maxChars - 1);
    return `…${normalized.slice(-tailKeep)}`;
}

/** Truncate a shell command for mono transcript detail rows. */
export function formatTranscriptTraceCommandDetail(command: string, maxChars = 56): string {
    const collapsed = command.replace(/\s+/g, ' ').trim();
    if (!collapsed) {
        return '';
    }
    return truncateTranscriptTraceText(collapsed, maxChars);
}
