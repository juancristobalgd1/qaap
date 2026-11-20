// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_BUILTIN_AGENT_DEFINITIONS } from './qaap-builtin-agents';

/** Route under `QAAP_AGENT_TASK_API_PATH` where the frontend attests a finished CLI sign-in. */
export const QAAP_AGENT_SESSION_ATTEST_ROUTE = 'agent-session-attest';

/**
 * Harnesses whose sign-in has no reliable signed-out probe (Copilot CLI 1.0.x may authenticate via
 * OS keyring, `gh auth`, or `~/.copilot/config.json` and prints no machine-readable status). For
 * them the CLI's own success line during the sign-in dialog is attested so the backend remembers
 * the active session. Derived from {@link QAAP_BUILTIN_AGENT_DEFINITIONS} so declarations and
 * runtime never drift apart.
 */
export const QAAP_SESSION_ATTESTATION_AGENT_IDS: readonly string[] = QAAP_BUILTIN_AGENT_DEFINITIONS
    .filter(definition => definition.sessionCheck === 'attestation')
    .map(definition => definition.id);

/** True when `agentId` signs in without a verifiable probe and therefore accepts a session attestation. */
export function isQaapSessionAttestationAgent(agentId: string | undefined): boolean {
    const normalized = agentId?.trim().toLowerCase();
    return !!normalized && QAAP_SESSION_ATTESTATION_AGENT_IDS.includes(normalized);
}
