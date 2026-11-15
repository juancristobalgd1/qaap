// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Route under `QAAP_AGENT_TASK_API_PATH` where the frontend attests a finished CLI sign-in. */
export const QAAP_AGENT_SESSION_ATTEST_ROUTE = 'agent-session-attest';

/**
 * Harnesses whose sign-in has no verifiable status probe (Copilot CLI 1.0.x, Grok 1.0.x print no
 * machine-readable "logged in" answer). For them the CLI's own success line during the sign-in
 * dialog is the only evidence, so the frontend attests it and the backend remembers it for a while.
 * Every other harness is answered by its auth probe or its Settings credential, never by attestation.
 */
export const QAAP_SESSION_ATTESTATION_AGENT_IDS: readonly string[] = ['copilot', 'grok'];

/** True when `agentId` signs in without a verifiable probe and therefore accepts a session attestation. */
export function isQaapSessionAttestationAgent(agentId: string | undefined): boolean {
    const normalized = agentId?.trim().toLowerCase();
    return !!normalized && QAAP_SESSION_ATTESTATION_AGENT_IDS.includes(normalized);
}
