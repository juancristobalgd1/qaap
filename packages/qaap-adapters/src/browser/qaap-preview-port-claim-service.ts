// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { getSameOriginPreviewProxyPort } from './qaap-preview-url-utils';

export const QaapPreviewPortClaimService = Symbol('QaapPreviewPortClaimService');

export type QaapPreviewPortClaimResult =
    | { readonly kind: 'claimed'; readonly previewId?: string; readonly previewUrl?: string; readonly port?: number }
    | { readonly kind: 'conflict' }
    | { readonly kind: 'error'; readonly status?: number };

export interface QaapPreviewPortClaimService {
    claim(port: number, identity?: QaapPreviewExecutionIdentity): Promise<QaapPreviewPortClaimResult>;
    release?(previewId: string): Promise<boolean>;
}

export interface QaapPreviewExecutionIdentity {
    readonly projectId: string;
    /** Canonical project/workspace URI. Required by process-scoped VPS reservations. */
    readonly workspaceId?: string;
    /** Logical UUID generated before one concrete dev process starts. */
    readonly processId?: string;
    /** Exact root proved by the backend ownership guard; avoids hosted `/workspace` fallback. */
    readonly root?: string;
    /** Legacy turn-scoped fields accepted for already persisted preview links. */
    readonly conversationId?: string;
    readonly runId?: string;
    /** OS PID of the terminal shell running the dev process, attached once node-pty resolves it. */
    readonly osProcessId?: number;
}

/**
 * Safe fallback for products that load qaap-adapters without a preview-claim implementation.
 * A proxied preview must not navigate when its ownership cannot be established.
 */
@injectable()
export class UnavailableQaapPreviewPortClaimService implements QaapPreviewPortClaimService {
    async claim(_port: number, _identity?: QaapPreviewExecutionIdentity): Promise<QaapPreviewPortClaimResult> {
        return { kind: 'error' };
    }

    async release(_previewId: string): Promise<boolean> {
        return false;
    }
}

export interface QaapExplicitPreviewNavigationResult {
    readonly kind: 'navigated' | 'conflict' | 'error';
    readonly status?: number;
}

/**
 * Claims same-origin `/qaap-dev/:port` targets before navigation. All other URLs navigate
 * immediately without consulting the claim service.
 */
export async function navigateExplicitPreviewUrl(
    normalizedLocation: string,
    claimService: QaapPreviewPortClaimService,
    navigate: (location: string) => Promise<void> | void,
    publicOrigin?: string,
): Promise<QaapExplicitPreviewNavigationResult> {
    const port = getSameOriginPreviewProxyPort(normalizedLocation, publicOrigin);
    if (port === undefined) {
        await navigate(normalizedLocation);
        return { kind: 'navigated' };
    }
    const claim = await claimService.claim(port);
    if (claim.kind !== 'claimed') {
        return claim;
    }
    await navigate(normalizedLocation);
    return { kind: 'navigated' };
}
