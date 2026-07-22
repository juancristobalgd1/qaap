// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface QaapJsonPointerResult {
    readonly found: boolean;
    readonly value?: unknown;
}

export function isValidQaapJsonPointer(pointer: unknown, maxLength = 1_024): pointer is string {
    return typeof pointer === 'string' && pointer.length <= maxLength
        && (pointer === '' || (pointer.startsWith('/') && !/~(?:[^01]|$)/.test(pointer)));
}

/** Resolve an RFC 6901 JSON Pointer without following inherited object properties. */
export function resolveQaapJsonPointer(root: unknown, pointer: string): QaapJsonPointerResult {
    if (!isValidQaapJsonPointer(pointer)) {
        return { found: false };
    }
    if (pointer === '') {
        return { found: root !== undefined, value: root };
    }
    if (!pointer.startsWith('/')) {
        return { found: false };
    }
    let current = root;
    for (const rawToken of pointer.slice(1).split('/')) {
        const token = rawToken.replace(/~1/g, '/').replace(/~0/g, '~');
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
