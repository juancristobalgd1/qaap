// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { hashString, isTheiaCoderAgent } from './qaap-agent-task-client';
import { nls } from '@theia/core/lib/common/nls';
import { resolveQaapHarnessCapabilities } from './qaap-harness-capabilities';

const SELECTED_APPROVAL_POLICY_STORAGE_KEY = 'qaap.mobile.projects.agentApprovalPolicy';
const LEGACY_APPROVAL_POLICY_STORAGE_KEY = 'qaap.mobile.projects.codexApprovalPolicy';

/** Agent approval presets shown in the sticky composer controls row. */
export type QaapAgentApprovalPolicyId = 'request-approval' | 'approve-for-me' | 'full-access';

export interface QaapAgentApprovalPolicyOption {
    readonly id: QaapAgentApprovalPolicyId;
    readonly label: string;
    readonly description: string;
    /** Single codicon shown on the toolbar trigger button. */
    readonly toolbarIconClass: string;
    /** Primary codicon in the bottom-sheet row. */
    readonly sheetIconClass: string;
}

export const QAAP_AGENT_APPROVAL_POLICIES: readonly QaapAgentApprovalPolicyOption[] = [
    {
        id: 'request-approval',
        label: nls.localize('qaap/mobileProjects/approvalPolicyRequest', 'Ask before changes'),
        description: nls.localize(
            'qaap/mobileProjects/approvalPolicyRequestHint',
            'Ask before file changes.',
        ),
        // No `codicon-hand` in the bundled set; debug-pause is the closest "stop and wait" glyph.
        toolbarIconClass: 'codicon-debug-pause',
        sheetIconClass: 'codicon-debug-pause',
    },
    {
        id: 'approve-for-me',
        label: nls.localize('qaap/mobileProjects/approvalPolicyAuto', 'Autonomous mode'),
        description: nls.localize(
            'qaap/mobileProjects/approvalPolicyAutoHint',
            'Ask when there\'s risk.',
        ),
        toolbarIconClass: 'codicon-workspace-trusted',
        sheetIconClass: 'codicon-workspace-trusted',
    },
    {
        id: 'full-access',
        label: nls.localize('qaap/mobileProjects/approvalPolicyFull', 'Full access'),
        description: nls.localize(
            'qaap/mobileProjects/approvalPolicyFullHint',
            'Run with fewer confirmations.',
        ),
        toolbarIconClass: 'codicon-workspace-untrusted',
        sheetIconClass: 'codicon-workspace-untrusted',
    },
];

export const DEFAULT_AGENT_APPROVAL_POLICY_ID: QaapAgentApprovalPolicyId = 'approve-for-me';

/** VPS / background agents expose the approval picker; local Coder chat does not. */
export function agentSupportsApprovalPolicy(agentId: string | undefined): boolean {
    return !!agentId && !isTheiaCoderAgent(agentId);
}

function scopedApprovalPolicyStorageKey(cwd: string): string {
    return `${SELECTED_APPROVAL_POLICY_STORAGE_KEY}.${hashString(cwd)}`;
}

function scopedLegacyApprovalPolicyStorageKey(cwd: string): string {
    return `${LEGACY_APPROVAL_POLICY_STORAGE_KEY}.${hashString(cwd)}`;
}

export function readStoredAgentApprovalPolicy(cwd: string | undefined): QaapAgentApprovalPolicyId | undefined {
    if (!cwd) {
        return undefined;
    }
    try {
        const raw = window.localStorage.getItem(scopedApprovalPolicyStorageKey(cwd))
            ?? window.localStorage.getItem(scopedLegacyApprovalPolicyStorageKey(cwd));
        return isAgentApprovalPolicyId(raw) ? raw : undefined;
    } catch {
        return undefined;
    }
}

export function writeStoredAgentApprovalPolicy(cwd: string | undefined, policyId: QaapAgentApprovalPolicyId): void {
    if (!cwd) {
        return;
    }
    try {
        window.localStorage.setItem(scopedApprovalPolicyStorageKey(cwd), policyId);
    } catch {
        /* session-only */
    }
}

