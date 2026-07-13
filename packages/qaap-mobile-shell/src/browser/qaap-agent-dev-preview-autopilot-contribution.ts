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
import { reportPreviewVisualVerification } from '../common/qaap-agent-conversation-client';
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

const VISUAL_CAPTURE_ATTEMPTS = 40;
const VISUAL_CAPTURE_INTERVAL_MS = 250;

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

    onStart(): void {
        this.conversations.start();
        this.conversations.onDidChangeDetail(event => {
            if (event.kind === 'snapshot' || event.kind === 'created' || event.kind === 'deleted') {
                void this.scanConversationSettlements();
                return;
            }
            if (event.changedFields?.includes('status')) {
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
            this.autopilotInFlight.add(summary.id);
            try {
                await this.maybeAutopilotPreview(summary);
            } finally {
                this.autopilotInFlight.delete(summary.id);
            }
        }
    }

    protected async maybeAutopilotPreview(summary: QaapAgentConversationSummaryDTO): Promise<void> {
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
        const needsVisualVerification = conversationLikelyNeedsVisualVerification(conversation);
        if (!explicitlyRequestedPreview && !needsVisualVerification) {
            return;
        }
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
                await this.captureVisualVerification(summary.id, readyUrl).catch(error => {
                    console.warn('[qaap-visual-verification] automatic capture failed:', error);
                });
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
        }
    }

    protected async captureVisualVerification(conversationId: string, expectedPreviewUrl: string): Promise<void> {
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
        await reportPreviewVisualVerification(conversationId, screenshot, result);
    }

    protected async isConversationInCurrentWorkspace(cwd: string): Promise<boolean> {
        const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/$/, '');
        const expected = normalize(cwd);
        const roots = await this.workspaceService.roots;
        return roots.some(root => normalize(root.resource.path.toString()) === expected);
    }
}
