// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Legacy turn-scoped coordinates kept so already persisted preview links remain valid. */
export interface QaapLegacyPreviewIdentity {
    readonly projectId: string;
    readonly conversationId: string;
    readonly runId: string;
}

/**
 * Sentinel section scope used by classic IDE / bootstrap paths that are not tied to a Work Hub
 * conversation. Distinct conversations must never collapse onto this value.
 */
export const QAAP_DEFAULT_PREVIEW_CONVERSATION_ID = 'default';

/**
 * Stable process coordinates for a multi-tenant preview. The authenticated backend supplies
 * `userId`; clients may never choose another user's namespace.
 *
 * `conversationId` scopes the live preview to one Work Hub section (chat). Two sections of the
 * same project keep independent claims, ports, and iframe URLs — matching Cursor/Codex.
 */
export interface QaapProcessPreviewIdentity {
    readonly userId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly conversationId: string;
    readonly processId: string;
}

/** Client-supplied process coordinates. `userId` is added server-side after authentication. */
export interface QaapProcessPreviewClaimIdentity {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly processId: string;
    /** Work Hub section / conversation id. Omitted ⇒ {@link QAAP_DEFAULT_PREVIEW_CONVERSATION_ID}. */
    readonly conversationId?: string;
}

export type QaapPreviewIdentity = QaapLegacyPreviewIdentity | QaapProcessPreviewIdentity;

export type QaapResolvedPreviewIdentity = QaapPreviewIdentity & {
    readonly previewId: string;
};

const PREVIEW_ID_PART_MAX = 12;
const PREVIEW_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizePreviewIdPart(value: string): string {
    const normalized = value.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, PREVIEW_ID_PART_MAX)
        .replace(/-+$/g, '');
    return normalized || 'unknown';
}

function shortPreviewIdPart(value: string): string {
    return normalizePreviewIdPart(value).slice(0, 8).replace(/-+$/g, '') || 'unknown';
}

/** Small deterministic suffix; the full coordinates remain authoritative in the backend record. */
function hashPreviewIdentity(value: string): string {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        left ^= code;
        left = Math.imul(left, 0x01000193);
        right ^= code + index;
        right = Math.imul(right, 0x85ebca6b);
    }
    return `${(left >>> 0).toString(36).padStart(7, '0').slice(-7)}${(right >>> 0).toString(36).padStart(7, '0').slice(-7)}`;
}

/** Normalizes a section scope; empty/missing values become the classic-IDE default. */
export function normalizeQaapPreviewConversationId(value: string | undefined): string {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : QAAP_DEFAULT_PREVIEW_CONVERSATION_ID;
}

/**
 * DNS-label-safe identity derived from project + conversation + run. The readable prefixes help
 * operators, while the suffix prevents truncated UUIDs from collapsing onto one preview.
 */
export function buildQaapPreviewId(identity: QaapPreviewIdentity): string {
    if (isQaapProcessPreviewIdentity(identity)) {
        const conversationId = normalizeQaapPreviewConversationId(identity.conversationId);
        const source = `${identity.userId}\0${identity.workspaceId}\0${identity.projectId}\0${conversationId}\0${identity.processId}`;
        return [
            'u', shortPreviewIdPart(identity.userId),
            'w', shortPreviewIdPart(identity.workspaceId),
            'p', shortPreviewIdPart(identity.projectId),
            'x', shortPreviewIdPart(identity.processId),
            hashPreviewIdentity(source),
        ].join('-');
    }
    const source = `${identity.projectId}\0${identity.conversationId}\0${identity.runId}`;
    return [
        'p', normalizePreviewIdPart(identity.projectId),
        'c', normalizePreviewIdPart(identity.conversationId),
        'r', normalizePreviewIdPart(identity.runId),
        hashPreviewIdentity(source).slice(0, 7),
    ].join('-');
}

export function resolveQaapPreviewIdentity<T extends QaapPreviewIdentity>(identity: T): T & { readonly previewId: string } {
    if (isQaapProcessPreviewIdentity(identity)) {
        const normalized = {
            ...identity,
            conversationId: normalizeQaapPreviewConversationId(identity.conversationId),
        };
        return { ...normalized, previewId: buildQaapPreviewId(normalized) } as T & { readonly previewId: string };
    }
    return { ...identity, previewId: buildQaapPreviewId(identity) };
}

export function isQaapPreviewId(value: string | undefined): value is string {
    return typeof value === 'string' && value.length <= 63 && PREVIEW_ID_PATTERN.test(value);
}

