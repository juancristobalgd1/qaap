// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type ExecutionSurfaceTabId = 'messages' | 'review' | 'preview' | 'files' | 'terminal';

export const EXECUTION_SURFACE_TAB_USAGE_STORAGE_KEY = 'qaap.executionSurfaceTabUsage';

export function readExecutionSurfaceTabUsage(): Partial<Record<ExecutionSurfaceTabId, number>> {
    try {
        if (typeof window === 'undefined') {
            return {};
        }
        const raw = window.localStorage.getItem(EXECUTION_SURFACE_TAB_USAGE_STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw) as Partial<Record<ExecutionSurfaceTabId, number>>;
        if (!parsed || typeof parsed !== 'object') {
            return {};
        }
        return parsed;
    } catch {
        return {};
    }
}

export function writeExecutionSurfaceTabUsage(
    usage: Readonly<Partial<Record<ExecutionSurfaceTabId, number>>>,
): void {
    try {
        if (typeof window === 'undefined') {
            return;
        }
        window.localStorage.setItem(EXECUTION_SURFACE_TAB_USAGE_STORAGE_KEY, JSON.stringify(usage));
    } catch {
        /* private mode — ignore */
    }
}

export function recordExecutionSurfaceTabUse(tab: ExecutionSurfaceTabId): Partial<Record<ExecutionSurfaceTabId, number>> {
    const usage = { ...readExecutionSurfaceTabUsage() };
    usage[tab] = (usage[tab] ?? 0) + 1;
    writeExecutionSurfaceTabUsage(usage);
    return usage;
}

