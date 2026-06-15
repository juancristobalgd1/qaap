// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** DI symbol implemented by `@theia/qaap-cloud-workspace` when loaded. */
export const QaapGithubAgentTriggerBridge = Symbol('QaapGithubAgentTriggerBridge');

export interface QaapGithubAgentTriggerRequest {
    readonly owner: string;
    readonly repo: string;
    readonly issueNumber: number;
    readonly commentId?: number;
    readonly commentAuthor?: string;
    readonly prompt: string;
    readonly htmlUrl?: string;
}

export interface QaapGithubAgentTriggerResult {
    readonly ok: boolean;
    readonly conversationId?: string;
    readonly workHubUrl?: string;
    readonly error?: string;
}

export interface QaapGithubAgentTriggerBridge {
    triggerFromGithubComment(request: QaapGithubAgentTriggerRequest): Promise<QaapGithubAgentTriggerResult>;
}
