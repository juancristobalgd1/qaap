// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { qaapProjectRemovalIdentity } from './qaap-project-removal-identity';

/** The fields of a Work Hub project card that name the repository clone it stands for. */
export interface QaapCloneIdentityProject {
    readonly id: string;
    readonly uri?: { toString(): string };
    readonly github?: { readonly owner: string; readonly name: string };
    readonly isCurrent?: boolean;
}

// A cwd → identity parse costs a regex pass and a URI parse; the hub asks for the same few
// cwds on every render, so remember them (bounded: a long session sees few distinct cwds).
const CLONE_ROOT_IDENTITY_CACHE_LIMIT = 512;
const cloneRootIdentityCache = new Map<string, string | undefined>();

/**
 * `github:owner/repo` of a repository clone ROOT at `cwd`, whatever layout the clone path uses
 * (legacy flat `repos/<owner>/<repo>`, per-user `repos/users/<login>/<owner>/<repo>`, a trailing
 * slash or another casing all resolve to the same identity). A folder below the clone root does
 * not count: it is its own project. `undefined` when `cwd` is not a clone root.
 */
export function qaapCloneRootIdentity(cwd: string | undefined): string | undefined {
    if (!cwd) {
        return undefined;
    }
    if (cloneRootIdentityCache.has(cwd)) {
        return cloneRootIdentityCache.get(cwd);
    }
    const identity = qaapProjectRemovalIdentity(cwd);
    const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop()?.toLowerCase();
    const result = identity?.startsWith('github:') && base === identity.slice(identity.indexOf('/') + 1) ? identity : undefined;
    if (cloneRootIdentityCache.size >= CLONE_ROOT_IDENTITY_CACHE_LIMIT) {
        cloneRootIdentityCache.clear();
    }
    cloneRootIdentityCache.set(cwd, result);
    return result;
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
