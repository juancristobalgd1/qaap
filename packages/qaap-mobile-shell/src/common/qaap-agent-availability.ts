// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { QAIQ_AGENT_ID } from './qaap-agent-task-client';

/** True when the VPS task runner reports at least one configured coding agent. */
export function isVpsAgentBackendConfigured(agentConfigured: boolean | undefined): boolean {
    return agentConfigured === true;
}

/** User-facing copy when no VPS agent CLI is available on the server. */
export function localizeNoVpsAgentConfiguredMessage(): string {
    return nls.localize(
        'qaap/mobileProjects/noVpsAgentConfigured',
        'No coding agent is configured on this server. Install QAIQ (default), or set QAAP_AGENT_COMMAND, then restart the backend.',
    );
}

/** Shorter banner shown above the sticky composer. */
export function localizeNoVpsAgentConfiguredBanner(): string {
    return nls.localize(
        'qaap/mobileProjects/noVpsAgentConfiguredBanner',
        'QAIQ is not available on this server. Install QAIQ or configure QAAP_AGENT_COMMAND, then restart.',
    );
}

/** Default agent id for product copy and onboarding. */
export function qaapDefaultAgentProductId(): string {
    return QAIQ_AGENT_ID;
}
