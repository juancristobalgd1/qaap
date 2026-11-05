// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapSqliteStore } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';

/**
 * Characters read per step from the legacy aggregate. A two-byte V8 string this long takes 128 MiB,
 * so one chunk stays far below both V8's string limit (~536 M characters) and the heap limit.
 */
export const QAAP_LEGACY_AGGREGATE_CHUNK_CHARS = 64 * 1024 * 1024;

const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const SPACE = 0x20;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * Splits the text of one JSON array into the text of its top-level elements, fed in arbitrary
 * pieces. It checks the nesting and string structure only: each element still has to be parsed.
 * Throws as soon as the text cannot be an array, and from {@link end} when it stops early.
 */
export class QaapJsonArrayElementSplitter {

    protected state: 'before-array' | 'before-element' | 'in-element' | 'after-element' | 'done' = 'before-array';
    protected depth = 0;
    protected inString = false;
    protected escaped = false;
    protected parts: string[] = [];

    /**
     * Feeds the next piece of the array text.
     *
     * @param chunk the next characters.
     * @returns the raw text of each element completed by this piece.
     */
    push(chunk: string): string[] {
        const elements: string[] = [];
        let elementStart = this.state === 'in-element' ? 0 : -1;
        for (let index = 0; index < chunk.length; index++) {
            const code = chunk.charCodeAt(index);
            if (this.state === 'in-element') {
                if (this.inString) {
                    if (this.escaped) {
                        this.escaped = false;
                    } else if (code === BACKSLASH) {
                        this.escaped = true;
                    } else if (code === QUOTE) {
                        this.inString = false;
                    }
                } else if (code === QUOTE) {
                    this.inString = true;
                } else if (code === OPEN_BRACE || code === OPEN_BRACKET) {
                    this.depth++;
                } else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
                    this.depth--;
                    if (this.depth < 0) {
                        throw new Error('Unbalanced JSON array element.');
                    }
                    if (this.depth === 0) {
                        this.parts.push(chunk.substring(elementStart, index + 1));
                        elements.push(this.parts.join(''));
                        this.parts = [];
                        this.state = 'after-element';
                    }
                }
                continue;
            }
            if (code === SPACE || code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) {
                continue;
            }
            if (this.state === 'before-array') {
                if (code !== OPEN_BRACKET) {
                    throw new Error('Expected a JSON array.');
                }
                this.state = 'before-element';
            } else if (this.state === 'before-element') {
                if (code === CLOSE_BRACKET && elements.length === 0 && !this.sawElement) {
                    this.state = 'done';
                } else if (code === OPEN_BRACE) {
                    this.state = 'in-element';
                    this.sawElement = true;
                    this.depth = 1;
                    elementStart = index;
                } else {
                    throw new Error('Expected a JSON object as an array element.');
                }
            } else if (this.state === 'after-element') {
                if (code === COMMA) {
                    this.state = 'before-element';
                } else if (code === CLOSE_BRACKET) {
                    this.state = 'done';
                } else {
                    throw new Error('Expected a comma or the end of the JSON array.');
                }
            } else {
                throw new Error('Unexpected text after the JSON array.');
            }
        }
        if (this.state === 'in-element') {
            this.parts.push(elementStart <= 0 ? chunk : chunk.substring(elementStart));
        }
        return elements;
    }

    /** Checks that the fed text was one complete array. */
    end(): void {
        if (this.state !== 'done') {
            throw new Error('The JSON array ended early.');
        }
    }

    protected sawElement = false;
}

/**
 * Walks the legacy aggregate row element by element, in chunks, so it works for a row close to or
 * above V8's string limit, which `QaapSqliteStore.get` cannot read at all.
 *
 * @param legacy the store of the legacy namespace.
 * @param key the key of the aggregate row.
 * @param onElement called with the raw JSON text of each element.
 * @param chunkChars characters per read.
 * @returns the number of elements; 0 when the key does not exist.
 */
export function forEachLegacyAggregateElement(
    legacy: QaapSqliteStore,
    key: string,
    onElement: (raw: string) => void,
    chunkChars: number = QAAP_LEGACY_AGGREGATE_CHUNK_CHARS,
): number {
    const splitter = new QaapJsonArrayElementSplitter();
    let count = 0;
    for (let start = 0; ; start += chunkChars) {
        const chunk = legacy.readValueChunk(key, start, chunkChars);
        if (chunk === undefined) {
            return 0;
        }
        if (chunk.length === 0) {
            break;
        }
        for (const element of splitter.push(chunk)) {
            count++;
            onElement(element);
        }
        if (chunk.length < chunkChars) {
            break;
        }
    }
    splitter.end();
    return count;
}
