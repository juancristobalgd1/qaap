// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Turn-end result card actions: the transcript's Files Changed footer reads the composer's preview and git
// state and fires the composer's own handlers, so it never duplicates the Changes row logic.

import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { TranscriptTurnResultPreviewState, TranscriptTurnResultState } from '@theia/qaap-transcript/lib/browser/qaap-transcript-host-contracts';
import type { MobileProjectsTranscriptStickyComposerUiContext } from './mobile-projects-transcript-sticky-composer-ui-context';
import { isComposerPreviewBootingForProject, resolveVerifiedComposerPreviewUrl } from './qaap-composer-preview-action';

interface TurnResultTarget {
    readonly project: MobileProjectEntry;
    readonly summary: QaapAgentConversationSummaryDTO;
}

/** The composer's project and summary, only while they are the conversation the transcript shows. */
function resolveTurnResultTarget(ctx: MobileProjectsTranscriptStickyComposerUiContext, conv: QaapAgentConversationDTO): TurnResultTarget | undefined {
    const project = ctx.host.transcriptComposerProject;
    const summary = ctx.host.transcriptComposerSummary;
    if (!project || !summary || summary.id !== conv.id) {
        return undefined;
    }
    return { project, summary };
}

/**
 * `starting` while a start is in flight, `live` when the preview URL is verified, otherwise `runnable`:
 * the composer's Run app chip is offered for any conversation that changed files.
 */
function resolveTurnResultPreviewState(ctx: MobileProjectsTranscriptStickyComposerUiContext, project: MobileProjectEntry): TranscriptTurnResultPreviewState {
    const runtime = ctx.resolveComposerPreviewRuntime(project);
    const verifiedUrl = ctx.verifiedComposerPreview?.projectId === project.id
        ? resolveVerifiedComposerPreviewUrl(runtime, ctx.verifiedComposerPreview.url, undefined, ctx.verifiedComposerPreview.candidate)
        : undefined;
    if (ctx.host.transcriptPreviewRequestRunning || ctx.host.transcriptPreviewRequestPending || isComposerPreviewBootingForProject(runtime, !!verifiedUrl)) {
        return 'starting';
    }
    // Only a verified URL counts as live: the composer offers "View Preview" for exactly that.
    return verifiedUrl ? 'live' : 'runnable';
}

export function resolveTurnResultStateExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, conv: QaapAgentConversationDTO): TranscriptTurnResultState | undefined {
    const target = resolveTurnResultTarget(ctx, conv);
    if (!target) {
        return undefined;
    }
    return {
        previewState: resolveTurnResultPreviewState(ctx, target.project),
        canCreatePr: ctx.hasComposerFileActivity(conv) && ctx.hasComposerCommittableChangesFromGit(target.summary),
    };
}

export function runTurnResultPreviewExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, conv: QaapAgentConversationDTO): void {
    const target = resolveTurnResultTarget(ctx, conv);
    if (target) {
        void ctx.launchComposerDevPreview(target.project, target.summary);
    }
}

export function openTurnResultPreviewExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, conv: QaapAgentConversationDTO): void {
    const target = resolveTurnResultTarget(ctx, conv);
    if (target) {
        void ctx.openComposerPreview(target.project.id);
    }
}

export function createTurnResultPullRequestExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext, conv: QaapAgentConversationDTO): void {
    const target = resolveTurnResultTarget(ctx, conv);
    if (target) {
        void ctx.runComposerCommitAction(target.project, target.summary, 'commit-create-pr');
    }
}

export function focusTurnResultComposerExtracted(ctx: MobileProjectsTranscriptStickyComposerUiContext): void {
    ctx.host.transcriptComposerHost?.querySelector<HTMLElement>('textarea, [contenteditable="true"]')?.focus();
}
