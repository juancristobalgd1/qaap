// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type { QaapHarnessGateWiring, QaapHarnessPromptTransportProbe } from '../qaap-harness-adapter';
import { QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/**
 * Codex: a per-task `CODEX_HOME` overlay installs a PreToolUse hook that calls the HTTP gate; its own sandbox is
 * left on or turned off by the approval flags. The prompt is read from stdin when the prompt argument is `-`.
 */
export class QaapCodexHarnessAdapter extends QaapNativeHarnessAdapter {

    override readonly gateWiring: QaapHarnessGateWiring = 'codex-hook';

    constructor() {
        super('codex');
    }

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        return probe.agentId === 'codex' ? { kind: 'plain-stdin', placeholder: 'dash' } : undefined;
    }
}
