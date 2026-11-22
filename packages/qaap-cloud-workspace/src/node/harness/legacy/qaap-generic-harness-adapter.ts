// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type { QaapHarnessPromptTransportProbe } from '../qaap-harness-adapter';
import { QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/**
 * Adapter of every id without a dedicated one (custom agents, `QAAP_AGENT_COMMAND`, harness instances): it decides
 * the prompt transport from the command template and keeps every other hook at its default.
 */
export class QaapGenericHarnessAdapter extends QaapNativeHarnessAdapter {

    constructor() {
        super('generic');
    }

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        const template = probe.template ?? '';
        if (template.includes('{prompt}')) {
            if (/(?:-p|--prompt|--single|-t|-q|--message|--text)\s+\{prompt\}/.test(template)) {
                return { kind: 'plain-stdin', placeholder: 'dash' };
            }
            return { kind: 'plain-stdin', placeholder: 'omit' };
        }
        return { kind: 'argv' };
    }
}
