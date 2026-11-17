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
    /** False while the agent's auth probe is still running (no answer yet, not a failure). Not used for the answer. */
    readonly probeSettled: boolean;
}

/**
 * One access answer for the picker row and the model list, so both cannot disagree: a signed-in or
 * sign-in-free agent is `session`; a positive sign-out (probe answer or a rejected session) is `none`;
 * anything else is `unknown`, settled or not. A probe that timed out or printed nothing readable, and a
 * harness that cannot report its session at all, are not a sign-out: they fail open (the models stay
 * selectable and the run surfaces the harness's own sign-in). `probeSettled` only tells `checking` from
 * `unknown` later on (QaapHarnessModelAvailability.session). Agents run on the owner's own sign-in or key.
 */
export function resolveAgentAccess(input: QaapAgentAccessInput): QaapAgentAccessState {
    if (input.connectionState === 'connected' || input.connectionState === 'not-required') {
        return 'session';
    }
    if (input.connectionState === 'disconnected') {
        return 'none';
    }
    return 'unknown';
}
