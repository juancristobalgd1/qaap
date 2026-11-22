// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type { QaapHarnessGateWiring, QaapHarnessPromptTransportProbe } from '../qaap-harness-adapter';
import { QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/** QAIQ (no longer an agent of Qaaq since #481, still resolvable): stream-json control protocol, prompt over stdin. */
export class QaapQaiqHarnessAdapter extends QaapNativeHarnessAdapter {

    override readonly gateWiring: QaapHarnessGateWiring = 'stdio-control';

    constructor() {
        super('qaiq');
    }

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        return probe.agentId === 'qaiq' ? { kind: 'plain-stdin', placeholder: 'omit' } : undefined;
    }
}
