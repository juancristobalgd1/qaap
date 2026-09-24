// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapAgentConversationDTO,
    QaapAgentConversationSummaryDTO,
    QaapAgentMessageDTO,
    QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import { isQaapWorkHubPerfProbeEnabled } from '../common/qaap-work-hub-perf-probe';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import { normalizeCwd } from './mobile-projects-active-tasks';

export const QAAP_PROBE_WORKSPACE_PROJECT_ID = '__qaap_probe_workspace__';
export const QAAP_PROBE_TRANSCRIPT_CONVERSATION_ID = '__qaap_transcript_perf_probe__';

export interface TranscriptPerfProbeOptions {
    readonly messageCount?: number;
    readonly charsPerMessage?: number;
}

function repeatToLength(value: string, targetLength: number): string {
    if (value.length >= targetLength) {
        return value.slice(0, targetLength);
    }
    return value.repeat(Math.ceil(targetLength / value.length)).slice(0, targetLength);
}

function buildProbeMessageContent(index: number, role: QaapAgentMessageDTO['role'], charsPerMessage: number): string {
    if (role === 'user') {
        return repeatToLength(
            `## User turn ${index / 2 + 1}\n\nPlease inspect the workspace state and explain the next safe step. `,
            Math.max(120, Math.round(charsPerMessage * 0.28)),
        );
    }
    const markdown = `## Result ${Math.ceil(index / 2)}\n\n` +
        'The agent is streaming a realistic markdown response with enough structure to exercise the transcript renderer.\n\n' +
        '- inspected files and verified the current state\n' +
        '- preserved the existing scroll anchor\n' +
        '- queued the next incremental update\n\n' +
        '| Check | Status |\n| --- | --- |\n| Render path | pass |\n| Scroll anchor | pass |\n\n' +
        '```ts\nconst result = await inspectWorkspace();\nreturn result.ready;\n```\n\n';
    return repeatToLength(markdown, charsPerMessage);
}

function buildProbeMessageSegments(content: string, role: QaapAgentMessageDTO['role']): QaapAgentMessageSegmentDTO[] | undefined {
    return role === 'agent' ? [{ type: 'text', content }] : undefined;
}

export function buildLongTranscriptProbeConversation(
    cwd: string,
    options: TranscriptPerfProbeOptions = {},
): QaapAgentConversationDTO {
    const requestedCount = Math.floor(options.messageCount ?? 120);
    const messageCount = Math.max(2, Math.min(400, Math.floor(requestedCount / 2) * 2));
    const charsPerMessage = Math.max(240, Math.min(6000, Math.floor(options.charsPerMessage ?? 900)));
    const now = Date.now();
    const messages: QaapAgentMessageDTO[] = Array.from({ length: messageCount }, (_, index) => {
        const role: QaapAgentMessageDTO['role'] = index % 2 === 0 ? 'user' : 'agent';
        const content = buildProbeMessageContent(index, role, charsPerMessage);
        return {
            id: `transcript-probe-message-${index}`,
            role,
            content,
            segments: buildProbeMessageSegments(content, role),
            createdAt: now - (messageCount - index) * 1000,
        };
    });
    return {
        id: QAAP_PROBE_TRANSCRIPT_CONVERSATION_ID,
        cwd,
        agentId: 'codex',
        title: 'Transcript performance probe',
        status: 'streaming',
        createdAt: now - messageCount * 1000,
        updatedAt: now,
        messages,
    };
}

export function appendLongTranscriptProbeDelta(
    conversation: QaapAgentConversationDTO,
    tick: number,
    charsPerTick = 160,
): QaapAgentConversationDTO {
    const last = conversation.messages.at(-1);
    if (!last || last.role !== 'agent') {
        return conversation;
    }
    const safeCharsPerTick = Math.max(32, Math.min(1200, Math.floor(charsPerTick)));
    const delta = repeatToLength(
        `\n\nStream chunk ${tick}: incremental content arrives while the answer is still active. `,
        safeCharsPerTick,
    );
    return {
        ...conversation,
        updatedAt: conversation.updatedAt + 1,
        messages: [
            ...conversation.messages.slice(0, -1),
            {
                ...last,
                content: last.content + delta,
                segments: [{ type: 'text', content: last.content + delta }],
            },
        ],
    };
}

export interface WorkHubPerfProbeDiagnostics {
    readonly projectCount: number;
    readonly mcRowCount: number;
    readonly teamRowCount: number;
    readonly hubView: string;
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
