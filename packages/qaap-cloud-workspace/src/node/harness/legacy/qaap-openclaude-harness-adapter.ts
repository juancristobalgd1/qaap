// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapHarnessSpawnQuirks } from '../qaap-harness-adapter';
import { QaapClaudeFamilyHarnessAdapter } from './qaap-claude-family-harness-adapter';
import { QAAP_NO_HARNESS_SPAWN_QUIRKS } from './qaap-native-harness-adapter';

/** OpenClaude (retired from the picker, still in code): same stream-json protocol as Claude Code. */
export class QaapOpenClaudeHarnessAdapter extends QaapClaudeFamilyHarnessAdapter {

    override readonly spawnQuirks: QaapHarnessSpawnQuirks = {
        ...QAAP_NO_HARNESS_SPAWN_QUIRKS,
        emitsStreamJsonFinalResult: true,
    };

    constructor() {
        super('openclaude');
    }
}
