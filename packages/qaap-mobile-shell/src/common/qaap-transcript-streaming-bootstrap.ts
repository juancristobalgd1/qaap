// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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

/** @deprecated Pre-tool bootstrap rows removed from the transcript UI. */
export function resolveTranscriptStreamingBootstrapActivityItems(
    _agentId: string | undefined,
    _options?: { readonly stalled?: boolean; readonly timedOut?: boolean },
): TranscriptActivityNavigationItem[] {
    return [];
}
