// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { localizeAgentTenantTerminalLoginMessage } from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import { QAAP_AGY_TUI_LOGIN_COMMAND } from '@theia/qaap-shared-core/lib/common/qaap-agent-tui-command';
import type { QaapAgentLoginFlowState } from './qaap-agent-login-flow';

/** Link deadline of the agy sign-in: the CLI draws its picker, gets Enter and prints the URL within seconds. */
export const QAAP_AGY_LOGIN_CHALLENGE_TIMEOUT_MS = 20_000;

/**
 * What the Connect dialog shows for a failed agy sign-in.
 *
 * - The link never appeared (silence, an unexpected question, the CLI ended): the Qaap Desktop instructions, never a
 *   broken link and never the CLI's raw output.
 * - The link was shown but the sign-in did not finish in time: "Sign-in timed out. Try again." Retry starts again.
 *
 * The output tail is always dropped: after the link appeared it holds the (wrapped) authorization URL, which carries
 * the OAuth `state` and must not be echoed back into the page. Failures that are not about the sign-in itself
 * (terminal could not start, no project, install) keep their own copy.
 */
export function presentAgyLoginFailure(
    state: Extract<QaapAgentLoginFlowState, { phase: 'failed' }>,
    agentLabel: string,
): Extract<QaapAgentLoginFlowState, { phase: 'failed' }> {
    switch (state.reason) {
        case 'sign-in-expired':
            return {
                phase: 'failed',
                reason: state.reason,
                tail: [],
                message: nls.localize('qaap/agentLogin/antigravitySignInTimedOut', 'Sign-in timed out. Try again.'),
            };
        case 'timeout':
        case 'waiting-for-input':
        case 'exited':
        case 'rejected':
            return {
                phase: 'failed',
                reason: state.reason,
                tail: [],
                message: localizeAgentTenantTerminalLoginMessage(agentLabel, QAAP_AGY_TUI_LOGIN_COMMAND),
            };
        default:
            return { ...state, tail: [] };
    }
}
