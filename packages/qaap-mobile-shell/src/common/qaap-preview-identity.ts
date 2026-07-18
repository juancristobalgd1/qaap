// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Stable execution coordinates. A preview belongs to one project turn, never to a bare port. */
export interface QaapPreviewIdentity {
    readonly projectId: string;
    readonly conversationId: string;
    readonly runId: string;
}

export interface QaapResolvedPreviewIdentity extends QaapPreviewIdentity {
    readonly previewId: string;
}

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

/** Small deterministic suffix; the full coordinates remain authoritative in the backend record. */
function hashPreviewIdentity(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36).padStart(7, '0').slice(-7);
}

/**
 * DNS-label-safe identity derived from project + conversation + run. The readable prefixes help
 * operators, while the suffix prevents truncated UUIDs from collapsing onto one preview.
 */
export function buildQaapPreviewId(identity: QaapPreviewIdentity): string {
    const source = `${identity.projectId}\0${identity.conversationId}\0${identity.runId}`;
    return [
        'p', normalizePreviewIdPart(identity.projectId),
        'c', normalizePreviewIdPart(identity.conversationId),
        'r', normalizePreviewIdPart(identity.runId),
        hashPreviewIdentity(source),
    ].join('-');
}

export function resolveQaapPreviewIdentity(identity: QaapPreviewIdentity): QaapResolvedPreviewIdentity {
    return { ...identity, previewId: buildQaapPreviewId(identity) };
}

export function isQaapPreviewId(value: string | undefined): value is string {
    return typeof value === 'string' && value.length <= 63 && PREVIEW_ID_PATTERN.test(value);
}

export function isQaapPreviewIdentity(value: Partial<QaapPreviewIdentity>): value is QaapPreviewIdentity {
    return typeof value.projectId === 'string' && value.projectId.trim().length > 0
        && typeof value.conversationId === 'string' && value.conversationId.trim().length > 0
        && typeof value.runId === 'string' && value.runId.trim().length > 0;
}
