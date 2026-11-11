// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const NODE_RUNTIME_WARNING = /^\(node:\d+\) |^\(Use `node --trace-/;

/**
 * What is left of a structured (NDJSON) agent log once its JSON records and Node runtime warnings
 * are removed: the plain lines a CLI printed around its event stream. Used when a turn produced no
 * reply text (a provider error, an aborted turn): showing the whole log there put the raw event
 * stream, system prompt included, in the transcript as if it were the answer.
 */
export function structuredLogResidueText(log: string): string {
    const kept: string[] = [];
    for (const line of log.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || NODE_RUNTIME_WARNING.test(trimmed) || isJsonRecordLine(trimmed)) {
            continue;
        }
        kept.push(line.trimEnd());
    }
    return kept.join('\n').trim();
}

function isJsonRecordLine(line: string): boolean {
    if (!line.startsWith('{')) {
        return false;
    }
    try {
        const parsed: unknown = JSON.parse(line);
        return typeof parsed === 'object' && parsed !== null;
    } catch {
        // A record cut mid-line (the stream was interrupted) is still event data, not reply text.
        return /^\{\s*"[A-Za-z_]+"\s*:/.test(line);
    }
}
