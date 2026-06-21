// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { resolveAgentBrand } from './qaap-agent-branding';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';

/** Human label for the active VPS agent in bootstrap copy (`OpenCode`, `QAIQ`, …). */
export function resolveTranscriptBootstrapAgentLabel(agentId: string | undefined): string {
    const trimmed = agentId?.trim();
    if (!trimmed) {
        return '…';
    }
    return resolveAgentBrand(trimmed)?.label ?? trimmed;
}

/** Pre-tool lifecycle rows shown from second zero during an in-flight agent turn. */
export function resolveTranscriptStreamingBootstrapActivityItems(
    agentId: string | undefined,
    options?: { readonly stalled?: boolean; readonly timedOut?: boolean },
): TranscriptActivityNavigationItem[] {
    const agentLabel = resolveTranscriptBootstrapAgentLabel(agentId);
    const waitingState = options?.timedOut ? 'error' : options?.stalled ? 'warning' : 'running';
    return [
        {
            label: nls.localize(
                'qaap/mobileProjects/transcriptBootstrapPreparingWorkspace',
                'Preparando workspace',
            ),
            state: 'success',
        },
        {
            label: nls.localize(
                'qaap/mobileProjects/transcriptBootstrapWaitingModel',
                'Esperando respuesta del modelo ({0} / …)',
                agentLabel,
            ),
            state: waitingState,
        },
        {
            label: nls.localize(
                'qaap/mobileProjects/transcriptBootstrapConnectedCloud',
                'Conectado al Cloud',
            ),
            state: 'success',
        },
    ];
}
