// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Minimal RFC 6902 JSON Patch ops used by AG-UI ActivityDelta / StateDelta. */
export interface QaapJsonPatchOperation {
    readonly op: 'add' | 'replace' | 'remove';
    readonly path: string;
    readonly value?: unknown;
}

function decodeJsonPointerSegment(segment: string): string {
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parseJsonPointer(path: string): string[] {
    if (!path.startsWith('/')) {
        return [];
    }
    if (path === '/') {
        return [''];
    }
    return path.slice(1).split('/').map(decodeJsonPointerSegment);
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** Apply JSON Patch operations to a cloned document (AG-UI ActivityDelta). */
export function applyQaapJsonPatch<T>(document: T, patch: readonly QaapJsonPatchOperation[]): T {
    const root = cloneJson(document);
    for (const operation of patch) {
        applyQaapJsonPatchOperation(root as unknown as Record<string, unknown>, operation);
    }
    return root;
}

function applyQaapJsonPatchOperation(
    root: Record<string, unknown>,
    operation: QaapJsonPatchOperation,
): void {
    const segments = parseJsonPointer(operation.path);
    if (segments.length === 0) {
        return;
    }
    let parent: Record<string, unknown> | unknown[] = root;
    for (let index = 0; index < segments.length - 1; index++) {
        const key = segments[index];
        const next = Array.isArray(parent)
            ? parent[Number(key)]
            : (parent as Record<string, unknown>)[key];
        if (next === undefined || typeof next !== 'object' || next === null) {
            return;
        }
        parent = next as Record<string, unknown> | unknown[];
    }
    const leaf = segments[segments.length - 1];
    if (Array.isArray(parent)) {
        const arrayIndex = leaf === '-' ? parent.length : Number(leaf);
        if (operation.op === 'remove') {
            parent.splice(arrayIndex, 1);
            return;
        }
        if (operation.op === 'add' || operation.op === 'replace') {
            if (leaf === '-' && operation.op === 'add') {
                parent.push(operation.value);
            } else {
                parent[arrayIndex] = operation.value;
            }
        }
        return;
    }
    const record = parent as Record<string, unknown>;
    if (operation.op === 'remove') {
        delete record[leaf];
        return;
    }
    if (operation.op === 'add' || operation.op === 'replace') {
        record[leaf] = operation.value;
    }
}
