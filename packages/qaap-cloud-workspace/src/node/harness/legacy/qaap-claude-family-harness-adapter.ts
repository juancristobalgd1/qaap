// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentPromptTransport } from '../../qaap-agent-task-runner-utils';
import type { QaapHarnessGateWiring, QaapHarnessPromptTransportProbe } from '../qaap-harness-adapter';
import { QaapNativeHarnessAdapter } from './qaap-native-harness-adapter';

/**
 * Claude Code and OpenClaude speak the same stream-json control protocol (QAIQ is a fork of it): the permission
 * prompt arrives on stdin and the gate answers it in-process. The prompt travels over stdin without a placeholder.
 */
export class QaapClaudeFamilyHarnessAdapter extends QaapNativeHarnessAdapter {

    override readonly gateWiring: QaapHarnessGateWiring = 'stdio-control';

    override matchPromptTransport(probe: QaapHarnessPromptTransportProbe): QaapAgentPromptTransport | undefined {
        return probe.agentId === this.agentId ? { kind: 'plain-stdin', placeholder: 'omit' } : undefined;
    }

    override applyChildEnv(env: NodeJS.ProcessEnv, task: Parameters<QaapNativeHarnessAdapter['applyChildEnv']>[1]): void {
        if (task.agentId?.trim().toLowerCase() === this.agentId && env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === undefined) {
            // Telemetry, error reporting and the auto-updater run when the CLI exits. Behind the tenant
            // egress allowlist they wait out network timeouts, so the turn kept showing "Preparing the
            // response…" for ~30s after the answer was complete. An operator override wins.
            env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
        }
    }
}
