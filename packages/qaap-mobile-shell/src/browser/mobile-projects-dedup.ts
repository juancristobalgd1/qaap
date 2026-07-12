// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';
import type { MobileProjectEntry } from './mobile-projects-types';

export interface MobileProjectDedupContext {
    normalizeName(name: string | undefined): string | undefined;
    cwdFromUri(uri: URI | undefined): string | undefined;
    projectActivityTime(project: MobileProjectEntry): number;
}

/** Collapse workspace/github/recent cards that describe the same repository. */
export function deduplicateMobileProjectEntries(
    entries: readonly MobileProjectEntry[],
    ctx: MobileProjectDedupContext,
): MobileProjectEntry[] {
    if (entries.length <= 1) {
        return [...entries];
    }
    const sorted = [...entries].sort((a, b) => compareProjectEntryPrecedence(a, b, ctx));
    const kept: MobileProjectEntry[] = [];
    const claimedKeys = new Set<string>();

    for (const project of sorted) {
        const { claims, probes } = collectProjectDeduplicationKeys(project, ctx);
        if (claims.some(key => claimedKeys.has(key)) || probes.some(key => claimedKeys.has(key))) {
            continue;
        }
        for (const key of claims) {
            claimedKeys.add(key);
        }
        kept.push(project);
    }
    return kept;
}

function compareProjectEntryPrecedence(
    a: MobileProjectEntry,
    b: MobileProjectEntry,
    ctx: MobileProjectDedupContext,
): number {
    return projectEntryPrecedence(a, ctx) - projectEntryPrecedence(b, ctx);
}

function projectEntryPrecedence(project: MobileProjectEntry, ctx: MobileProjectDedupContext): number {
    let score = 0;
    if (project.isCurrent) {
        score -= 1_000_000;
    }
    if (project.id.startsWith('ws:')) {
        score -= 10_000;
    } else if (project.id.startsWith('recent:')) {
        score -= 5_000;
    } else if (project.id.startsWith('github:')) {
        score -= 1_000;
    }
    if (project.uri) {
        score -= 100;
    }
    if (project.pinned) {
        score -= 50;
    }
    score -= ctx.projectActivityTime(project) / 1_000_000_000;
    return score;
}

/**
 * `claims` identify this project and are registered so later (lower-precedence) entries collapse
 * into it. `probes` are only checked against already-claimed keys, never registered.
 *
 * The display name is a claim ONLY for the current workspace and a probe for everything else:
 * the current repo often appears again as a github/custom/recent card whose URI takes a different
 * form (legacy flat path vs per-user clone path, trailing slash), so the exact uri/cwd keys miss
 * and the name is the only stable link. Registering the name for non-current entries would
 * wrongly merge distinct repos that merely share a basename (forks, alpha/demo vs beta/demo) —
 * as a probe, same-named non-current entries still coexist with each other.
 */
function collectProjectDeduplicationKeys(
    project: MobileProjectEntry,
    ctx: MobileProjectDedupContext,
): { claims: string[]; probes: string[] } {
    const claims = new Set<string>();
    const probes = new Set<string>();

    const uri = project.uri?.toString();
    if (uri) {
        claims.add(`uri:${uri}`);
    }

    if (project.github) {
        claims.add(`github:${project.github.owner}/${project.github.name}`.toLowerCase());
    }

    const cwd = ctx.cwdFromUri(project.uri);
    if (cwd) {
        claims.add(`cwd:${cwd.toLowerCase()}`);
    }

    const displayName = ctx.normalizeName(project.name);
    if (displayName) {
        if (project.isCurrent) {
            claims.add(`name:${displayName}`);
        } else {
            probes.add(`name:${displayName}`);
        }
    }

    return { claims: [...claims], probes: [...probes] };
}
