// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import {
    QaapPreviewPortClaimResult,
    QaapPreviewPortClaimService,
} from '@theia/qaap-adapters/lib/browser/qaap-preview-port-claim-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { QAAP_DEV_PREVIEW_CLAIM_PATH } from '../common/qaap-dev-preview';

type QaapPreviewClaimFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Pick<Response, 'status'>>;

export async function requestQaapPreviewPortClaim(
    port: number,
    root: string,
    origin: string,
    fetcher: QaapPreviewClaimFetch = fetch,
): Promise<QaapPreviewPortClaimResult> {
    try {
        const response = await fetcher(`${origin.replace(/\/+$/, '')}${QAAP_DEV_PREVIEW_CLAIM_PATH}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port, root }),
        });
        if (response.status === 204) {
            return { kind: 'claimed' };
        }
        if (response.status === 409) {
            return { kind: 'conflict' };
        }
        return { kind: 'error', status: response.status };
    } catch {
        return { kind: 'error' };
    }
}

/**
 * Claims a dev-preview port for the current workspace. The backend remains authoritative:
 * only an exact 204 permits navigation, while conflicts and all other failures stay closed.
 */
@injectable()
export class QaapWorkspacePreviewPortClaimService implements QaapPreviewPortClaimService {

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected readonly pendingClaims = new Map<number, Promise<QaapPreviewPortClaimResult>>();

    async claim(port: number): Promise<QaapPreviewPortClaimResult> {
        const pending = this.pendingClaims.get(port);
        if (pending) {
            return pending;
        }
        const claim = this.doClaim(port);
        this.pendingClaims.set(port, claim);
        try {
            return await claim;
        } finally {
            if (this.pendingClaims.get(port) === claim) {
                this.pendingClaims.delete(port);
            }
        }
    }

    protected async doClaim(port: number): Promise<QaapPreviewPortClaimResult> {
        if (typeof window === 'undefined' || !window.location?.origin) {
            return { kind: 'error' };
        }
        try {
            const roots = await this.workspaceService.roots;
            const root = roots[0]?.resource?.toString();
            if (!root) {
                return { kind: 'error' };
            }
            return requestQaapPreviewPortClaim(port, root, window.location.origin);
        } catch {
            return { kind: 'error' };
        }
    }
}
