// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    getConversation,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { conversationEverRequestedDevPreview } from '../common/qaap-transcript-preview-offer';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { ensureTranscriptDevPreview } from './qaap-transcript-preview-bootstrap';
import { buildTranscriptPreviewBootstrapFailureReason, toTranscriptPreviewBootstrapSnapshot } from '../common/qaap-transcript-preview-bootstrap-failure';
import { reportPreviewBootstrapFailure } from '../common/qaap-agent-conversation-client';
import {
    reportPreviewVisualVerification,
    reportPreviewVisualVerificationFailure,
} from '../common/qaap-agent-conversation-client';
import { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import { captureSameOriginPreview } from '@theia/qaap-adapters/lib/browser/qaap-preview-overflow-actions';
import { validateQaapPreviewDocument } from './qaap-preview-visual-validation';
import { conversationLikelyNeedsVisualVerification } from '../common/qaap-visual-verification';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import {
    resumeQaapMiniBrowserPreview,
    syncQaapMiniBrowserPreviewSuspension,
} from '@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame';
import { peekPreferDesktopIde } from './mobile-projects-open';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { shouldCaptureSettledVisualTurn } from '../common/qaap-visual-settlement';

// A cold dev server can spend well over 10s compiling its first page on a loaded VPS, so give
// the reload → readyState poll a 30s budget rather than the original 10s.
const VISUAL_CAPTURE_ATTEMPTS = 120;
const VISUAL_CAPTURE_INTERVAL_MS = 250;
/** Capture attempts per settled turn before the failure note settles the evidence slot. */
const VISUAL_CAPTURE_TURN_BUDGET = 2;

/**
 * When a background agent turn settles after a preview-related request, refresh project bootstrap
 * and open the dev preview without requiring the user to open the transcript or tap Run app.
 */
@injectable()
export class QaapAgentDevPreviewAutopilotContribution implements FrontendApplicationContribution {

    @inject(MobileProjectsConversations)
    protected readonly conversations: MobileProjectsConversations;

    @inject(QaapProjectBootstrapService)
    protected readonly bootstrap: QaapProjectBootstrapService;

    @inject(QaapPreviewSurfaceRegistry)
    protected readonly previewSurfaces: QaapPreviewSurfaceRegistry;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected readonly pendingVisualTurns = new Set<string>();
    protected readonly autopilotInFlight = new Set<string>();
    /** Capture attempts per settled turn (`conversationId:messageCount`) — bounds retry loops. */
    protected readonly captureAttemptsByTurn = new Map<string, number>();

    onStart(): void {
        this.conversations.start();
        this.conversations.onDidChangeDetail(event => {
            if (event.kind === 'snapshot' || event.kind === 'created' || event.kind === 'deleted') {
                void this.scanConversationSettlements();
                return;
            }
            if (event.changedFields?.includes('status') || event.changedFields?.includes('visualVerificationPending')) {
                void this.scanConversationSettlements();
            }
        });
    }

    protected async scanConversationSettlements(): Promise<void> {
        for (const summary of this.conversations.listAllSummaries()) {
            if (!shouldCaptureSettledVisualTurn(this.pendingVisualTurns, summary)) {
                continue;
            }
            if (this.autopilotInFlight.has(summary.id)) {
                continue;
            }
            const turnKey = `${summary.id}:${summary.messageCount}`;
            if ((this.captureAttemptsByTurn.get(turnKey) ?? 0) >= VISUAL_CAPTURE_TURN_BUDGET) {
                continue;
            }
            this.autopilotInFlight.add(summary.id);
            try {
                await this.maybeAutopilotPreview(summary, turnKey);
            } finally {
                this.autopilotInFlight.delete(summary.id);
            }
        }
    }

    protected async maybeAutopilotPreview(summary: QaapAgentConversationSummaryDTO, turnKey: string): Promise<void> {
        let conversation;
        try {
            conversation = await getConversation(summary.id);
        } catch {
            return;
        }
        if (!await this.isConversationInCurrentWorkspace(conversation.cwd)) {
            return;
        }
        const explicitlyRequestedPreview = conversationEverRequestedDevPreview(conversation);
        const needsVisualVerification = summary.visualVerificationPending === true
            || conversationLikelyNeedsVisualVerification(conversation);
        if (!explicitlyRequestedPreview && !needsVisualVerification) {
            return;
        }
        // The evidence target is the reply the user is looking at *now*. Captures are attached
        // by message id so a slow dev-server boot can no longer race the next turn's status.
        const targetAgentMessageId = [...conversation.messages ?? []]
            .reverse()
            .find(message => message.role === 'agent')?.id;
        const attempt = (this.captureAttemptsByTurn.get(turnKey) ?? 0) + 1;
        if (needsVisualVerification) {
            this.captureAttemptsByTurn.set(turnKey, attempt);
        }
        const outOfBudget = attempt >= VISUAL_CAPTURE_TURN_BUDGET;
        await this.bootstrap.refreshFromCurrentWorkspace();
        const readyUrl = await ensureTranscriptDevPreview(this.bootstrap, {
            conversation,
            skipConversationPortProbe: true,
        });
        if (readyUrl) {
            await this.bootstrap.focusPreview().catch(() => undefined);
            // Work Hub normally suspends preview iframes to avoid background HMR traffic. Resume
            // them only for this bounded capture, then restore the normal shell policy.
            resumeQaapMiniBrowserPreview(this.shell);
            try {
                await this.captureVisualVerification(summary.id, readyUrl, targetAgentMessageId);
            } catch (error) {
                console.warn('[qaap-visual-verification] automatic capture failed:', error);
                if (needsVisualVerification && outOfBudget && targetAgentMessageId) {
                    const message = error instanceof Error ? error.message : String(error);
                    await reportPreviewVisualVerificationFailure(
                        summary.id,
                        `Automatic capture failed: ${message}`,
                        targetAgentMessageId,
                    ).catch(() => undefined);
                }
            } finally {
                syncQaapMiniBrowserPreviewSuspension(this.shell, peekPreferDesktopIde());
            }
            return;
        }
        const reason = buildTranscriptPreviewBootstrapFailureReason(
            toTranscriptPreviewBootstrapSnapshot(this.bootstrap.getStateSnapshot()),
        );
        if (reason && explicitlyRequestedPreview) {
            await reportPreviewBootstrapFailure(summary.id, reason).catch(() => undefined);
            return;
        }
        if (needsVisualVerification && outOfBudget && targetAgentMessageId) {
            await reportPreviewVisualVerificationFailure(
                summary.id,
                reason ?? 'The dev preview did not become ready, so no screenshot could be captured.',
                targetAgentMessageId,
            ).catch(() => undefined);
        }
    }

    protected async captureVisualVerification(
        conversationId: string,
        expectedPreviewUrl: string,
        targetAgentMessageId?: string,
    ): Promise<void> {
        let frame: HTMLIFrameElement | undefined;
        let doc: Document | undefined;
        let reloadRequested = false;
        for (let attempt = 0; attempt < VISUAL_CAPTURE_ATTEMPTS; attempt++) {
            frame = this.previewSurfaces.getSurfaceForPreviewUrl(expectedPreviewUrl)?.frame;
            if (frame && !reloadRequested) {
                reloadRequested = true;
                try {
                    frame.contentWindow?.location.reload();
                } catch {
                    frame.src = frame.src;
                }
                await new Promise(resolve => setTimeout(resolve, VISUAL_CAPTURE_INTERVAL_MS));
                continue;
            }
            try {
                doc = frame?.contentDocument ?? undefined;
            } catch {
                doc = undefined;
            }
            if (frame && doc?.body && doc.readyState === 'complete') {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, VISUAL_CAPTURE_INTERVAL_MS));
        }
        if (!frame || !doc?.body) {
            throw new Error('No loaded same-origin preview surface was available for capture.');
        }
        // Let the final layout/image paint settle after the load event before serializing the DOM.
        await new Promise(resolve => setTimeout(resolve, 300));
        const result = validateQaapPreviewDocument(doc, frame);
        const screenshot = await captureSameOriginPreview(doc, frame, { maxWidth: 1920, maxHeight: 3000 });
        if (!screenshot) {
            throw new Error('The preview canvas did not produce a PNG.');
        }
        await reportPreviewVisualVerification(conversationId, screenshot, result, targetAgentMessageId);
    }

    protected async isConversationInCurrentWorkspace(cwd: string): Promise<boolean> {
        const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/$/, '');
        const expected = normalize(cwd);
        const roots = await this.workspaceService.roots;
        // Agents may run in a subdirectory of the opened project (monorepo app folder), so accept
        // any cwd nested under a workspace root — not only an exact root match.
        return roots.some(root => {
            const rootPath = normalize(root.resource.path.toString());
            return expected === rootPath || expected.startsWith(`${rootPath}/`);
        });
    }
}
