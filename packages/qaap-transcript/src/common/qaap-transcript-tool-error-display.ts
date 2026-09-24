// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface TranscriptToolErrorDisplay {
    readonly code: string;
    readonly message: string;
    readonly body: string;
    readonly preview: string;
    /** Actionable hint without the typed error prefix — used for "Copy fix hint". */
    readonly fixHint: string;
}

/** Strip agent/tool host wrappers such as `<tool_use_error>`. */
export function normalizeTranscriptToolErrorRaw(result: string | undefined): string {
    return (result ?? '')
        .replace(/<\/?tool_use_error>/gi, '')
        .trim();
}

export function resolveTranscriptToolErrorDisplay(
    result: string | undefined,
    maxPreview = 72,
): TranscriptToolErrorDisplay | undefined {
    const body = normalizeTranscriptToolErrorRaw(result);
    if (!body) {
        return undefined;
    }
    const typed = body.match(/^([A-Z][A-Za-z0-9]+Error):\s*([\s\S]+)$/);
    if (typed) {
        const code = typed[1]!;
        const message = typed[2]!.trim();
        const preview = excerptTranscriptToolErrorLine(message, maxPreview);
        return { code, message, body, preview, fixHint: message };
    }
    const preview = excerptTranscriptToolErrorLine(body, maxPreview);
    return {
        code: 'Tool error',
        message: body,
        body,
        preview,
        fixHint: body,
    };
}

export function excerptTranscriptToolErrorLine(text: string, maxLength = 96): string {
    const line = text
        .split('\n')
        .map(entry => entry.replace(/\s+/g, ' ').trim())
        .find(entry => entry.length > 0) ?? text.replace(/\s+/g, ' ').trim();
    if (!line) {
        return '';
    }
    if (line.length <= maxLength) {
        return line;
    }
    return `${line.slice(0, maxLength - 1).trimEnd()}…`;
}
