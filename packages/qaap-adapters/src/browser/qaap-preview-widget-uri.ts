// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';

/**
 * Stable identity of a preview surface.
 *
 * Deliberately keyed on the *project*, not on the running process: `processId` is regenerated on
 * every dev-server run, so keying widgets on it would spawn a new preview tab on each restart.
 * The project identity survives restarts and browser reloads, giving exactly one preview tab per
 * project — which is the product contract ("cada proyecto conserva y muestra su propia preview").
 */
export interface QaapPreviewWidgetKey {
    readonly workspaceId: string;
    readonly projectId: string;
}

/** True when `value` can key a project-scoped preview widget. */
export function isQaapPreviewWidgetKey(value: unknown): value is QaapPreviewWidgetKey {
    const candidate = value as Partial<QaapPreviewWidgetKey> | undefined;
    return typeof candidate?.workspaceId === 'string' && candidate.workspaceId.trim().length > 0
        && typeof candidate?.projectId === 'string' && candidate.projectId.trim().length > 0;
}

/** Builds a widget key from probe/claim coordinates. Missing parts ⇒ no key (legacy tab). */
export function qaapPreviewWidgetKeyFromCoordinates(
    workspaceId: string | undefined,
    projectId: string | undefined,
): QaapPreviewWidgetKey | undefined {
    const workspace = workspaceId?.trim();
    const project = projectId?.trim();
    if (!workspace || !project) {
        return undefined;
    }
    return { workspaceId: workspace, projectId: project };
}

/** Picks a {@link QaapPreviewWidgetKey} out of command args (ignores URLs and other values). */
export function coerceQaapPreviewWidgetKey(args: readonly unknown[]): QaapPreviewWidgetKey | undefined {
    for (const arg of args) {
        if (isQaapPreviewWidgetKey(arg)) {
            return qaapPreviewWidgetKeyFromCoordinates(arg.workspaceId, arg.projectId);
        }
    }
    return undefined;
}

/**
 * Same scheme as `MiniBrowserOpenHandler.PREVIEW_URI` (keep in sync). Referenced as a literal so
 * this module stays DOM-free and usable from node-side specs.
 */
export const QAAP_PREVIEW_WIDGET_SCHEME = '__minibrowser__preview__';

const LEGACY_PREVIEW_URI = new URI().withScheme(QAAP_PREVIEW_WIDGET_SCHEME);

/** Short, stable, filesystem/id-safe digest so widget ids stay readable and bounded. */
function digest(value: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
    return `${h1.toString(36)}${h2.toString(36)}`;
}

/**
 * Widget URI for a project's preview surface.
 *
 * Without a key this returns the legacy {@link MiniBrowserOpenHandler.PREVIEW_URI}, so callers that
 * have no project context (the empty preview tab, the toolbar "Open URL") keep their current
 * single-tab behavior. Work Hub / bootstrap **must** pass a key: `mini-browser.openUrl` without
 * one still lands on the shared singleton tab.
 */
export function qaapPreviewWidgetUri(key?: QaapPreviewWidgetKey): URI {
    if (!key) {
        return LEGACY_PREVIEW_URI;
    }
    return LEGACY_PREVIEW_URI.withPath(`/${digest(key.workspaceId)}/${digest(key.projectId)}`);
}

/** True for the legacy preview URI and every project-scoped preview URI. */
export function isQaapPreviewWidgetUri(uri: URI | undefined): boolean {
    return !!uri && uri.scheme === QAAP_PREVIEW_WIDGET_SCHEME;
}

/** True for widget ids produced by the mini-browser open handler for any preview URI. */
export function isQaapPreviewWidgetId(id: string | undefined): boolean {
    return !!id && id.startsWith(`mini-browser:${QAAP_PREVIEW_WIDGET_SCHEME}`);
}
