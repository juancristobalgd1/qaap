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

/**
 * Normalizes a file's content before it is hashed, so a pure formatting change — line-ending
 * style, trailing whitespace, indentation width, or a trailing blank line — doesn't shift the
 * fingerprint and let an agent "evade" the repeat-guard by re-submitting an already-tried config
 * reformatted. Concretely: unifies `\r\n` to `\n`, collapses runs of spaces/tabs to a single
 * space, drops any space adjacent to non-word punctuation (`{`, `}`, `:`, `,`, `=`, quotes, ...),
 * and finally drops trailing blank lines. Removing whitespace next to punctuation is safe because
 * the punctuation itself already terminates the token on that side — it can never fuse two
 * identifiers the way deleting a space between two word characters would (`not x` must stay
 * distinct from `notx`). That's what lets this fold `{"x": 3}`, `{"x":3}`, and `{ "x" : 3 }`
 * together: every one of those spaces sits next to `{`, `}`, `"`, or `:`.
 *
 * Deliberately conservative, and asymmetrically so: this is generic textual normalization, not a
 * per-language parse (no JSON/YAML-aware canonicalization of key order, numeric formatting, etc).
 * - False negative (acceptable): a semantically-identical edit whose formatting differs in a way
 *   this doesn't collapse (e.g. reordered JSON keys) can still get a different fingerprint. Worst
 *   case, the guard is fooled once and a round is spent re-running a config already tried.
 * - False positive (never acceptable): two genuinely different changes must never collapse to the
 *   same fingerprint, or the guard would silently discard a new experiment. Every transform here
 *   only removes whitespace that carries no information (never whitespace between two word
 *   characters, which is the only place a space can be semantically load-bearing), so it cannot
 *   fold two different edits into one.
 */
function normalizeForFingerprint(content: string): string {
    const lines = content
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.replace(/[ \t]+/g, ' ').trim().replace(/(?<=\W) | (?=\W)/g, ''));
    while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines.join('\n');
}

/** Canonical, sortable line for one change: quoted path, then quoted (normalized) content or a
 *  DELETED marker a real file could never produce verbatim (so a file literally containing the
 *  word can't collide with an actual deletion). */
function canonicalChangeLine(change: RealFileChange): string {
    const content = change.content === undefined ? ' DELETED ' : JSON.stringify(normalizeForFingerprint(change.content));
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
 * in the input never matters: entries are sorted by path before hashing. Content is run through
 * `normalizeForFingerprint` first — see that function's doc for the false-negative/false-positive
 * trade-off of normalizing formatting away before hashing.
 */
export function realChangeFingerprint(changes: readonly RealFileChange[]): string {
    const sorted = [...changes].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return fnv1aHex(sorted.map(canonicalChangeLine).join('\n'));
}
