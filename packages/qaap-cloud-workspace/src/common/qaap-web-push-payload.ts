// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapPushNotifyRequest } from './qaap-cloud-api-types';

/** Wire payload delivered to the PWA service worker (`push` / `notificationclick`). */
export interface QaapWebPushWirePayload {
    readonly title: string;
    readonly body: string;
    readonly tag?: string;
    readonly route?: string;
    readonly conversationId?: string;
    readonly agentId?: string;
    readonly projectName?: string;
    readonly taskId?: string;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly needsApproval?: boolean;
}

export function buildQaapWebPushWirePayload(request: QaapPushNotifyRequest): QaapWebPushWirePayload {
    const title = request.projectName && !request.title.startsWith('[')
        ? `[${request.projectName}] ${request.title}`
        : request.title;
    return {
        title,
        body: request.body,
        ...(request.tag ? { tag: request.tag } : {}),
        ...(request.route ? { route: request.route } : {}),
        ...(request.conversationId ? { conversationId: request.conversationId } : {}),
        ...(request.agentId ? { agentId: request.agentId } : {}),
        ...(request.projectName ? { projectName: request.projectName } : {}),
        ...(request.taskId ? { taskId: request.taskId } : {}),
        ...(request.linesAdded !== undefined ? { linesAdded: request.linesAdded } : {}),
        ...(request.linesRemoved !== undefined ? { linesRemoved: request.linesRemoved } : {}),
        ...(request.needsApproval ? { needsApproval: true } : {}),
    };
}

export function buildAgentTurnPushNotifyRequest(input: {
    readonly ok: boolean;
    readonly title: string;
    readonly conversationId: string;
    readonly agentId: string;
    readonly projectName: string;
    readonly taskId?: string;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly needsApproval?: boolean;
    readonly logHint?: string;
    readonly pushTitle?: string;
    readonly tag?: string;
}): QaapPushNotifyRequest {
    const diff = input.linesAdded !== undefined || input.linesRemoved !== undefined
        ? ` (+${input.linesAdded ?? 0} −${input.linesRemoved ?? 0})`
        : '';
    const body = input.ok
        ? `${input.agentId} finished${diff}.`
        : (input.logHint?.trim() || `${input.agentId} stopped${diff}.`);
    const defaultTitle = input.needsApproval ? 'Needs your approval' : (input.ok ? 'Agent finished' : 'Agent stopped');
    return {
        title: input.pushTitle ?? defaultTitle,
        body,
        tag: input.tag ?? (input.needsApproval
            ? `qaap-needs-you-${input.conversationId}`
            : `qaap-agent-turn-${input.conversationId}`),
        route: 'transcript',
        conversationId: input.conversationId,
        agentId: input.agentId,
        projectName: input.projectName,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.linesAdded !== undefined ? { linesAdded: input.linesAdded } : {}),
        ...(input.linesRemoved !== undefined ? { linesRemoved: input.linesRemoved } : {}),
        ...(input.needsApproval ? { needsApproval: true } : {}),
    };
}
