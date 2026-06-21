// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    extractBackendAgentMention,
    isTheiaCoderAgent,
    isTheiaCoderMention,
} from './qaap-agent-task-client';

/** Where a composer/chat submit should execute. */
export type QaapAgentSubmitSurface = 'vps-background' | 'theia-coder';

export interface QaapAgentSubmitRoutingInput {
    readonly draft: string;
    readonly selectedAgentId?: string;
    /** Work Hub sticky composer always sets this for VPS agents. */
    readonly forceVps?: boolean;
    readonly isLegacyTheiaChat?: boolean;
}

/**
 * Single routing rule for agent submits:
 * - Work Hub / VPS paths win unless the user explicitly picked Coder or typed @Coder.
 * - Legacy theia-chat rows migrate to VPS (QAIQ) on the next send.
 */
export function resolveAgentSubmitSurface(input: QaapAgentSubmitRoutingInput): QaapAgentSubmitSurface {
    if (input.forceVps || input.isLegacyTheiaChat) {
        return 'vps-background';
    }
    if (extractBackendAgentMention(input.draft)) {
        return 'vps-background';
    }
    if (isTheiaCoderAgent(input.selectedAgentId) || isTheiaCoderMention(input.draft)) {
        return 'theia-coder';
    }
    return 'vps-background';
}

export function shouldRouteSubmitToVpsBackground(input: QaapAgentSubmitRoutingInput): boolean {
    return resolveAgentSubmitSurface(input) === 'vps-background';
}

export function shouldRouteSubmitToTheiaCoder(input: QaapAgentSubmitRoutingInput): boolean {
    return resolveAgentSubmitSurface(input) === 'theia-coder';
}
