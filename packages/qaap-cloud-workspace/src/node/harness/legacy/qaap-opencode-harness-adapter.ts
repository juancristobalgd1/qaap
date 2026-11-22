// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveOpencodePermissionEnv } from '../../../common/qaap-agent-approval-flags';
import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type { QaapHarnessGateWiring, QaapHarnessPromptTransportProbe, QaapHarnessSpawnQuirks } from '../qaap-harness-adapter';
import { QAAP_NO_HARNESS_SPAWN_QUIRKS, QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/** OpenCode: Qaap's plugin (`OPENCODE_CONFIG_CONTENT`) awaits the HTTP gate in `tool.execute.before`. */
export class QaapOpencodeHarnessAdapter extends QaapNativeHarnessAdapter {

    override readonly gateWiring: QaapHarnessGateWiring = 'opencode-plugin';

    override readonly spawnQuirks: QaapHarnessSpawnQuirks = {
        ...QAAP_NO_HARNESS_SPAWN_QUIRKS,
        removesStaleSnapshotLocks: true,
        watchesFatalStderr: true,
    };

    constructor() {
        super('opencode');
    }

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        return probe.agentId === 'opencode' ? { kind: 'plain-stdin', placeholder: 'omit' } : undefined;
    }

    /**
     * OpenCode allows every tool by default; gate it explicitly unless the run is meant to be ungated
     * (security: "Request approval" must never execute shell commands silently).
     */
    override applyPermissionEnv(env: NodeJS.ProcessEnv, task: Parameters<QaapNativeHarnessAdapter['applyPermissionEnv']>[1]): void {
        const permission = resolveOpencodePermissionEnv({
            command: task.command,
            agentId: task.agentId,
            autoApprove: task.autoApprove,
            readOnlyWorkspace: task.readOnlyWorkspace,
        });
        if (permission) {
            env.OPENCODE_PERMISSION = permission;
        }
    }
}
