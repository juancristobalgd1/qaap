// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_USER_REPOS_SEGMENT } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { qaapProjectRemovalIdentity } from './qaap-project-removal-identity';

/** The fields of a Work Hub project card that name the repository clone it stands for. */
export interface QaapCloneIdentityProject {
    readonly id: string;
    readonly uri?: { toString(): string };
    readonly github?: { readonly owner: string; readonly name: string };
    readonly isCurrent?: boolean;
}

// A cwd → identity parse costs a regex pass and a URI parse; the hub asks for the same few cwds on
// every render. Least-recently-used eviction, one entry at a time: a walk over more distinct cwds
// than the limit keeps the hot ones instead of emptying the whole cache. The thread store also
// indexes its own cwds by identity (`QaapThreadStore.listCwdsForCloneIdentity`), so the per-card
// lookups never walk every cwd.
const CLONE_ROOT_IDENTITY_CACHE_LIMIT = 512;
const cloneRootIdentityCache = new Map<string, string | undefined>();

/**
 * `github:owner/repo` of a repository clone ROOT at `cwd`, whatever layout the clone path uses
 * (legacy flat `repos/<owner>/<repo>`, per-user `repos/users/<login>/<owner>/<repo>`, a trailing
 * slash or another casing all resolve to the same identity). Only the exact `<owner>/<repo>` pair
 * after `repos/` (or `repos/users/<login>/`) is a root: a folder below it is its own project, even
 * one named like the repository (`…/acme/web/apps/web`). `undefined` when `cwd` is not a clone root.
 */
export function qaapCloneRootIdentity(cwd: string | undefined): string | undefined {
    if (!cwd) {
        return undefined;
    }
    if (cloneRootIdentityCache.has(cwd)) {
        const cached = cloneRootIdentityCache.get(cwd);
        cloneRootIdentityCache.delete(cwd);
        cloneRootIdentityCache.set(cwd, cached);
        return cached;
    }
    const result = cloneRootIdentity(cwd);
    if (cloneRootIdentityCache.size >= CLONE_ROOT_IDENTITY_CACHE_LIMIT) {
        cloneRootIdentityCache.delete(cloneRootIdentityCache.keys().next().value!);
    }
    cloneRootIdentityCache.set(cwd, result);
    return result;
}

/**
 * `github:owner/repo` when `cwd` is exactly `<owner>/<repo>` after the FIRST `repos/` segment, or
 * `users/<login>/<owner>/<repo>` after it. Anchoring on the first segment keeps a repo or owner that
 * is itself named `repos` resolvable, and `repos/users/<repo>` is the legacy flat layout with an
 * owner literally named `users`.
 */
function cloneRootIdentity(cwd: string): string | undefined {
    const segments = cwd.replace(/^file:\/\//i, '').replace(/\\/g, '/').split('/').filter(Boolean);
    const reposIndex = segments.indexOf('repos');
    if (reposIndex < 0) {
        return undefined;
    }
    const afterRepos = segments.slice(reposIndex + 1);
    const pair = afterRepos.length === 2
        ? afterRepos
        : afterRepos[0] === QAAP_USER_REPOS_SEGMENT && afterRepos.length === 4 ? afterRepos.slice(2) : undefined;
    return pair ? `github:${pair[0]}/${pair[1]}`.toLowerCase() : undefined;
}

/**
 * Every `github:owner/repo` identity a project card claims the conversations of: its repository,
 * id or clone URI. Only catalog cards (and the card of the workspace open right now) claim: a
 * synthetic `ws:` card stands for exactly one conversation cwd and never absorbs another one.
 *
 * The sessions sidebar relies on this being the single rule on both sides: a conversation cwd whose
 * {@link qaapCloneRootIdentity} a card claims gets no card of its own, so that card must list it.
 */
export function qaapProjectCloneIdentities(project: QaapCloneIdentityProject): string[] {
    if (!project.isCurrent && project.id.startsWith('ws:')) {
        return [];
    }
    const identities = [
        project.github ? `github:${project.github.owner}/${project.github.name}` : undefined,
        project.id,
        project.uri?.toString(),
    ].map(key => qaapProjectRemovalIdentity(key))
        .filter((identity): identity is string => !!identity?.startsWith('github:'));
    return [...new Set(identities)];
}
