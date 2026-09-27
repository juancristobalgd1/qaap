// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Deterministic FNV-1a (32-bit) hash, hex-encoded. Pure JS on purpose: this is common/, no node
 * crypto — the same input hashes identically in the browser, in node, and across processes.
 * Shared by {@link ./qaap-research-ledger}'s `configFingerprint` (hashes the agent's self-reported
 * config) and {@link ./qaap-research-realchange}'s `realChangeFingerprint` (hashes what the runner
 * actually observed changed on disk) — two different canonicalizations of the same hash primitive.
 */
export function fnv1aHex(input: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index++) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
