// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { hashString, isTheiaCoderAgent } from './qaap-agent-task-client';
import { nls } from '@theia/core/lib/common/nls';
import { resolveQaapHarnessCapabilities, type QaapWhenAskUnsupported } from './qaap-harness-capabilities';

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
 * How a harness that cannot ask behaves under "Ask before changes", or `undefined` when no downgrade or
 * warning applies (the harness can ask, the preset is not Ask before changes, or no harness is known).
 * Display-only: the stored preset and the backend request are not changed.
 */
export function resolveApprovalPolicyUnsupportedMode(
    policyId: QaapAgentApprovalPolicyId | undefined,
    agentId: string | undefined,
): QaapWhenAskUnsupported | undefined {
    // Without a harness there is nothing to describe: the stored preset stays as it is.
    if (policyId !== 'request-approval' || !agentId?.trim()) {
        return undefined;
    }
    const capabilities = resolveQaapHarnessCapabilities(agentId);
    return capabilities.canAsk ? undefined : capabilities.whenAskUnsupported;
}

/** True when the harness cannot ask before changes but the stored preset is Ask before changes. */
export function isApprovalPolicyUnsupportedByAgent(
    policyId: QaapAgentApprovalPolicyId | undefined,
    agentId: string | undefined,
): boolean {
    return resolveApprovalPolicyUnsupportedMode(policyId, agentId) !== undefined;
}

/**
 * Preset the user sees for a harness. Only a harness that runs every action unchecked is shown as
 * Autonomous mode; a harness that refuses gated actions keeps Ask before changes.
 */
export function resolveEffectiveAgentApprovalPolicyId(
    policyId: QaapAgentApprovalPolicyId | undefined,
    agentId: string | undefined,
): QaapAgentApprovalPolicyId | undefined {
    return resolveApprovalPolicyUnsupportedMode(policyId, agentId) === 'runs-unchecked' ? 'approve-for-me' : policyId;
}

/** Tooltip and warning text for a harness that cannot ask, by what it does instead. */
export function resolveApprovalPolicyUnsupportedText(agentLabel: string, mode: QaapWhenAskUnsupported): string {
    return mode === 'runs-unchecked'
        ? nls.localize(
            'qaap/mobileProjects/approvalPolicyUnsupportedRunsUnchecked',
            '{0} can\'t ask before changes yet; it runs every action without asking.',
            agentLabel,
        )
        : nls.localize(
            'qaap/mobileProjects/approvalPolicyUnsupportedRefuses',
            '{0} can\'t ask you yet; actions that need approval are refused.',
            agentLabel,
        );
}

/** Toolbar chip for the approval picker: the effective preset, plus a warning when the stored one differs. */
export interface QaapApprovalPolicyToolbarDisplay {
    readonly policy: QaapAgentApprovalPolicyOption;
    /** Set when the harness cannot ask; the chip shows this as its warning tooltip. */
    readonly unsupportedText?: string;
}

export function resolveApprovalPolicyToolbarDisplay(
    storedPolicyId: QaapAgentApprovalPolicyId,
    agent: { readonly id: string; readonly label: string } | undefined,
): QaapApprovalPolicyToolbarDisplay {
    const effectiveId = resolveEffectiveAgentApprovalPolicyId(storedPolicyId, agent?.id);
    const policy = resolveAgentApprovalPolicyOption(effectiveId);
    const mode = resolveApprovalPolicyUnsupportedMode(storedPolicyId, agent?.id);
    if (!agent || mode === undefined) {
        return { policy };
    }
    return { policy, unsupportedText: resolveApprovalPolicyUnsupportedText(agent.label, mode) };
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
