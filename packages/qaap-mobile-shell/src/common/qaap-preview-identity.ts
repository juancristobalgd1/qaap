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
 * Stable process coordinates for a multi-tenant preview. The authenticated backend supplies
 * `userId`; clients may never choose another user's namespace. Conversation/section state is
 * deliberately absent: two surfaces looking at the same live process must resolve the same URL.
 */
export interface QaapProcessPreviewIdentity {
    readonly userId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly processId: string;
}

/** Client-supplied process coordinates. `userId` is added server-side after authentication. */
export interface QaapProcessPreviewClaimIdentity {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly processId: string;
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

/**
 * DNS-label-safe identity derived from project + conversation + run. The readable prefixes help
 * operators, while the suffix prevents truncated UUIDs from collapsing onto one preview.
 */
export function buildQaapPreviewId(identity: QaapPreviewIdentity): string {
    if (isQaapProcessPreviewIdentity(identity)) {
        const source = `${identity.userId}\0${identity.workspaceId}\0${identity.projectId}\0${identity.processId}`;
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
    return typeof candidate?.userId === 'string' && candidate.userId.trim().length > 0
        && isQaapProcessPreviewClaimIdentity(candidate);
}
