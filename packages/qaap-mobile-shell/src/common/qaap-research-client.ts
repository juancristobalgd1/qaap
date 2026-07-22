// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    QAAP_RESEARCH_API_PATH,
    type QaapResearchGoalDetailResponse,
    type QaapResearchGoalListResponse,
} from './qaap-research-api';

export async function fetchResearchGoals(): Promise<QaapResearchGoalListResponse> {
    const response = await fetch(QAAP_RESEARCH_API_PATH, { credentials: 'include' });
    if (!response.ok) {
        throw new Error(response.statusText);
    }
    return response.json() as Promise<QaapResearchGoalListResponse>;
}

export async function fetchResearchGoalDetail(id: string): Promise<QaapResearchGoalDetailResponse> {
    const response = await fetch(`${QAAP_RESEARCH_API_PATH}/${encodeURIComponent(id)}`, { credentials: 'include' });
    if (!response.ok) {
        throw new Error(response.statusText);
    }
    return response.json() as Promise<QaapResearchGoalDetailResponse>;
}

export async function cancelResearchGoal(id: string): Promise<void> {
    const response = await fetch(`${QAAP_RESEARCH_API_PATH}/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
    }
}
