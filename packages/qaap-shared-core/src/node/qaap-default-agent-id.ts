// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_DEFAULT_AGENT_ID_ENV, resolveQaapDefaultAgentId } from '../common/qaap-default-agent-id';

/**
 * Backend default agent: `QAAP_DEFAULT_AGENT_ID` when it names a known, enabled harness, else
 * `undefined` (the first available harness is used).
 */
export function readBackendDefaultAgentId(env: NodeJS.ProcessEnv = process.env): string | undefined {
    return resolveQaapDefaultAgentId(env[QAAP_DEFAULT_AGENT_ID_ENV]);
}
