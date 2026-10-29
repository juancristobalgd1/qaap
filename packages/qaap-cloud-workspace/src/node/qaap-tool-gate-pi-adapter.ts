// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import { quoteShellArg } from './qaap-agent-task-runner-utils';

/** File name of the standalone Pi extension shipped in this package's `resources/`. */
export const QAAP_TOOL_GATE_PI_EXTENSION_FILE = 'qaap-tool-gate-pi.mjs';

/** Absolute path of the Pi gate extension, resolved from the compiled module location at spawn time. */
export function resolveQaapToolGatePiExtensionPath(): string {
    return path.resolve(__dirname, '..', '..', 'resources', QAAP_TOOL_GATE_PI_EXTENSION_FILE);
}

/**
 * Template variables of the Pi command (`{gate_ext}` and `{trust_flags}`).
 *
 * Folder trust is not modelled yet, so every folder is untrusted: `--no-approve` keeps Pi from loading
 * project-local extensions, settings and MCP config. A trusted folder maps to the registry's
 * `trustedFolderArgs`; never an unconditional `--approve`.
 */
export function buildPiGateTemplateVars(folderTrusted: boolean = false): Record<string, string> {
    const caps = resolveQaapHarnessCapabilities('pi');
    return {
        gate_ext: quoteShellArg(resolveQaapToolGatePiExtensionPath()),
        trust_flags: (folderTrusted ? caps.trustedFolderArgs : caps.untrustedFolderArgs).join(' '),
    };
}

/** True for harnesses whose tool calls reach the gate through an in-process extension (Pi today). */
export function usesToolGateExtension(agentId: string | undefined): boolean {
    return resolveQaapHarnessCapabilities(agentId).gate === 'extension';
}
