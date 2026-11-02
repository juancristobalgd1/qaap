// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import { quoteShellArg } from './qaap-agent-task-runner-utils';
import { resolveQaapCloudWorkspaceResource } from './qaap-cloud-workspace-resource';

/** File name of the standalone Pi extension shipped in this package's `resources/`. */
export const QAAP_TOOL_GATE_PI_EXTENSION_FILE = 'qaap-tool-gate-pi.mjs';

/** Absolute path of the Pi gate extension, resolved from the compiled module location at spawn time. */
export function resolveQaapToolGatePiExtensionPath(): string {
    return resolveQaapCloudWorkspaceResource(QAAP_TOOL_GATE_PI_EXTENSION_FILE);
}

/**
 * Template variable `{gate_ext}` of the Pi command. `{trust_flags}` is NOT set here: it comes from the
 * per-project folder trust decision (see `resolveAgentProjectTrustFlags`), the single source of truth.
 */
export function buildPiGateTemplateVars(): Record<string, string> {
    return { gate_ext: quoteShellArg(resolveQaapToolGatePiExtensionPath()) };
}

/** True for harnesses whose tool calls reach the gate through an in-process extension (Pi today). */
export function usesToolGateExtension(agentId: string | undefined): boolean {
    return resolveQaapHarnessCapabilities(agentId).gate === 'extension';
}
