// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type { QaapHarnessPromptTransportProbe } from '../qaap-harness-adapter';
import { QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/** GitHub Copilot CLI: runs unchecked; the prompt flag is dropped and the prompt travels over stdin. */
export class QaapCopilotHarnessAdapter extends QaapNativeHarnessAdapter {

    constructor() {
        super('copilot');
    }

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        return probe.agentId === 'copilot' || probe.bin === 'copilot'
            ? { kind: 'plain-stdin', placeholder: 'omit-flag' }
            : undefined;
    }
}
