// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface QaapJsonPointerResult {
    readonly found: boolean;
    readonly value?: unknown;
}

export interface QaapJsonPointerReplacementResult extends QaapJsonPointerResult {
    readonly value?: unknown;
}

const UNSAFE_POINTER_TOKENS = new Set(['__proto__', 'constructor', 'prototype']);

function decodePointerTokens(pointer: string): string[] | undefined {
    if (!isValidQaapJsonPointer(pointer)) {
        return undefined;
    }
    return pointer === ''
        ? []
        : pointer.slice(1).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function isValidQaapJsonPointer(pointer: unknown, maxLength = 1_024): pointer is string {
    return typeof pointer === 'string' && pointer.length <= maxLength
        && (pointer === '' || (pointer.startsWith('/') && !/~(?:[^01]|$)/.test(pointer)));
}

/** Resolve an RFC 6901 JSON Pointer without following inherited object properties. */
export function resolveQaapJsonPointer(root: unknown, pointer: string): QaapJsonPointerResult {
    const tokens = decodePointerTokens(pointer);
    if (!tokens) {
        return { found: false };
    }
    if (tokens.length === 0) {
        return { found: root !== undefined, value: root };
    }
    if (!pointer.startsWith('/')) {
        return { found: false };
    }
    let current = root;
    for (const token of tokens) {
        if (Array.isArray(current)) {
            if (!/^(0|[1-9][0-9]*)$/.test(token)) {
                return { found: false };
            }
            const index = Number(token);
            if (!Number.isSafeInteger(index) || index >= current.length) {
                return { found: false };
            }
            current = current[index];
        } else if (current !== null && typeof current === 'object') {
            if (!Object.prototype.hasOwnProperty.call(current, token)) {
                return { found: false };
            }
            current = (current as Record<string, unknown>)[token];
        } else {
            return { found: false };
        }
    }
    return { found: true, value: current };
}

/** Immutably replace an existing JSON Pointer target. Object prototype keys are never writable. */
export function replaceQaapJsonPointer(
    root: unknown,
    pointer: string,
    replacement: unknown,
): QaapJsonPointerReplacementResult {
    const tokens = decodePointerTokens(pointer);
    if (!tokens) {
        return { found: false };
    }
    if (tokens.length === 0) {
        return { found: true, value: replacement };
    }
    const replaceAt = (current: unknown, index: number): QaapJsonPointerReplacementResult => {
        const token = tokens[index];
        if (UNSAFE_POINTER_TOKENS.has(token)) {
            return { found: false };
        }
        const last = index === tokens.length - 1;
        if (Array.isArray(current)) {
            if (!/^(0|[1-9][0-9]*)$/.test(token)) {
                return { found: false };
            }
            const arrayIndex = Number(token);
            if (!Number.isSafeInteger(arrayIndex) || arrayIndex >= current.length) {
                return { found: false };
            }
            const clone = [...current];
            if (last) {
                clone[arrayIndex] = replacement;
                return { found: true, value: clone };
            }
            const nested = replaceAt(current[arrayIndex], index + 1);
            if (!nested.found) {
                return nested;
            }
            clone[arrayIndex] = nested.value;
            return { found: true, value: clone };
        }
        if (current !== null && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, token)) {
            const record = current as Record<string, unknown>;
            const clone = { ...record };
            if (last) {
                clone[token] = replacement;
                return { found: true, value: clone };
            }
            const nested = replaceAt(record[token], index + 1);
            if (!nested.found) {
                return nested;
            }
            clone[token] = nested.value;
            return { found: true, value: clone };
        }
        return { found: false };
    };
    return replaceAt(root, 0);
}
