// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { normalizeQaapPreviewConversationId } from '../common/qaap-preview-identity';

/**
 * Accepts a live claim only when it belongs to the open Work Hub section.
 *
 * Unscoped `/qaap-dev/api/current` returns the newest project claim, which can be a sibling
 * section. Callers must fetch with `conversationId` and must not fall back to the unscoped result.
 */
export function pickScopedPreviewClaim<T extends {
    readonly ready?: boolean;
    readonly previewUrl?: string;
    readonly conversationId?: string;
}>(claim: T | undefined, expectedConversationId: string | undefined): T | undefined {
    if (!claim?.ready || !claim.previewUrl) {
        return undefined;
    }
    if (!claim.conversationId) {
        return claim;
    }
    const expected = normalizeQaapPreviewConversationId(expectedConversationId);
    if (normalizeQaapPreviewConversationId(claim.conversationId) !== expected) {
        return undefined;
    }
    return claim;
}
