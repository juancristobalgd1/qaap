// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapAgentConversationDTO,
    QaapAgentConversationSummaryDTO,
    QaapAgentMessageDTO,
} from '../common/qaap-agent-conversation-client';
import { isQaapWorkHubPerfProbeEnabled } from '../common/qaap-work-hub-perf-probe';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import { normalizeCwd } from './mobile-projects-active-tasks';

export const QAAP_PROBE_WORKSPACE_PROJECT_ID = '__qaap_probe_workspace__';

export interface WorkHubPerfProbeDiagnostics {
    readonly projectCount: number;
    readonly mcRowCount: number;
    readonly teamRowCount: number;
    readonly hubView: string;
}

export const QAAP_PROBE_CONVERSATION_IDS = {
    agentA: 'probe-agent-a',
    agentB: 'probe-agent-b',
    agentC: 'probe-agent-c',
} as const;

export function buildProbeConversationDTO(summary: QaapAgentConversationSummaryDTO): QaapAgentConversationDTO {
    const messageCount = Math.max(2, summary.messageCount ?? 2);
    const messages: QaapAgentMessageDTO[] = [];
    for (let index = 0; index < messageCount; index++) {
        const role = index % 2 === 0 ? 'user' as const : 'agent' as const;
        messages.push({
            id: `${summary.id}-msg-${index}`,
            role,
            content: role === 'user'
                ? 'Fix the login flow and add tests.'
                : `Probe agent history block ${index}. `.repeat(12),
            createdAt: summary.createdAt + index,
        });
    }
    return {
        id: summary.id,
        cwd: summary.cwd,
        agentId: summary.agentId,
        title: summary.title,
        status: summary.status,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        messages,
        autoApprove: true,
    };
}

export function buildProbeStreamingSummaries(cwd: string): QaapAgentConversationSummaryDTO[] {
    return [
        {
            id: 'probe-agent-a',
            cwd,
            agentId: 'qaiq',
            title: 'Agent A — inbox',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 300,
            messageCount: 2,
            turnProgressCurrent: 2,
            turnProgressTotal: 5,
        },
        {
            id: 'probe-agent-b',
            cwd,
            agentId: 'codex',
            title: 'Agent B — team',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 200,
            messageCount: 2,
            turnProgressCurrent: 1,
            turnProgressTotal: 4,
        },
        {
            id: 'probe-agent-c',
            cwd,
            agentId: 'claude',
            title: 'Agent C — MC',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 100,
            messageCount: 2,
            turnProgressCurrent: 3,
            turnProgressTotal: 6,
        },
    ];
}

/** Mission Control / Team collectors iterate projects — ensure the open workspace maps to one row. */
export function ensureProbeWorkspaceProject(
    projects: readonly MobileProjectEntry[],
    projectsService: MobileProjectsService,
    workspaceCwd: string,
): MobileProjectEntry[] {
    if (!isQaapWorkHubPerfProbeEnabled()) {
        return [...projects];
    }
    const normalizedWorkspaceCwd = normalizeCwd(workspaceCwd);
    const matches = projects.some(project => {
        if (project.id === QAAP_PROBE_WORKSPACE_PROJECT_ID) {
            return true;
        }
        const cwd = projectsService.getProjectCwd(project);
        return cwd !== undefined && normalizeCwd(cwd) === normalizedWorkspaceCwd;
    });
    if (matches) {
        return [...projects];
    }
    return [...projects, {
        id: QAAP_PROBE_WORKSPACE_PROJECT_ID,
        name: projectsService.getCurrentWorkspaceName() ?? 'workspace',
        color: '#5b9bd5',
        branch: 'main',
        status: 'working',
        task: '',
        progress: 0,
        agents: [],
        lastActive: 'now',
        tokens: '0',
        cost: '0',
        pinned: true,
        isCurrent: true,
    }];
}
