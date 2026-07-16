// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { fnv1aHex } from './qaap-research-hash';

/**
 * One changed path's resulting state after a round's edits, as the RUNNER observed it (e.g. via
 * `git status` + reading the file back off disk in `qaap-research-runner.ts`) — never as the agent
 * reported it. `content` is `undefined` when the path was deleted this round.
 */
export interface RealFileChange {
    readonly path: string;
    readonly content: string | undefined;
}

/** Canonical, sortable line for one change: quoted path, then quoted content or a DELETED marker
 *  a real file could never produce verbatim (so a file literally containing the word can't collide
 *  with an actual deletion). */
function canonicalChangeLine(change: RealFileChange): string {
    const content = change.content === undefined ? ' DELETED ' : JSON.stringify(change.content);
    return `${JSON.stringify(change.path)}:${content}`;
}

/**
 * Fingerprints the ACTUAL repo changes a round produced, so the runner's "don't repeat a config
 * you already tried" guard can rest on something it verified instead of the agent's own report.
 *
 * The agent's `[QAAP experiment] config` block is auto-reported and cannot be trusted as a guard:
 * observed in a real run, the agent once declared `{"x": "increased value"}` while the file on disk
 * never moved, and on another round declared `{"x": "3"}` (a string) with no effect, followed by
 * `{"x": 3}` (a number) that did — the same logical change, two different `configFingerprint`
 * values. This is the same "the runner measures, the agent doesn't self-report" principle already
 * applied to the metric; it was left open for the config until now.
 *
 * Deliberately hashes the RESULTING file state (path + content, or a deleted marker) rather than a
 * `git diff`: a diff's `index <sha>..<sha>` header and hunk context depend on the base commit, so
 * the identical logical change made from two different starting commits would fingerprint
 * differently and defeat exactly the repeat-detection this exists for. Resulting state has no such
 * dependency — the same end state always hashes the same, no matter how it was reached. Path order
 * in the input never matters: entries are sorted by path before hashing.
 */
export function realChangeFingerprint(changes: readonly RealFileChange[]): string {
    const sorted = [...changes].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return fnv1aHex(sorted.map(canonicalChangeLine).join('\n'));
}
