// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Scope rules for the backend self-verification loop. The loop runs the repo's own scripts over the
 * whole checkout, so a red `lint` can come from files the task never touched. Feeding that back to
 * the agent turned a one-line request into a nine-minute sweep over unrelated files; these helpers
 * decide what the fix turn may own.
 */

/** One path reported by `git status --porcelain -z`. */
export interface QaapWorktreeChange {
    /** Repo-relative path, forward slashes. */
    readonly path: string;
    /** `??` entry: the file is not tracked by git. */
    readonly untracked: boolean;
}

/** Suggested cap for `QAAP_AGENT_TASK_MAX_CHANGED_FILES`; the cap itself is opt-in. */
export const QAAP_AGENT_TASK_MAX_CHANGED_FILES = 5;

/**
 * Opt-in change-scope cap: a coding task that changes more files than this pauses for human review.
 * Off unless `QAAP_AGENT_TASK_MAX_CHANGED_FILES` is a positive integer, because scaffolds, refactors
 * and test suites legitimately touch many files.
 */
export function resolveAgentTaskChangedFilesLimit(env: Readonly<Record<string, string | undefined>>): number | undefined {
    const value = Number.parseInt(env.QAAP_AGENT_TASK_MAX_CHANGED_FILES?.trim() ?? '', 10);
    return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Parse `git status --porcelain -z --untracked-files=all`. Rename/copy entries carry the source path
 * as an extra NUL-separated field, which is skipped (the destination is what changed on disk).
 */
export function parseWorktreeStatusZ(stdout: string): QaapWorktreeChange[] {
    const changes: QaapWorktreeChange[] = [];
    const fields = stdout.split('\0');
    for (let index = 0; index < fields.length; index++) {
        const entry = fields[index];
        if (entry.length < 4) {
            continue;
        }
        const code = entry.slice(0, 2);
        const filePath = entry.slice(3).replace(/\\/g, '/');
        changes.push({ path: filePath, untracked: code === '??' });
        if (code[0] === 'R' || code[0] === 'C') {
            index++;
        }
    }
    return changes;
}

/** Changes present now that were not in `scope` — edits a fix turn made outside the task's files. */
export function findOutOfScopeChanges(current: readonly QaapWorktreeChange[], scope: ReadonlySet<string>): QaapWorktreeChange[] {
    return current.filter(change => !scope.has(change.path));
}

/** Remove dirty paths captured before the task so pre-existing user edits never widen task scope. */
export function findChangesSinceBaseline(
    current: readonly QaapWorktreeChange[],
    baselinePaths: readonly string[] = [],
): QaapWorktreeChange[] {
    const baseline = new Set(baselinePaths.map(filePath => filePath.replace(/\\/g, '/')));
    return current.filter(change => !baseline.has(change.path.replace(/\\/g, '/')));
}

/** New task-owned paths that exceed the default file cap, or `undefined` while within it. */
export function findChangesExceedingScopeLimit(
    current: readonly QaapWorktreeChange[],
    baselinePaths: readonly string[] = [],
    maxFiles = QAAP_AGENT_TASK_MAX_CHANGED_FILES,
): string[] | undefined {
    const changes = findChangesSinceBaseline(current, baselinePaths);
    return changes.length > maxFiles ? changes.map(change => change.path) : undefined;
}

/** Pure documentation / plain-text files that cannot break build, typecheck, or unit-test scripts. */
const DOCS_ONLY_FILE_PATTERN = /(?:^|\/)(?:(?:LICENSE|COPYING|NOTICE)(?:\.[^/]+)?|[^/]+\.(?:md|mdx|markdown|txt|rst|adoc))$/i;

/**
 * True when the task's own changed paths are known and every single one is a plain documentation or
 * text file. Running full repository build/compile/test verification for a markdown-only edit (e.g.
 * adding a `.md` note in a large monorepo) can burn the 5-minute wall clock without testing the edit.
 */
export function isDocsOnlyVerificationScope(scopePaths: readonly string[]): boolean {
    if (scopePaths.length === 0) {
        return false;
    }
    return scopePaths.every(filePath => DOCS_ONLY_FILE_PATTERN.test(filePath.replace(/\\/g, '/')));
}

/** Scripts whose findings are reported per file, so a failure can be attributed to the files it names. */
const PER_FILE_SCRIPT_PATTERN = /(?:^|[:\-_])(?:lint|eslint|stylelint|prettier|format)(?:$|[:\-_])/i;

/** Typecheck script names; `tsc`/`vue-tsc` diagnostics name their file the same way lint output does. */
const TYPECHECK_SCRIPT_NAMES = new Set(['typecheck', 'type-check', 'tsc', 'check-types', 'types']);

/** A command that invokes `tsc` or `vue-tsc` as a program, not as part of another word. */
const TSC_COMMAND_PATTERN = /(?:^|[\s/\\])(?:vue-)?tsc(?:\s|$)/i;

export function isPerFileVerificationScript(command: string): boolean {
    const script = command.replace(/^npm run\s+/, '').trim();
    const scriptName = script.split(/\s+/)[0].toLowerCase();
    return PER_FILE_SCRIPT_PATTERN.test(script)
        || TYPECHECK_SCRIPT_NAMES.has(scriptName)
        || TSC_COMMAND_PATTERN.test(script);
}

const SOURCE_PATH_PATTERN = /[\w@.\-/\\]+\.(?:[cm]?[jt]sx?|vue|svelte|astro|css|scss|sass|less|html|json|md|mdx|ya?ml|py|go|rs)\b/g;

/**
 * `'in-scope'` when the output names a file the task edited, `'out-of-scope'` when it names files but
 * none of them, `'unknown'` when it names no file at all (nothing to attribute, so the caller keeps
 * its previous behaviour).
 */
export function classifyVerificationFailureScope(output: string, scopePaths: readonly string[]): 'in-scope' | 'out-of-scope' | 'unknown' {
    const mentioned = (output.match(SOURCE_PATH_PATTERN) ?? [])
        .map(token => token.replace(/\\/g, '/').replace(/^\.\//, ''))
        .filter(token => !token.includes('node_modules/'));
    if (mentioned.length === 0) {
        return 'unknown';
    }
    const scope = scopePaths.map(scopePath => scopePath.replace(/\\/g, '/'));
    const matches = (token: string, scopePath: string): boolean =>
        token === scopePath || token.endsWith(`/${scopePath}`) || scopePath.endsWith(`/${token}`);
    return mentioned.some(token => scope.some(scopePath => matches(token, scopePath))) ? 'in-scope' : 'out-of-scope';
}
