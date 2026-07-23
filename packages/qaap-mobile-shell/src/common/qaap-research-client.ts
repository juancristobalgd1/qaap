// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    QAAP_RESEARCH_API_PATH,
    QAAP_RESEARCH_GOAL_REPLAY_PATH,
    type QaapCreateResearchGoalBody,
    type QaapResearchGoalDetailResponse,
    type QaapResearchGoalListResponse,
} from './qaap-research-api';
import type { ResearchGoal } from './qaap-research-goal';

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

export async function createResearchGoal(body: QaapCreateResearchGoalBody): Promise<ResearchGoal> {
    const response = await fetch(QAAP_RESEARCH_API_PATH, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
    }
    return response.json() as Promise<ResearchGoal>;
}

export async function replayResearchGoal(id: string): Promise<ResearchGoal> {
    const response = await fetch(QAAP_RESEARCH_GOAL_REPLAY_PATH(id), {
        method: 'POST',
        credentials: 'include',
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
    }
    return response.json() as Promise<ResearchGoal>;
}
