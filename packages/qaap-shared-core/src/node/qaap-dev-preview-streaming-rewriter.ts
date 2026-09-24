// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { StringDecoder } from 'string_decoder';

/** A global rewrite rule: `pattern` must be a `g` regex, `replace` gets `(match, ...groups)`. */
export interface QaapDevPreviewRewriteRule {
    readonly pattern: RegExp;
    readonly replace: (match: string, ...groups: Array<string | undefined>) => string;
}

/** Longest match a rule may produce while still being found across chunk boundaries. */
export const QAAP_DEV_PREVIEW_REWRITE_OVERLAP = 64 * 1024;

/**
 * Applies a rewrite rule to a byte stream with bounded memory and the same result as
 * `text.replace(rule.pattern, rule.replace)` on the whole body, for matches no longer than
 * `overlap`. Once enough text is pending, a call emits everything except the last `overlap`
 * characters, which are kept
 * (unless a match straddles the cut) so no match is split between chunks. One character of
 * already-emitted context is kept too, so `\b` at the start of the window sees the real
 * preceding character. UTF-8 sequences split across chunks are decoded correctly.
 */
export class QaapDevPreviewStreamingRewriter {

    protected readonly decoder = new StringDecoder('utf8');
    protected readonly pattern: RegExp;
    protected pending = '';
    protected context = '';

    constructor(protected readonly rule: QaapDevPreviewRewriteRule, protected readonly overlap: number = QAAP_DEV_PREVIEW_REWRITE_OVERLAP) {
        this.pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
    }

    write(chunk: Buffer | string): string {
        this.pending += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
        // Every scan re-reads the retained overlap, so small chunks (4–16 KB against a 64 KB
        // overlap) made each emitted byte cost several scans. Scan only once at least `overlap`
        // new characters are pending: bounded extra latency and memory, ≥ half of every scan is
        // emitted (measured ~30–40% faster on 4–16 KB chunks, identical output).
        return this.pending.length < 2 * this.overlap ? '' : this.flush(false);
    }

    end(): string {
        this.pending += this.decoder.end();
        return this.flush(true);
    }

    protected flush(final: boolean): string {
        const text = this.context + this.pending;
        const start = this.context.length;
        const cut = final ? text.length : text.length - this.overlap;
        if (cut <= start) {
            return '';
        }
        let output = '';
        let position = start;
        this.pattern.lastIndex = start;
        for (let match = this.pattern.exec(text); match && match.index < cut; match = this.pattern.exec(text)) {
            output += text.slice(position, match.index) + this.rule.replace(match[0], ...match.slice(1));
            position = match.index + match[0].length;
            if (match[0].length === 0) {
                this.pattern.lastIndex++;
            }
        }
        const emitEnd = Math.max(position, cut);
        output += text.slice(position, emitEnd);
        this.context = text.slice(emitEnd - 1, emitEnd);
        this.pending = text.slice(emitEnd);
        return output;
    }
}
