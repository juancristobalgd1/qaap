// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { readQaapDefaultAgentIdConfig } from '@theia/qaap-adapters/lib/common/qaap-default-agent-config';
import { QAAP_BUILTIN_AGENT_IDS } from './qaap-builtin-agents';
import { isAgentHiddenOnHostedRuntime } from './qaap-hosted-agent-auth-policy';

/** Backend environment variable that overrides the default agent (unset or unknown: `qaiq`). */
export const QAAP_DEFAULT_AGENT_ID_ENV = 'QAAP_DEFAULT_AGENT_ID';
/** The default harness until it is changed on purpose. Do not inline this id anywhere else. */
export const QAAP_DEFAULT_AGENT_ID_FALLBACK = 'qaiq';

/**
 * The one source of truth for the default agent (composer, Work Hub routines, agent picker). A
 * configured id that is unknown, retired, or hidden on this hosted runtime falls back to `qaiq`.
 */
export function resolveQaapDefaultAgentId(value: string | undefined): string {
    const id = value?.trim().toLowerCase();
    if (!id) {
        return QAAP_DEFAULT_AGENT_ID_FALLBACK;
    }
    const known = id === QAAP_DEFAULT_AGENT_ID_FALLBACK || QAAP_BUILTIN_AGENT_IDS.has(id);
    if (!known || isAgentHiddenOnHostedRuntime(id)) {
        return QAAP_DEFAULT_AGENT_ID_FALLBACK;
    }
    return id;
}

/** Frontend default: the backend's announced value (from `/auth/config`), else `qaiq`. */
export function getQaapDefaultAgentId(): string {
    return resolveQaapDefaultAgentId(readQaapDefaultAgentIdConfig());
}
