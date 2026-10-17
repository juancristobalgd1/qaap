// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const REDACTED = '[REDACTED]';

/**
 * Credential shapes scrubbed from text that leaves Qaap (task pull request bodies and commit
 * messages). The `key = value` / `Bearer` / `--token` rules are the ones the audit log uses
 * (`redactQaapCommand` in `qaap-observability.ts`); the rest are well-known token formats. Unlike that
 * helper this one keeps whitespace and line breaks, so Markdown survives.
 */
const SECRET_PATTERNS: readonly [RegExp, string][] = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
    [/(\bauthorization\b[ \t]*[:=][ \t]*Bearer[ \t]+)[^\s'"`]+/gi, `$1${REDACTED}`],
    [/(\b(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|secret)\b[ \t]*[:=][ \t]*)("[^"\n]*"|'[^'\n]*'|[^\s]+)/gi, `$1${REDACTED}`],
    [/(\bBearer[ \t]+)[^\s'"`]+/gi, `$1${REDACTED}`],
    [/(--(?:token|password|secret|api[-_]key)(?:=|[ \t]+))[^\s]+/gi, `$1${REDACTED}`],
    [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, REDACTED],
    [/\bqaap_pat_[A-Za-z0-9_-]{16,}\b/g, REDACTED],
    [/\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{20,}\b/g, REDACTED],
    [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
    [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
    [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
    [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
];

/** Replaces obvious secrets (tokens, keys, passwords, credentials in URLs) with `[REDACTED]`. */
export function redactQaapSecrets(text: string): string {
    let result = text;
    for (const [pattern, replacement] of SECRET_PATTERNS) {
        result = result.replace(pattern, replacement);
    }
    return result;
}
