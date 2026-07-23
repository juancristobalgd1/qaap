// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_BUILTIN_AGENT_DEFINITIONS } from './qaap-builtin-agents';
import { LEGACY_OPENCLAUDE_AGENT_ID, QAIQ_AGENT_ID, migrateQaapProductAgentId } from './qaap-agent-task-client';

/**
 * Interactive TUI CLI binary for an agent id — the bare executable to type into a PTY,
 * not the headless `--print` / `exec --json` templates used by background task runs.
 */
export function resolveInteractiveAgentCliBin(agentId: string | undefined): string | undefined {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized) {
        return undefined;
    }
    if (normalized === QAIQ_AGENT_ID || normalized === LEGACY_OPENCLAUDE_AGENT_ID) {
        return 'qaiq';
    }
    const builtin = QAAP_BUILTIN_AGENT_DEFINITIONS.find(definition => definition.id === normalized);
    return builtin?.bin;
}
