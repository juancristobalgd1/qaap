// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type { QaapHarnessPromptTransportProbe } from '../qaap-harness-adapter';
import { QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/**
 * A harness with no special case beyond how it receives the prompt on stdin: the retired Qwen, Kimi, Goose, Hermes
 * and OpenClaw CLIs, which stay resolvable from custom command templates.
 */
export class QaapStdinPromptHarnessAdapter extends QaapNativeHarnessAdapter {

    constructor(agentId: string, protected readonly promptTransport: QaapAgentPromptTransport) {
        super(agentId);
    }

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        return probe.agentId === this.agentId ? this.promptTransport : undefined;
    }
}
