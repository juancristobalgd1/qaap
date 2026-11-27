// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { fetchQaapGetWithTransientRetry } from '@theia/qaap-adapters/lib/common/qaap-transient-get';
import { dedupeInFlight } from './qaap-in-flight-dedupe';

export const QAAP_AGENT_APPROVAL_API_PATH = '/qaap/api/agent-approvals';

export type QaapAgentApprovalKind = 'tool' | 'prompt';

export interface QaapAgentApprovalRequestDTO {
    readonly id: string;
    readonly conversationId: string;
    readonly taskId?: string;
    readonly cwd: string;
    readonly agentId: string;
    readonly conversationTitle: string;
    readonly kind: QaapAgentApprovalKind;
    readonly toolName?: string;
    readonly toolUseId?: string;
    readonly summary: string;
    readonly detail?: string;
    readonly createdAt: number;
}

export interface QaapAgentApprovalListResponseDTO {
    readonly approvals: QaapAgentApprovalRequestDTO[];
}

export interface QaapAgentApprovalActionResponseDTO {
    readonly ok: boolean;
    readonly error?: string;
    /** The turn that owned the approval ended; the card is stale and should simply go away. */
    readonly expired?: boolean;
}

/** Pending list requests in flight, keyed by query: concurrent pollers share one request. */
const approvalFetchesInFlight = new Map<string, Promise<QaapAgentApprovalRequestDTO[]>>();

/**
 * Approval ids the user has already clicked Allow/Deny on. Kept for a short TTL so an overlapping
 * background poll that started before the click cannot flash a dismissed approval card back on screen.
 */
const OPTIMISTIC_APPROVAL_TTL_MS = 15_000;
const optimisticallyResolvedApprovals = new Map<string, number>();

function pruneOptimisticallyResolvedApprovals(now = Date.now()): void {
    for (const [id, expiresAt] of optimisticallyResolvedApprovals) {
        if (expiresAt <= now) {
            optimisticallyResolvedApprovals.delete(id);
        }
    }
}

export function markAgentApprovalOptimisticallyResolved(id: string, now = Date.now()): void {
    pruneOptimisticallyResolvedApprovals(now);
    if (id.trim()) {
        optimisticallyResolvedApprovals.set(id, now + OPTIMISTIC_APPROVAL_TTL_MS);
    }
}

export function unmarkAgentApprovalOptimisticallyResolved(id: string): void {
    optimisticallyResolvedApprovals.delete(id);
}

export function filterOptimisticallyResolvedApprovals(
    approvals: readonly QaapAgentApprovalRequestDTO[],
    now = Date.now(),
): QaapAgentApprovalRequestDTO[] {
    pruneOptimisticallyResolvedApprovals(now);
    if (optimisticallyResolvedApprovals.size === 0) {
        return [...approvals];
    }
    return approvals.filter(approval => !optimisticallyResolvedApprovals.has(approval.id));
}

export function resetOptimisticallyResolvedApprovalsForTests(): void {
    optimisticallyResolvedApprovals.clear();
}

export function fetchAgentApprovals(cwd?: string): Promise<QaapAgentApprovalRequestDTO[]> {
    const query = cwd?.trim() ? `?cwd=${encodeURIComponent(cwd)}` : '';
    return dedupeInFlight(approvalFetchesInFlight, query, async () => {
        const response = await fetchQaapGetWithTransientRetry(`${QAAP_AGENT_APPROVAL_API_PATH}${query}`, { credentials: 'include' });
        if (!response.ok) {
            throw new Error(response.statusText);
        }
        const body = await response.json() as QaapAgentApprovalListResponseDTO;
        return filterOptimisticallyResolvedApprovals(body.approvals ?? []);
    });
}

export async function approveAgentRequest(id: string): Promise<QaapAgentApprovalActionResponseDTO> {
    const response = await fetch(`${QAAP_AGENT_APPROVAL_API_PATH}/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        credentials: 'include',
    });
    const body = await response.json() as QaapAgentApprovalActionResponseDTO;
    if (!response.ok && !body.error) {
        throw new Error(response.statusText);
    }
    return body;
}

export async function rejectAgentRequest(id: string): Promise<QaapAgentApprovalActionResponseDTO> {
    const response = await fetch(`${QAAP_AGENT_APPROVAL_API_PATH}/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        credentials: 'include',
    });
    const body = await response.json() as QaapAgentApprovalActionResponseDTO;
    if (!response.ok && !body.error) {
        throw new Error(response.statusText);
    }
    return body;
}
