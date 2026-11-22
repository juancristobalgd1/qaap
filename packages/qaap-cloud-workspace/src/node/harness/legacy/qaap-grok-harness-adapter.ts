// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type { QaapHarnessPromptTransportProbe } from '../qaap-harness-adapter';
import { QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/** Grok CLI: runs unchecked and refuses piped input, so the prompt goes in a private file (`--prompt-file`). */
export class QaapGrokHarnessAdapter extends QaapNativeHarnessAdapter {

    constructor() {
        super('grok');
    }

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        return probe.agentId === 'grok' || probe.bin === 'grok' ? { kind: 'prompt-file', flag: '--prompt-file' } : undefined;
    }
}
