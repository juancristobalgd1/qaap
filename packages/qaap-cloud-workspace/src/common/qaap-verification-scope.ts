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

/** Scripts whose findings are reported per file, so a failure can be attributed to the files it names. */
const PER_FILE_SCRIPT_PATTERN = /(?:^|[:\-_])(?:lint|eslint|stylelint|prettier|format)(?:$|[:\-_])/i;

export function isPerFileVerificationScript(command: string): boolean {
    const script = command.replace(/^npm run\s+/, '').trim();
    return PER_FILE_SCRIPT_PATTERN.test(script);
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
