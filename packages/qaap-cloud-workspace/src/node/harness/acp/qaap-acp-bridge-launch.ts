// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_DELEGATION_SANDBOX_NODE, stageQaapSandboxScripts } from '../../qaap-agent-delegation-launch';
import type { AgentPromptOwner } from '../../qaap-agent-task-runner-utils';
import { resolveQaapCloudWorkspaceResource } from '../../qaap-cloud-workspace-resource';
import type { QaapTaskSandbox } from '../../qaap-task-sandbox';
import { QAAP_TOOL_GATE_PI_EXTENSION_FILE } from '../../qaap-tool-gate-pi-adapter';

/**
 * Launch side of the ACP bridge (`resources/qaap-acp-bridge.mjs`, design "Desviación F1: puente"): which harnesses
 * run through it, and the argv that starts it. The runner still starts one process per turn; the bridge speaks ACP
 * to the agent next to it and prints Claude stream-json.
 */

export const QAAP_ACP_BRIDGE_FILE = 'qaap-acp-bridge.mjs';

/** ACP flavors the bridge knows (`FLAVORS` in the bridge), each behind its own flag until its E2E passes. */
export type QaapAcpFlavorId = 'opencode' | 'copilot';

const FLAVOR_FLAGS: Readonly<Record<QaapAcpFlavorId, string>> = {
    opencode: 'QAAP_HARNESS_ACP_OPENCODE',
    copilot: 'QAAP_HARNESS_ACP_COPILOT',
};

/** The agent command each flavor starts in ACP mode. */
const FLAVOR_AGENT_ARGV: Readonly<Record<QaapAcpFlavorId, readonly string[]>> = {
    opencode: ['opencode', 'acp'],
    copilot: ['copilot', '--acp'],
};

export function resolveQaapAcpBridgePath(): string {
    return resolveQaapCloudWorkspaceResource(QAAP_ACP_BRIDGE_FILE);
}

/** The gate client the bridge loads (`askGate`); shared with Pi's gate extension so the fail-closed logic exists once. */
export function resolveQaapAcpGateClientPath(): string {
    return resolveQaapCloudWorkspaceResource(QAAP_TOOL_GATE_PI_EXTENSION_FILE);
}

/** The ACP flavor of a harness id, when its flag is on (`1`); undefined keeps the native one-shot CLI. */
export function resolveQaapAcpFlavor(agentId: string | undefined, env: NodeJS.ProcessEnv = process.env): QaapAcpFlavorId | undefined {
    const id = agentId?.trim().toLowerCase();
    if (id !== 'opencode' && id !== 'copilot') {
        return undefined;
    }
    return env[FLAVOR_FLAGS[id]]?.trim() === '1' ? id : undefined;
}

export interface QaapAcpBridgeLaunch {
    readonly flavor: QaapAcpFlavorId;
    readonly nodeBin: string;
    readonly bridgePath: string;
    readonly gateClientPath: string;
    readonly mode: 'ask' | 'auto' | 'readonly';
    /** Provider/model id; never a credential. */
    readonly model?: string;
    /** Binary that replaces the flavor's default (Settings → Harness binary path). */
    readonly agentBin?: string;
}

/** The bridge's argv. Nothing secret goes here: credentials stay in the env or in 0600 files. */
export function buildQaapAcpBridgeArgv(launch: QaapAcpBridgeLaunch): string[] {
    const [defaultBin, ...agentArgs] = FLAVOR_AGENT_ARGV[launch.flavor];
    return [
        launch.nodeBin,
        launch.bridgePath,
        '--flavor', launch.flavor,
        '--mode', launch.mode,
        '--gate-client', launch.gateClientPath,
        ...(launch.model ? ['--model', launch.model] : []),
        '--',
        launch.agentBin ?? defaultBin,
        ...agentArgs,
    ];
}

/** {@link buildQaapAcpBridgeArgv} as a shell command line for the runner's template path. */
export function buildQaapAcpBridgeCommand(launch: QaapAcpBridgeLaunch, quoteShellArg: (value: string) => string): string {
    return buildQaapAcpBridgeArgv(launch).map(quoteShellArg).join(' ');
}

/**
 * The model a native OpenCode / Copilot command line selects (`--model x`, `--model=x`, `-m x`), so the bridge can
 * set the same one through the session's config option.
 */
export function extractQaapAcpModelFromCommand(command: string): string | undefined {
    const match = /(?:^|\s)(?:--model(?:=|\s+)|-m\s+)(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(command);
    const model = match ? (match[1] ?? match[2] ?? match[3]) : undefined;
    return model?.trim() ? model.trim() : undefined;
}

/** What {@link resolveQaapAcpSpawnCommand} needs from the turn. */
export interface QaapAcpSpawnRequest {
    readonly flavor: QaapAcpFlavorId;
    readonly taskId: string;
    /** The native command line the template produced (the model is read from it). */
    readonly command: string;
    readonly autoApprove?: boolean;
    readonly readOnlyWorkspace?: boolean;
    /** The task sandbox the agent runs in, if any. */
    readonly sandbox?: Pick<QaapTaskSandbox, 'name' | 'sharedRoot'>;
    readonly owner?: AgentPromptOwner;
    readonly agentBin?: string;
    /** The child env; gets `ELECTRON_RUN_AS_NODE` when the backend's node is Electron (the bridge strips it for the agent). */
    readonly env: NodeJS.ProcessEnv;
    readonly quoteShellArg: (value: string) => string;
}

/** The turn's command line in ACP mode. In a task sandbox the bridge and its gate client are copied fresh for the turn. */
export function resolveQaapAcpSpawnCommand(request: QaapAcpSpawnRequest): string {
    const mode = request.readOnlyWorkspace ? 'readonly' : request.autoApprove === false ? 'ask' : 'auto';
    let nodeBin = process.execPath;
    let bridgePath = resolveQaapAcpBridgePath();
    let gateClientPath = resolveQaapAcpGateClientPath();
    if (request.sandbox) {
        [bridgePath, gateClientPath] = stageQaapSandboxScripts(request.taskId, request.sandbox, [
            { fileName: QAAP_ACP_BRIDGE_FILE, source: bridgePath },
            { fileName: QAAP_TOOL_GATE_PI_EXTENSION_FILE, source: gateClientPath },
        ], request.owner);
        nodeBin = QAAP_DELEGATION_SANDBOX_NODE;
    } else if (typeof process.versions.electron === 'string') {
        request.env.ELECTRON_RUN_AS_NODE = '1';
    }
    const model = extractQaapAcpModelFromCommand(request.command);
    return buildQaapAcpBridgeCommand({
        flavor: request.flavor, nodeBin, bridgePath, gateClientPath, mode,
        ...(model ? { model } : {}),
        ...(request.agentBin ? { agentBin: request.agentBin } : {}),
    }, request.quoteShellArg);
}
