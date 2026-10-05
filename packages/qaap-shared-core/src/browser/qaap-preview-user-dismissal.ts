// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { normalizeIsolationPath } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import type { MobileProjectEntry } from './mobile-projects-types';

/**
 * Per-tab memory of "the user closed the preview of this project".
 *
 * Once the user closes the Work Hub preview surface, nothing automatic (port detected, server
 * ready, attach retries, transcript polls, bootstrap state changes, reloads in the same tab) may
 * open it again. Only an explicit user request ("Open preview", the Preview tab, "Focus
 * preview") clears the mark. Keys are normalized project directories so the bootstrap (which
 * knows the workspace root) and the Work Hub (which knows the project cwd) agree.
 *
 * `sessionStorage` scopes the memory to the browser tab: F5 keeps it, a fresh tab starts clean.
 */
export const QAAP_PREVIEW_USER_DISMISSED_STORAGE_KEY = 'qaap.preview.dismissedByUser';

const memoryFallback = new Set<string>();

export function qaapPreviewDismissalKey(projectDirectory: string | undefined): string | undefined {
    const raw = projectDirectory?.trim();
    if (!raw) {
        return undefined;
    }
    let normalized = raw;
    try {
        normalized = normalizeIsolationPath(raw);
    } catch {
        // Browser bundles may omit path.posix/win32; the plain normalization below still applies.
    }
    normalized = normalized.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return normalized || undefined;
}

function sessionStore(): Storage | undefined {
    try {
        return typeof window !== 'undefined' ? window.sessionStorage : undefined;
    } catch {
        return undefined;
    }
}

function readDismissedKeys(): Set<string> {
    const storage = sessionStore();
    if (!storage) {
        return new Set(memoryFallback);
    }
    try {
        const parsed: unknown = JSON.parse(storage.getItem(QAAP_PREVIEW_USER_DISMISSED_STORAGE_KEY) ?? '[]');
        return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
    } catch {
        return new Set();
    }
}

function writeDismissedKeys(keys: Set<string>): void {
    memoryFallback.clear();
    keys.forEach(key => memoryFallback.add(key));
    const storage = sessionStore();
    if (!storage) {
        return;
    }
    try {
        if (keys.size === 0) {
            storage.removeItem(QAAP_PREVIEW_USER_DISMISSED_STORAGE_KEY);
        } else {
            storage.setItem(QAAP_PREVIEW_USER_DISMISSED_STORAGE_KEY, JSON.stringify([...keys]));
        }
    } catch {
        /* quota / privacy mode: the in-memory fallback still holds for this page */
    }
}

/** The user closed the preview of this project: block automatic reopening until they ask again. */
export function markQaapPreviewDismissedByUser(projectDirectory: string | undefined): void {
    const key = qaapPreviewDismissalKey(projectDirectory);
    if (!key) {
        return;
    }
    const keys = readDismissedKeys();
    if (!keys.has(key)) {
        keys.add(key);
        writeDismissedKeys(keys);
    }
}

/** The user explicitly asked to see the preview of this project again. */
export function clearQaapPreviewDismissedByUser(projectDirectory: string | undefined): void {
    const key = qaapPreviewDismissalKey(projectDirectory);
    if (!key) {
        return;
    }
    const keys = readDismissedKeys();
    if (keys.delete(key)) {
        writeDismissedKeys(keys);
    }
}

export function isQaapPreviewDismissedByUser(projectDirectory: string | undefined): boolean {
    const key = qaapPreviewDismissalKey(projectDirectory);
    return !!key && readDismissedKeys().has(key);
}

/** Project directory used as the dismissal key on the Work Hub side (same rule as the preview launcher). */
export function qaapProjectPreviewDirectory(
    projectsService: { getProjectCwd(project: MobileProjectEntry): string | undefined } | undefined,
    project: MobileProjectEntry | undefined,
    preparedCwdByProjectId?: ReadonlyMap<string, string>,
    fallbackCwd?: string,
): string | undefined {
    if (!project) {
        return fallbackCwd;
    }
    const cwd = typeof projectsService?.getProjectCwd === 'function' ? projectsService.getProjectCwd(project) : undefined;
    return cwd ?? preparedCwdByProjectId?.get(project.id) ?? fallbackCwd;
}