export function isQaapPreviewIdentity(value: Partial<QaapPreviewIdentity>): value is QaapPreviewIdentity {
    return isQaapProcessPreviewIdentity(value) || isQaapLegacyPreviewIdentity(value);
}

export function isQaapLegacyPreviewIdentity(value: unknown): value is QaapLegacyPreviewIdentity {
    const candidate = value as Partial<QaapLegacyPreviewIdentity> | undefined;
    return typeof candidate?.projectId === 'string' && candidate.projectId.trim().length > 0
        && typeof candidate.conversationId === 'string' && candidate.conversationId.trim().length > 0
        && typeof candidate.runId === 'string' && candidate.runId.trim().length > 0;
}

export function isQaapProcessPreviewClaimIdentity(value: unknown): value is QaapProcessPreviewClaimIdentity {
    const candidate = value as Partial<QaapProcessPreviewClaimIdentity> | undefined;
    return typeof candidate?.workspaceId === 'string' && candidate.workspaceId.trim().length > 0
        && typeof candidate.projectId === 'string' && candidate.projectId.trim().length > 0
        && typeof candidate.processId === 'string' && candidate.processId.trim().length > 0;
}

export function isQaapProcessPreviewIdentity<T>(value: T): value is T & QaapProcessPreviewIdentity {
    const candidate = value as Partial<QaapProcessPreviewIdentity> | undefined;
    // Pre-section registry rows omit conversationId; callers must normalize via
    // {@link normalizeQaapPreviewConversationId} before comparing section scopes.
    return typeof candidate?.userId === 'string' && candidate.userId.trim().length > 0
        && isQaapProcessPreviewClaimIdentity(candidate);
}

/**
 * Work Hub can address one project through routing keys such as `ws:file:///…` or
 * `recent:file:///…`, while the preview registry deliberately stores the canonical workspace URI.
 * Strip only those UI routing prefixes; GitHub repo keys remain distinct legacy identities.
 */
export function normalizeQaapPreviewProjectId(value: string): string {
    const trimmed = value.trim();
    for (const prefix of ['ws:', 'recent:']) {
        if (trimmed.startsWith(prefix)) {
            const candidate = trimmed.slice(prefix.length);
            if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
                return candidate;
            }
        }
    }
    return trimmed;
}

/** Matches a registry project id against canonical roots and legacy Work Hub keys. */
export function qaapPreviewProjectIdMatches(
    previewProjectId: string,
    ...projectCandidates: Array<string | undefined>
): boolean {
    const normalizedPreviewId = normalizeQaapPreviewProjectId(previewProjectId);
    return projectCandidates.some(candidate => candidate !== undefined
        && normalizeQaapPreviewProjectId(candidate) === normalizedPreviewId);
}

/**
 * True when a live preview claim (identity or `/qaap-dev/:port`) belongs to this Work Hub project.
 * Prefer this over HTML `<title>` matching: vanilla `index.html` pages often use "Document",
 * "Landing", or no title at all, which would otherwise hide a healthy static preview.
 */
export function claimedPreviewCoordinatesMatchProject(options: {
    readonly probeProjectId: string | undefined;
    readonly projectId: string;
    readonly projectUri?: string;
    readonly cwdUri?: string;
    readonly projectName?: string;
}): boolean {
    const probeProjectId = options.probeProjectId?.trim();
    if (!probeProjectId) {
        return false;
    }
    return qaapPreviewProjectIdMatches(
        probeProjectId,
        options.projectId,
        options.projectUri,
        options.cwdUri,
    ) || qaapPreviewFileUriMatchesProjectName(probeProjectId, options.projectName);
}

/**
 * Skip-auth / local clones are often addressed as `github:owner/name` in Work Hub while the
 * preview registry stores `file:///…/owner/name`. Accept a file-URI claim whose last path
 * segment is the hub project name so Preview can mount the process that was just started.
 */
export function qaapPreviewFileUriMatchesProjectName(
    previewProjectId: string | undefined,
    projectName: string | undefined,
): boolean {
    const name = projectName?.trim().toLowerCase();
    if (!previewProjectId || !name) {
        return false;
    }
    const normalized = normalizeQaapPreviewProjectId(previewProjectId);
    if (!/^file:/i.test(normalized)) {
        return false;
    }
    try {
        const path = new URL(normalized).pathname.replace(/\/+$/, '');
        const base = path.split('/').filter(Boolean).pop()?.toLowerCase();
        return base === name;
    } catch {
        return false;
    }
}
