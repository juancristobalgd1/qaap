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

const VISUAL_CAPTURE_ATTEMPTS = 20;
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

    protected readonly priorStatus = new Map<string, QaapAgentConversationSummaryDTO['status']>();
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
            const previous = this.priorStatus.get(summary.id);
            this.priorStatus.set(summary.id, summary.status);
            if (previous !== 'streaming' || summary.status === 'streaming') {
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
        const explicitlyRequestedPreview = conversationEverRequestedDevPreview(conversation);
        const needsVisualVerification = conversationLikelyNeedsVisualVerification(conversation);
        if (!explicitlyRequestedPreview && !needsVisualVerification) {
            return;
        }
        await this.bootstrap.refreshFromCurrentWorkspace();
        const readyUrl = await ensureTranscriptDevPreview(this.bootstrap, { conversation });
        if (readyUrl) {
            await this.bootstrap.focusPreview().catch(() => undefined);
            await this.captureVisualVerification(summary.id).catch(error => {
                console.warn('[qaap-visual-verification] automatic capture failed:', error);
            });
            return;
        }
        const reason = buildTranscriptPreviewBootstrapFailureReason(
            toTranscriptPreviewBootstrapSnapshot(this.bootstrap.getStateSnapshot()),
        );
        if (reason && explicitlyRequestedPreview) {
            await reportPreviewBootstrapFailure(summary.id, reason).catch(() => undefined);
        }
    }

    protected async captureVisualVerification(conversationId: string): Promise<void> {
        let frame: HTMLIFrameElement | undefined;
        let doc: Document | undefined;
        for (let attempt = 0; attempt < VISUAL_CAPTURE_ATTEMPTS; attempt++) {
            frame = this.previewSurfaces.getActiveSurface()?.frame;
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
}
