// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Fired on `window` by the Connect dialog once a harness sign-in is confirmed. Surfaces that keep their own
 * copy of the agent catalog (the right panel's side chat) listen to it and reload; the detail carries only the
 * agent id, never anything from the CLI's output.
 */
export const QAAP_AGENT_SIGNED_IN_EVENT = 'qaap-agent-signed-in';

export interface QaapAgentSignedInDetail {
    readonly agentId: string;
}
