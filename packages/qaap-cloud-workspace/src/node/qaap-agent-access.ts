import type { QaapAgentAccessState, QaapAgentConnectionState } from '../common/qaap-agent-task';

/** Last known auth state of one agent for one owner, plus whether its probe has answered yet. */
export interface QaapAgentConnectionSnapshot {
    readonly connectionState: QaapAgentConnectionState;
    /** False while an auth probe is in flight; a settled `unknown` means the probe gave no clear answer. */
    readonly probeSettled: boolean;
}

/** Inputs of {@link resolveAgentAccess}; all of them are already known on the backend. */
export interface QaapAgentAccessInput {
    readonly agentId: string;
    readonly connectionState: QaapAgentConnectionState;
    /** False while the agent's auth probe is still running (no answer yet, not a failure). */
    readonly probeSettled: boolean;
    /** Qaap-hosted Codex is allowed for the owner (see {@link isHostedCodexEntitled}). */
    readonly hostedEntitled: boolean;
}

/** Subset of the billing entitlements that gates Qaap-hosted Codex. */
export interface QaapHostedCodexEntitlements {
    readonly hostedModels?: boolean;
    readonly creditsRemaining?: number;
}

/**
 * Qaap-hosted Codex needs a plan with hosted models and credits left. This is the single rule the
 * picker rows and the model catalog share; the turn-start billing gate keeps its own checks.
 */
export function isHostedCodexEntitled(entitlements: QaapHostedCodexEntitlements | undefined): boolean {
    return entitlements?.hostedModels === true && (entitlements.creditsRemaining ?? 0) > 0;
}

/**
 * One access answer for the picker row and the model list, so both cannot disagree: a signed-in or
 * sign-in-free agent is `session`; Codex with hosted entitlement is `hosted`; a known sign-out is
 * `none`; an unknown state becomes `none` only once its probe has settled, otherwise it stays
 * `unknown` (the row stays usable and no plan lock is shown while the answer is pending).
 */
export function resolveAgentAccess(input: QaapAgentAccessInput): QaapAgentAccessState {
    if (input.connectionState === 'connected' || input.connectionState === 'not-required') {
        return 'session';
    }
    if (input.agentId.trim().toLowerCase() === 'codex' && input.hostedEntitled) {
        return 'hosted';
    }
    if (input.connectionState === 'disconnected') {
        return 'none';
    }
    return input.probeSettled ? 'none' : 'unknown';
}
