// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { prefersReducedMotion } from '../common/qaap-prefers-reduced-motion';

/**
 * Continuous lucide-animated–inspired motion on transcript/trace tool icons
 * while a tool row is in progress. CSS keyframes + class toggle (no Motion dep).
 */
export const ACTIVITY_TOOL_ICON_MOTION_CLASS = 'theia-mod-tool-motion';

export type ActivityToolIconMotionKind =
    | 'edit'
    | 'write'
    | 'search'
    | 'read'
    | 'update'
    | 'run'
    | 'delete'
    | 'generic';

export const ACTIVITY_TOOL_ICON_MOTION_KINDS: readonly ActivityToolIconMotionKind[] = [
    'edit',
    'write',
    'search',
    'read',
    'update',
    'run',
    'delete',
    'generic',
] as const;

export function activityToolIconMotionKindClass(kind: ActivityToolIconMotionKind): string {
    return `${ACTIVITY_TOOL_ICON_MOTION_CLASS}-${kind}`;
}

/**
 * Map activity `toolKind` / execution `MobileEventKind` / retry state onto a
 * motion preset. Returns `undefined` when the kind should not animate (e.g.
 * thinking / planning / preparing-response writing).
 */
export function resolveActivityToolIconMotionKind(
    kind: string | undefined,
): ActivityToolIconMotionKind | undefined {
    switch (kind) {
        case 'edit':
        case 'editing':
            return 'edit';
        case 'write':
            return 'write';
        case 'search':
        case 'searching':
        case 'explore':
        case 'webfetch':
            return 'search';
        case 'read':
        case 'reading':
        case 'file':
            return 'read';
        case 'update':
        case 'retrying':
            return 'update';
        case 'run':
        case 'terminal':
            return 'run';
        case 'delete':
            return 'delete';
        case 'mcp':
        case 'todo':
        case 'task':
        case 'delegate':
        case 'verification':
        case 'other':
            return 'generic';
        default:
            return undefined;
    }
}

/**
 * Toggle continuous tool-icon motion while `active`. Idempotent — only mutates
 * classList when the desired motion state differs (safe under streaming patches).
 */
export function syncActivityToolIconMotion(
    icon: HTMLElement,
    active: boolean,
    kind?: string,
): void {
    const motionKind = active && !prefersReducedMotion()
        ? resolveActivityToolIconMotionKind(kind)
        : undefined;

    if (!motionKind) {
        clearActivityToolIconMotion(icon);
        return;
    }

    const kindClass = activityToolIconMotionKindClass(motionKind);
    const hasHost = icon.classList.contains(ACTIVITY_TOOL_ICON_MOTION_CLASS);
    const hasKind = icon.classList.contains(kindClass);
    if (hasHost && hasKind) {
        // Drop any stale sibling kind classes without re-toggling the host.
        for (const other of ACTIVITY_TOOL_ICON_MOTION_KINDS) {
            if (other !== motionKind) {
                icon.classList.remove(activityToolIconMotionKindClass(other));
            }
        }
        return;
    }

    icon.classList.add(ACTIVITY_TOOL_ICON_MOTION_CLASS);
    for (const other of ACTIVITY_TOOL_ICON_MOTION_KINDS) {
        icon.classList.toggle(activityToolIconMotionKindClass(other), other === motionKind);
    }
}

export function clearActivityToolIconMotion(icon: HTMLElement): void {
    if (!icon.classList.contains(ACTIVITY_TOOL_ICON_MOTION_CLASS)
        && !ACTIVITY_TOOL_ICON_MOTION_KINDS.some(k => icon.classList.contains(activityToolIconMotionKindClass(k)))) {
        return;
    }
    icon.classList.remove(ACTIVITY_TOOL_ICON_MOTION_CLASS);
    for (const other of ACTIVITY_TOOL_ICON_MOTION_KINDS) {
        icon.classList.remove(activityToolIconMotionKindClass(other));
    }
}
