// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Detects added diff lines that silence a lint / type / test check instead of fixing it
 * (`eslint-disable`, `@ts-ignore`, skipped tests, rules turned off in lint/tsconfig files…), so the
 * Review changes view can flag them. Agents are told never to add these on their own; this is the
 * safety net that makes a slipped-through suppression visible before the user accepts the diff.
 */
export type QaapCheckSuppressionKind =
    | 'eslint-disable'
    | 'ts-ignore'
    | 'ts-expect-error'
    | 'ts-nocheck'
    | 'lint-ignore'
    | 'skipped-test'
    | 'config-loosened';

interface SuppressionPattern {
    readonly kind: QaapCheckSuppressionKind;
    readonly pattern: RegExp;
}

/** Comment openers: `//`, `/*`, `*` (block continuation), `<!--`, `#`, `{/*` (JSX). */
const COMMENT = String.raw`(?:\/\/|\/\*|^\s*\*|<!--|#)`;

const LINE_PATTERNS: readonly SuppressionPattern[] = [
    { kind: 'eslint-disable', pattern: new RegExp(`${COMMENT}\\s*eslint-disable(?:-next-line|-line)?\\b`) },
    // Inline rule override: /* eslint no-console: "off" */ or /* eslint no-console: 0 */
    { kind: 'eslint-disable', pattern: /\/\*\s*eslint\s+[\w@/-]+\s*:\s*["']?(?:off|0)\b/ },
    { kind: 'ts-ignore', pattern: new RegExp(`${COMMENT}\\s*@ts-ignore\\b`) },
    { kind: 'ts-expect-error', pattern: new RegExp(`${COMMENT}\\s*@ts-expect-error\\b`) },
    { kind: 'ts-nocheck', pattern: new RegExp(`${COMMENT}\\s*@ts-nocheck\\b`) },
    { kind: 'lint-ignore', pattern: new RegExp(`${COMMENT}\\s*(?:tslint:disable|stylelint-disable|biome-ignore|prettier-ignore|jshint\\s+ignore|(?:istanbul|c8)\\s+ignore)\\b`) },
    { kind: 'lint-ignore', pattern: /#\s*(?:noqa\b|type:\s*ignore\b|pylint:\s*disable\b|rubocop:disable\b)/ },
    { kind: 'lint-ignore', pattern: /\/\/\s*nolint\b/ },
    { kind: 'lint-ignore', pattern: /@SuppressWarnings\s*\(/ },
    { kind: 'skipped-test', pattern: /\b(?:it|test|describe|context|suite)\.(?:skip|only)\s*\(/ },
    { kind: 'skipped-test', pattern: /(?:^|[^\w.$])(?:xit|xdescribe|xtest|fdescribe)\s*\(/ },
];

const ESLINT_CONFIG_FILE = /^(?:\.eslintrc(?:\.[\w]+)?|eslint\.config\.[cm]?[jt]s)$/i;
const TS_CONFIG_FILE = /^(?:tsconfig[\w.-]*|jsconfig)\.json$/i;
const PROSE_FILE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/i;

const ESLINT_CONFIG_PATTERNS: readonly RegExp[] = [
    // "rule-name": "off" | 'off' | 0 (optionally inside an array: ["off", …])
    /["'][\w@/-]+["']\s*:\s*\[?\s*(?:["']off["']|0)\s*[,\]]?/,
    /[\w-]+\s*:\s*\[?\s*["']off["']/,
    /\b(?:ignorePatterns|ignores)\s*["']?\s*:/,
];

const TS_CONFIG_PATTERNS: readonly RegExp[] = [
    /["'](?:strict|noImplicitAny|strictNullChecks|strictFunctionTypes|strictPropertyInitialization|noImplicitThis|noImplicitReturns|noUnusedLocals|noUnusedParameters|noFallthroughCasesInSwitch|alwaysStrict)["']\s*:\s*false\b/,
    /["'](?:skipLibCheck|suppressImplicitAnyIndexErrors|suppressExcessPropertyErrors)["']\s*:\s*true\b/,
    /["']checkJs["']\s*:\s*false\b/,
];

function baseName(path: string | undefined): string {
    if (!path) {
        return '';
    }
    const normalized = path.replace(/\\/g, '/');
    return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/** Kind of check an added line silences, or `undefined` when it does not silence one. */
export function detectCheckSuppression(text: string, path?: string): QaapCheckSuppressionKind | undefined {
    if (!text.trim()) {
        return undefined;
    }
    const name = baseName(path);
    // Documentation that merely names a directive is not a suppression.
    if (PROSE_FILE.test(name)) {
        return undefined;
    }
    if (ESLINT_CONFIG_FILE.test(name) && ESLINT_CONFIG_PATTERNS.some(pattern => pattern.test(text))) {
        return 'config-loosened';
    }
    if (TS_CONFIG_FILE.test(name) && TS_CONFIG_PATTERNS.some(pattern => pattern.test(text))) {
        return 'config-loosened';
    }
    return LINE_PATTERNS.find(entry => entry.pattern.test(text))?.kind;
}

/** Number of ADDED lines in the given hunks that silence a check. */
export function countAddedCheckSuppressions(
    hunks: ReadonlyArray<{ readonly lines: ReadonlyArray<{ readonly type: string; readonly text: string }> }>,
    path?: string,
): number {
    let count = 0;
    for (const hunk of hunks) {
        for (const line of hunk.lines) {
            if (line.type === 'add' && detectCheckSuppression(line.text, path)) {
                count++;
            }
        }
    }
    return count;
}
