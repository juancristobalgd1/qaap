// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapGitHistoryCommit } from './qaap-git-review';

export function collectHistoryAuthors(commits: readonly QaapGitHistoryCommit[]): string[] {
    return uniqueSorted(commits.map(commit => commit.authorName.trim()).filter(name => name.length > 0));
}

export function collectHistoryBranches(commits: readonly QaapGitHistoryCommit[], current?: string): string[] {
    const names = new Set<string>();
    if (current?.trim()) {
        names.add(current.trim());
    }
    for (const commit of commits) {
        for (const ref of commit.refs) {
            const cleaned = cleanHistoryRef(ref);
            if (cleaned) {
                names.add(cleaned);
            }
        }
    }
    return uniqueSorted(Array.from(names));
}

export function cleanHistoryRef(ref: string): string | undefined {
    const trimmed = ref.trim();
    if (!trimmed || trimmed === 'HEAD' || /^HEAD\s*->/i.test(trimmed)) {
        const after = trimmed.replace(/^HEAD\s*->\s*/i, '').trim();
        return after && after !== 'HEAD' ? after.replace(/^origin\//, '') : undefined;
    }
    if (trimmed === 'origin/HEAD' || trimmed.endsWith('/HEAD')) {
        return undefined;
    }
    return trimmed.replace(/^origin\//, '');
}

export function cycleHistoryFilter(current: string | undefined, values: readonly string[]): string | undefined {
    if (values.length === 0) {
        return undefined;
    }
    if (!current) {
        return values[0];
    }
    const index = values.indexOf(current);
    if (index < 0 || index >= values.length - 1) {
        return undefined;
    }
    return values[index + 1];
}

export function filterTranscriptHistoryCommits(
    commits: readonly QaapGitHistoryCommit[],
    options: {
        readonly query?: string;
        readonly branch?: string;
        readonly author?: string;
    } = {},
): QaapGitHistoryCommit[] {
    const query = options.query?.trim().toLowerCase() ?? '';
    const branch = options.branch?.trim();
    const author = options.author?.trim();
    return commits.filter(commit => {
        if (author && commit.authorName !== author) {
            return false;
        }
        if (branch) {
            const refs = commit.refs.map(ref => cleanHistoryRef(ref)).filter((ref): ref is string => !!ref);
            if (refs.length > 0 && !refs.includes(branch)) {
                return false;
            }
        }
        if (!query) {
            return true;
        }
        const haystack = `${commit.subject} ${commit.authorName} ${commit.refs.join(' ')}`.toLowerCase();
        return haystack.includes(query);
    });
}

function uniqueSorted(values: readonly string[]): string[] {
    return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
