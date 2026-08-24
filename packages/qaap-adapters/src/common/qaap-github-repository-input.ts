// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface QaapGithubRepositoryInput {
    readonly owner: string;
    readonly name: string;
}

const VALID_REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** Parse the repository forms accepted by the clone UI and API. */
export function parseQaapGithubRepositoryInput(value: string): QaapGithubRepositoryInput | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const sshMatch = /^git@github\.com:([^/]+)\/(.+)$/i.exec(trimmed);
    let candidate = sshMatch ? `${sshMatch[1]}/${sshMatch[2]}` : trimmed;
    candidate = candidate.replace(/\.git$/i, '');

    try {
        const url = new URL(candidate);
        if (url.hostname.toLowerCase() !== 'github.com') {
            return undefined;
        }
        candidate = url.pathname.replace(/^\/+/, '');
    } catch {
        // Treat a non-URL value as the shorthand owner/name form.
    }

    const segments = candidate.split('/').filter(Boolean);
    if (segments.length !== 2) {
        return undefined;
    }
    const [owner, name] = segments;
    if (!owner || !name || !VALID_REPOSITORY_SEGMENT.test(owner) || !VALID_REPOSITORY_SEGMENT.test(name)) {
        return undefined;
    }
    return { owner, name };
}
