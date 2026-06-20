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
        const keys = collectProjectDeduplicationKeys(project, ctx);
        if (keys.some(key => claimedKeys.has(key))) {
            continue;
        }
        for (const key of keys) {
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

function collectProjectDeduplicationKeys(
    project: MobileProjectEntry,
    ctx: MobileProjectDedupContext,
): string[] {
    const keys = new Set<string>();

    const uri = project.uri?.toString();
    if (uri) {
        keys.add(`uri:${uri}`);
    }

    if (project.github) {
        keys.add(`github:${project.github.owner}/${project.github.name}`.toLowerCase());
        const githubName = ctx.normalizeName(project.github.name);
        if (githubName) {
            keys.add(`name:${githubName}`);
        }
    }

    const cwd = ctx.cwdFromUri(project.uri);
    if (cwd) {
        keys.add(`cwd:${cwd.toLowerCase()}`);
    }

    if (project.isCurrent) {
        const displayName = ctx.normalizeName(project.name);
        if (displayName) {
            keys.add(`name:${displayName}`);
        }
    }

    return [...keys];
}
