// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { getSameOriginPreviewProxyPort } from './qaap-preview-url-utils';

export const QaapPreviewPortClaimService = Symbol('QaapPreviewPortClaimService');

export type QaapPreviewPortClaimResult =
    | { readonly kind: 'claimed' }
    | { readonly kind: 'conflict' }
    | { readonly kind: 'error'; readonly status?: number };

export interface QaapPreviewPortClaimService {
    claim(port: number): Promise<QaapPreviewPortClaimResult>;
}

/**
 * Safe fallback for products that load qaap-adapters without a preview-claim implementation.
 * A proxied preview must not navigate when its ownership cannot be established.
 */
@injectable()
export class UnavailableQaapPreviewPortClaimService implements QaapPreviewPortClaimService {
    async claim(_port: number): Promise<QaapPreviewPortClaimResult> {
        return { kind: 'error' };
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
