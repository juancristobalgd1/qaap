// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { readQaapDefaultAgentIdConfig } from '@theia/qaap-adapters/lib/common/qaap-default-agent-config';
import { QAAP_BUILTIN_AGENT_IDS, isUiHiddenVpsAgent } from './qaap-builtin-agents';

/** Backend environment variable that overrides the default agent (unset or unknown: first available harness). */
export const QAAP_DEFAULT_AGENT_ID_ENV = 'QAAP_DEFAULT_AGENT_ID';

/**
 * The configured default harness, or `undefined` when none is configured. Callers then pick the
 * first available harness (composer, routines, backend runner). A configured id that is unknown,
 * retired (including `qaiq`), or hidden on this runtime is ignored silently.
 */
export function resolveQaapDefaultAgentId(value: string | undefined): string | undefined {
    const id = value?.trim().toLowerCase();
    if (!id) {
        return undefined;
    }
    if (!QAAP_BUILTIN_AGENT_IDS.has(id) || isUiHiddenVpsAgent(id)) {
        return undefined;
    }
    return id;
}

/** Frontend default: the backend's announced value (from `/auth/config`), else `undefined`. */
export function getQaapDefaultAgentId(): string | undefined {
    return resolveQaapDefaultAgentId(readQaapDefaultAgentIdConfig());
}
