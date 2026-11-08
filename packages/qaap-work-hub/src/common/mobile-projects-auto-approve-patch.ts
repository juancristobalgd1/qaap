// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** The Auto-approve switch and the approval policy are one setting; this is the PATCH both are saved with. */
export function buildAutoApprovePatch(autoApprove: boolean): { autoApprove: boolean; approvalPolicyId: 'approve-for-me' | 'request-approval' } {
    return { autoApprove, approvalPolicyId: autoApprove ? 'approve-for-me' : 'request-approval' };
}
