// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { buildPiDefaultModelFlagShell } from '@theia/qaap-shared-core/lib/common/qaap-pi-default-model';
import { withPiPlanModeInstruction } from '../../../common/qaap-agent-readonly-workspace';
import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import { buildPiGateTemplateVars } from '../../qaap-tool-gate-pi-adapter';
import type { QaapHarnessGateWiring, QaapHarnessPromptTransportProbe, QaapHarnessSpawnQuirks } from '../qaap-harness-adapter';
import { QAAP_NO_HARNESS_SPAWN_QUIRKS, QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/** Pi: no permission system of its own; Qaap's `-e` extension routes every tool call through the HTTP gate. */
export class QaapPiHarnessAdapter extends QaapNativeHarnessAdapter {

    override readonly gateWiring: QaapHarnessGateWiring = 'pi-extension';

    override readonly spawnQuirks: QaapHarnessSpawnQuirks = {
        ...QAAP_NO_HARNESS_SPAWN_QUIRKS,
        watchesProviderErrors: true,
    };

    constructor() {
        super('pi');
    }

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        return probe.agentId === 'pi' ? { kind: 'plain-stdin', placeholder: 'omit' } : undefined;
    }

    /** Plan mode has no native read-only switch in Pi: the turn is told to plan instead. */
    override preparePrompt(agentId: string, prompt: string, interactionModeId: string | undefined): string {
        return withPiPlanModeInstruction(prompt, agentId, interactionModeId);
    }

    override extendTemplateVars(_agentId: string, vars: Record<string, string>): Record<string, string> {
        // No model chosen: Pi would pick its own (often a down free model). The product default is resolved by
        // the shell inside the Pi child, so it sees that child's HOME and pins (see buildPiDefaultModelFlagShell).
        const modelFlags = vars.model_flags || buildPiDefaultModelFlagShell();
        return { ...vars, model_flags: modelFlags, ...buildPiGateTemplateVars() };
    }
}
