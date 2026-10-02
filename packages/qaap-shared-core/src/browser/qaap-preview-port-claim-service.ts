// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import {
    QaapPreviewPortClaimResult,
    type QaapPreviewExecutionIdentity,
    QaapPreviewPortClaimService,
} from '@theia/qaap-adapters/lib/browser/qaap-preview-port-claim-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { QAAP_DEV_PREVIEW_CLAIM_PATH, QAAP_DEV_PREVIEW_RELEASE_PATH } from '../common/qaap-dev-preview';

type QaapPreviewClaimFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Pick<Response, 'status'> & Partial<Pick<Response, 'json'>>>;

export async function requestQaapPreviewPortClaim(
    port: number,
    root: string,
    origin: string,
    fetcher: QaapPreviewClaimFetch = fetch,
    identity?: QaapPreviewExecutionIdentity,
): Promise<QaapPreviewPortClaimResult> {
    try {
        const response = await fetcher(`${origin.replace(/\/+$/, '')}${QAAP_DEV_PREVIEW_CLAIM_PATH}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port, root, ...identity }),
        });
        if (response.status === 204) {
            return { kind: 'claimed' };
        }
        if (response.status === 200 && response.json) {
            const body = await response.json() as { previewId?: unknown; previewUrl?: unknown; port?: unknown };
            if (typeof body.previewId === 'string' && typeof body.previewUrl === 'string'
                && (body.port === undefined || Number.isInteger(body.port))) {
                return {
                    kind: 'claimed',
                    previewId: body.previewId,
                    previewUrl: body.previewUrl,
                    port: typeof body.port === 'number' ? body.port : undefined,
                };
            }
            return { kind: 'error', status: response.status };
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

    protected readonly pendingClaims = new Map<string, Promise<QaapPreviewPortClaimResult>>();

    async claim(port: number, identity?: QaapPreviewExecutionIdentity): Promise<QaapPreviewPortClaimResult> {
        const key = identity
            ? `${port}:${identity.workspaceId ?? ''}:${identity.projectId}:${identity.processId ?? ''}:${identity.conversationId ?? ''}:${identity.runId ?? ''}`
            : String(port);
        const pending = this.pendingClaims.get(key);
        if (pending) {
            return pending;
        }
        const claim = this.doClaim(port, identity);
        this.pendingClaims.set(key, claim);
        try {
            return await claim;
        } finally {
            if (this.pendingClaims.get(key) === claim) {
                this.pendingClaims.delete(key);
            }
        }
    }

    protected async doClaim(port: number, identity?: QaapPreviewExecutionIdentity): Promise<QaapPreviewPortClaimResult> {
        if (typeof window === 'undefined' || !window.location?.origin) {
            return { kind: 'error' };
        }
        try {
            const roots = identity?.root ? undefined : await this.workspaceService.roots;
            const root = identity?.root ?? roots?.[0]?.resource?.toString();
            if (!root) {
                return { kind: 'error' };
            }
            return requestQaapPreviewPortClaim(port, root, window.location.origin, fetch, identity);
        } catch {
            return { kind: 'error' };
        }
    }

    async release(previewId: string): Promise<boolean> {
        if (typeof window === 'undefined' || !window.location?.origin) {
            return false;
        }
        try {
            const response = await fetch(`${window.location.origin}${QAAP_DEV_PREVIEW_RELEASE_PATH}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ previewId }),
            });
            return response.status === 204 || response.status === 404;
        } catch {
            return false;
        }
    }
}
