// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/** Default cycling phrases shown while an agent turn is in progress without concrete output yet. */
export function getQaapAgentLoadingPhrases(): readonly string[] {
    return [
        nls.localize('qaap/agentLoading/thinking', 'Agent is thinking...'),
        nls.localize('qaap/agentLoading/processing', 'Processing your request...'),
        nls.localize('qaap/agentLoading/analyzing', 'Analyzing the data...'),
        nls.localize('qaap/agentLoading/generating', 'Generating response...'),
        nls.localize('qaap/agentLoading/almostThere', 'Almost there...'),
    ];
}

export const QAAP_AGENT_LOADING_PHRASE_CYCLE_MS = 3000;

export function resolveQaapAgentLoadingPhraseIndex(index: number, phraseCount: number): number {
    if (phraseCount <= 0) {
        return 0;
    }
    const normalized = index % phraseCount;
    return normalized < 0 ? normalized + phraseCount : normalized;
}

export function shouldCycleQaapAgentLoadingPhrases(activityKind: string | undefined): boolean {
    return activityKind === undefined
        || activityKind === 'thinking'
        || activityKind === 'starting'
        || activityKind === 'writing';
}
