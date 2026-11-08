// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapAgentEffort } from '@theia/qaap-shared-core/lib/common/qaap-agent-effort';

/**
 * CLI flags that set reasoning effort, appended to the `{model_flags}` placeholder.
 * Empty when the harness/model takes no effort setting or the level is not supported by it.
 */
export function formatEffortFlagsForAgent(agentId: string, modelId: string | undefined, level: string | undefined): string {
    const effort = QaapAgentEffort.normalize(agentId, modelId, level);
    if (!effort) {
        return '';
    }
    switch (agentId.trim().toLowerCase()) {
        case 'claude':
            return `--effort ${effort}`;
        case 'codex':
            return `-c model_reasoning_effort=${effort}`;
        case 'opencode':
            return `--variant ${effort}`;
        case 'pi':
            return `--thinking ${effort}`;
        default:
            return '';
    }
}
