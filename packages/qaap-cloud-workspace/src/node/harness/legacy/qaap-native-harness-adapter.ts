// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveQaapHarnessCapabilities, type QaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import type { QaapAntigravityCliBin } from '@theia/qaap-shared-core/lib/common/qaap-antigravity-cli';
import { createAgUiCliStreamEmitter, type QaapCliAgUiStreamEmitter } from '@theia/qaap-shared-core/lib/common/qaap-cli-ag-ui-stream';
import {
    createAgentStreamAccumulator,
    parseAgentLogForTranscript,
    type QaapAgentStreamAccumulator,
} from '@theia/qaap-shared-core/lib/common/qaap-cli-transcript-stream';
import { applyAgentApprovalPolicyToCommand, type QaapAgentApprovalFlagOptions } from '../../../common/qaap-agent-approval-flags';
import { formatEffortFlagsForAgent } from '../../../common/qaap-agent-effort-flags';
import { formatModelFlagsForAgent } from '../../../common/qaap-agent-model-flags';
import type { QaapQaiqModelBinding } from '../../../common/qaap-qaiq-model-binding';
import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type {
    QaapHarnessAdapter,
    QaapHarnessGateWiring,
    QaapHarnessParsedLog,
    QaapHarnessPromptTransportProbe,
    QaapHarnessSpawnQuirks,
} from '../qaap-harness-adapter';

type ChildEnvTask = Parameters<QaapHarnessAdapter['applyChildEnv']>[1];

/** Quirks of a harness that has none: the starting point of every adapter. */
export const QAAP_NO_HARNESS_SPAWN_QUIRKS: QaapHarnessSpawnQuirks = {
    removesStaleSnapshotLocks: false,
    watchesSignInWait: false,
    watchesFatalStderr: false,
    allowsSubagentTools: false,
    emitsStreamJsonFinalResult: false,
};

/**
 * Native adapter of a one-shot CLI harness (a command template run once per turn). The defaults are exactly what the
 * runner did for a harness with no special case, by delegating to the same functions it called before:
 * the approval flag rewriter, the model / effort flag formatters and the shared-core stream parsers. Those parsers
 * stay in `qaap-shared-core` because the browser replays logs with them too; the adapter is the node-side entry
 * point, not a second copy.
 *
 * Subclasses override the hooks their harness needs, and nothing else.
 */
export class QaapNativeHarnessAdapter implements QaapHarnessAdapter {

    readonly transport = 'native';

    readonly gateWiring: QaapHarnessGateWiring = 'none';

    readonly spawnQuirks: QaapHarnessSpawnQuirks = QAAP_NO_HARNESS_SPAWN_QUIRKS;

    constructor(readonly agentId: string) { }

    get capabilities(): QaapHarnessCapabilities {
        return resolveQaapHarnessCapabilities(this.agentId);
    }

    matchPromptTransport(_probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        return undefined;
    }

    preparePrompt(_agentId: string, prompt: string, _interactionModeId: string | undefined): string {
        return prompt;
    }

    extendTemplateVars(_agentId: string, vars: Record<string, string>): Record<string, string> {
        return vars;
    }

    applyApprovalPolicy(command: string, options: QaapAgentApprovalFlagOptions): string {
        return applyAgentApprovalPolicyToCommand(command, options);
    }

    formatModelFlags(agentId: string, binding: QaapQaiqModelBinding, antigravityBin?: QaapAntigravityCliBin): string {
        return formatModelFlagsForAgent(agentId, binding, antigravityBin);
    }

    formatEffortFlags(agentId: string, modelId: string | undefined, effort: string | undefined): string {
        return formatEffortFlagsForAgent(agentId, modelId, effort);
    }

    applyChildEnv(_env: NodeJS.ProcessEnv, _task: ChildEnvTask): void {
        // No harness-specific env.
    }

    applyPermissionEnv(_env: NodeJS.ProcessEnv, _task: ChildEnvTask): void {
        // The harness has no permission env of its own.
    }

    createStreamAccumulator(agentId: string): QaapAgentStreamAccumulator | undefined {
        return createAgentStreamAccumulator(agentId);
    }

    createAgUiEmitter(agentId: string): QaapCliAgUiStreamEmitter | undefined {
        return createAgUiCliStreamEmitter(agentId);
    }

    parseLogForTranscript(agentId: string, log: string): QaapHarnessParsedLog {
        return parseAgentLogForTranscript(agentId, log);
    }
}
