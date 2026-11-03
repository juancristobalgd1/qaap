// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Process-wide default agent id the backend announced in `/qaap/api/auth/config` (`defaultAgentId`,
 * from `QAAP_DEFAULT_AGENT_ID`). Raw and unvalidated here: the shared resolver decides what it means.
 */
let announcedDefaultAgentId: string | undefined;

export function rememberQaapDefaultAgentIdConfig(agentId: string | undefined): void {
    announcedDefaultAgentId = agentId;
}

export function readQaapDefaultAgentIdConfig(): string | undefined {
    return announcedDefaultAgentId;
}
