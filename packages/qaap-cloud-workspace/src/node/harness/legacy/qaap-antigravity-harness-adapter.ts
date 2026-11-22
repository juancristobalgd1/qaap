// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type { QaapHarnessPromptTransportProbe, QaapHarnessSpawnQuirks } from '../qaap-harness-adapter';
import { QAAP_NO_HARNESS_SPAWN_QUIRKS, QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/** Antigravity (`agy`, or the Gemini CLI as fallback): runs unchecked; agy takes the prompt in argv. */
export class QaapAntigravityHarnessAdapter extends QaapNativeHarnessAdapter {

    override readonly spawnQuirks: QaapHarnessSpawnQuirks = {
        ...QAAP_NO_HARNESS_SPAWN_QUIRKS,
        watchesSignInWait: true,
    };

    constructor() {
        super('antigravity');
    }

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        // agy reads no prompt from stdin in text mode (verified with 1.5.9), so its prompt travels in argv.
        if (probe.bin === 'agy' || (probe.bin === undefined && probe.agentId === 'antigravity')) {
            return { kind: 'argv-prompt' };
        }
        if (probe.agentId === 'antigravity' || probe.bin === 'gemini' || probe.bin === 'antigravity') {
            return probe.bin === 'gemini'
                ? { kind: 'plain-stdin', placeholder: 'omit-flag' }
                : { kind: 'plain-stdin', placeholder: 'dash' };
        }
        return undefined;
    }
}
