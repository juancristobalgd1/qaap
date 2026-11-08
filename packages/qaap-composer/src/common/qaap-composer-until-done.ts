// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Every composer submit is a goal loop: the agent keeps iterating, verifying and reviewing until
 * the goal is met. The composer no longer offers a mode or a goal toggle, so the mode is fixed.
 */
export const QAAP_COMPOSER_SUBMIT_MODE_ID = 'agent';

/**
 * Whether a submit starts a goal loop. Manual approval asks before each change and cannot run
 * unattended, so that approval keeps a single turn.
 */
export function resolveComposerUntilDoneForSubmit(approvalPolicyId: string | undefined): boolean {
    return approvalPolicyId !== 'request-approval';
}
