// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapHarnessSpawnQuirks } from '../qaap-harness-adapter';
import { QaapClaudeFamilyHarnessAdapter } from './qaap-claude-family-harness-adapter';
import { QAAP_NO_HARNESS_SPAWN_QUIRKS } from './qaap-native-harness-adapter';

/** Claude Code: control protocol on stdio (`canUseTool` to the gate), `--mcp-config` 0600 file for delegation. */
export class QaapClaudeHarnessAdapter extends QaapClaudeFamilyHarnessAdapter {

    override readonly spawnQuirks: QaapHarnessSpawnQuirks = {
        ...QAAP_NO_HARNESS_SPAWN_QUIRKS,
        // Subagent tools are allowed for Claude Code only; the gate still restricts which subagent types run.
        allowsSubagentTools: true,
        emitsStreamJsonFinalResult: true,
    };

    constructor() {
        super('claude');
    }
}