export function reconcileAgentApprovalPolicyId(
    current: QaapAgentApprovalPolicyId | undefined,
    cwd: string | undefined,
): QaapAgentApprovalPolicyId {
    if (current && QAAP_AGENT_APPROVAL_POLICIES.some(option => option.id === current)) {
        return current;
    }
    const stored = readStoredAgentApprovalPolicy(cwd);
    if (stored) {
        return stored;
    }
    return DEFAULT_AGENT_APPROVAL_POLICY_ID;
}

/**
 * True when the stored preset is "Ask before changes" but the harness cannot block for an ask. Such a
 * harness effectively runs in Autonomous mode. This is display-only: the stored preset and the backend
 * request are not changed.
 */
export function isApprovalPolicyUnsupportedByAgent(
    policyId: QaapAgentApprovalPolicyId | undefined,
    agentId: string | undefined,
): boolean {
    // Without a harness there is nothing to downgrade: the stored preset stays as it is.
    if (!agentId?.trim()) {
        return false;
    }
    return policyId === 'request-approval' && !resolveQaapHarnessCapabilities(agentId).canAsk;
}

/** Preset the user sees for a harness: the stored preset, or Autonomous mode where the harness cannot ask. */
export function resolveEffectiveAgentApprovalPolicyId(
    policyId: QaapAgentApprovalPolicyId | undefined,
    agentId: string | undefined,
): QaapAgentApprovalPolicyId | undefined {
    return isApprovalPolicyUnsupportedByAgent(policyId, agentId) ? 'approve-for-me' : policyId;
}

/** Tooltip and warning text shown beside the effective preset when the harness cannot ask. */
export function resolveApprovalPolicyUnsupportedText(agentLabel: string): string {
    return nls.localize(
        'qaap/mobileProjects/approvalPolicyRequestUnsupportedShort',
        '{0} can\'t ask before changes yet.',
        agentLabel,
    );
}

/** Toolbar chip for the approval picker: the effective preset, plus a warning when the stored one differs. */
export interface QaapApprovalPolicyToolbarDisplay {
    readonly policy: QaapAgentApprovalPolicyOption;
    /** Set when the stored preset is not what the harness runs; the chip shows this as its tooltip. */
    readonly unsupportedText?: string;
}

export function resolveApprovalPolicyToolbarDisplay(
    storedPolicyId: QaapAgentApprovalPolicyId,
    agent: { readonly id: string; readonly label: string } | undefined,
): QaapApprovalPolicyToolbarDisplay {
    const effectiveId = resolveEffectiveAgentApprovalPolicyId(storedPolicyId, agent?.id);
    const policy = resolveAgentApprovalPolicyOption(effectiveId);
    if (!agent || !isApprovalPolicyUnsupportedByAgent(storedPolicyId, agent.id)) {
        return { policy };
    }
    return { policy, unsupportedText: resolveApprovalPolicyUnsupportedText(agent.label) };
}

export function resolveAgentApprovalPolicyOption(
    policyId: QaapAgentApprovalPolicyId | undefined,
): QaapAgentApprovalPolicyOption {
    return QAAP_AGENT_APPROVAL_POLICIES.find(option => option.id === policyId)
        ?? QAAP_AGENT_APPROVAL_POLICIES.find(option => option.id === DEFAULT_AGENT_APPROVAL_POLICY_ID)!;
}

/** Maps the UI preset to the VPS conversation auto-approve flag. */
export function resolveAutoApproveFromApprovalPolicy(policyId: QaapAgentApprovalPolicyId): boolean {
    return policyId !== 'request-approval';
}

/**
 * Resolves auto-approve for the next VPS submit from the composer approval picker.
 * When the picker is shown, always returns a boolean so tasks get YOLO flags when appropriate.
 */
export function resolveComposerAutoApprove(
    showApprovalPolicy: boolean,
    policyId: QaapAgentApprovalPolicyId | undefined,
    cwd: string | undefined,
): boolean | undefined {
    if (!showApprovalPolicy) {
        return undefined;
    }
    const policy = reconcileAgentApprovalPolicyId(policyId, cwd);
    return resolveAutoApproveFromApprovalPolicy(policy);
}

function isAgentApprovalPolicyId(value: string | null | undefined): value is QaapAgentApprovalPolicyId {
    return value === 'request-approval' || value === 'approve-for-me' || value === 'full-access';
}
