// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type { QaapHarnessPromptTransportProbe } from '../qaap-harness-adapter';
import { QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/** Cursor CLI (`cursor-agent` or `agent`): runs unchecked (no gate); the prompt travels over stdin. */
export class QaapCursorHarnessAdapter extends QaapNativeHarnessAdapter {

    constructor() {
        super('cursor');
    }

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        return probe.agentId === 'cursor' || probe.bin === 'cursor-agent' || probe.bin === 'agent'
            ? { kind: 'plain-stdin', placeholder: 'omit' }
            : undefined;
    }
}
