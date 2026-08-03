// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Business-logic helpers extracted from MobileProjectsPanel (second pass).
// These functions accept instance fields as parameters (dependency injection).

import { FileUri } from '@theia/core/lib/common/file-uri';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import type { QaapAgentConversationDTO } from '../common/qaap-agent-conversation-client';
import { getConversation } from '../common/qaap-agent-conversation-client';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { TranscriptOverlayController } from './mobile-projects-transcript-overlay-controller';

export function projectOwnsActiveBootstrap(
    project: MobileProjectEntry,
    projectBootstrap: QaapProjectBootstrapService | undefined,
    projectsService: MobileProjectsService,
    preparedCwdByProjectId: Map<string, string>,
): boolean {
    const rootUri = projectBootstrap?.descriptor?.rootUri;
    if (!rootUri) {
        return false;
    }
    const cwd = projectsService.getProjectCwd(project) ?? preparedCwdByProjectId.get(project.id);
    if (!cwd) {
        return false;
    }
    const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    try {
        return normalize(FileUri.fsPath(rootUri.toString())) === normalize(cwd);
    } catch {
        return false;
    }
}

export function isCopyConversationEnabled(
    transcriptController: TranscriptOverlayController,
    transcriptConversationCache: Map<string, QaapAgentConversationDTO>,
): boolean {
    const state = transcriptController.state;
    const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
    if (!summary) {
        return false;
    }
    if (state.transcriptLastConv?.id === summary.id && state.transcriptLastConv.messages.length > 0) {
        return true;
    }
    const cached = transcriptConversationCache.get(summary.id);
    if ((cached?.messages.length ?? 0) > 0) {
        return true;
    }
    return (summary.messageCount ?? 0) > 0;
}

export async function resolveActiveConversationForCopy(
    transcriptController: TranscriptOverlayController,
    transcriptConversationCache: Map<string, QaapAgentConversationDTO>,
    conversations: MobileProjectsConversations | undefined,
): Promise<QaapAgentConversationDTO | undefined> {
    const state = transcriptController.state;
    const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
    if (!summary) {
        return undefined;
    }
    if (state.transcriptLastConv?.id === summary.id) {
        return state.transcriptLastConv;
    }
    const cached = transcriptConversationCache.get(summary.id);
    if (cached) {
        return cached;
    }
    if (summary.source === 'theia-chat') {
        return conversations?.getTheiaConversation(summary.id);
    }
    try {
        return await getConversation(summary.id);
    } catch {
        return undefined;
    }
}
