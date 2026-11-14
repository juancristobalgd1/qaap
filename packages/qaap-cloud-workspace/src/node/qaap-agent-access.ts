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
}

/**
 * One access answer for the picker row and the model list, so both cannot disagree: a signed-in or
 * sign-in-free agent is `session`; a known sign-out is `none`; an unknown state becomes `none` only
 * once its probe has settled, otherwise it stays `unknown` (the row stays usable and no lock is shown
 * while the answer is pending). Agents run on the owner's own sign-in or key; nothing is hosted.
 */
export function resolveAgentAccess(input: QaapAgentAccessInput): QaapAgentAccessState {
    if (input.connectionState === 'connected' || input.connectionState === 'not-required') {
        return 'session';
    }
    if (input.connectionState === 'disconnected') {
        return 'none';
    }
    return input.probeSettled ? 'none' : 'unknown';
}
