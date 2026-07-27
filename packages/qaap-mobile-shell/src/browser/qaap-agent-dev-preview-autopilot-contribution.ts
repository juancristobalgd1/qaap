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
    finalizeVisualFlowVerification,
    reportPreviewVisualVerificationFailure,
    uploadVisualEvidenceImage,
    type QaapVisualFlowStepReport,
} from '../common/qaap-agent-conversation-client';
import { deriveVisualFlowSteps } from '../common/qaap-visual-flow-plan';
import { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import { captureSameOriginPreview } from '@theia/qaap-adapters/lib/browser/qaap-preview-overflow-actions';
import {
    qaapPreviewDocumentIsProxyFailure,
    validateQaapPreviewDocument,
} from './qaap-preview-visual-validation';
import { conversationLikelyNeedsVisualVerification, parseQaapCaptureDirective } from '../common/qaap-visual-verification';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { nls } from '@theia/core/lib/common/nls';
import {
    resumeQaapMiniBrowserPreview,
    syncQaapMiniBrowserPreviewSuspension,
} from '@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame';
import { peekPreferDesktopIde } from './mobile-projects-open';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { shouldCaptureSettledVisualTurn } from '../common/qaap-visual-settlement';

// A cold dev server can spend well over 10s compiling its first page on a loaded VPS, so give
// the first reload → readyState poll a 30s budget rather than the original 10s.
const VISUAL_CAPTURE_ATTEMPTS = 120;
/** Later steps hit a warm server — a shorter 15s budget keeps the whole walk bounded. */
const VISUAL_CAPTURE_STEP_ATTEMPTS = 60;
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
        // Parallel-run variants execute in a temp worktree (`cwd`), but the user watches them from
        // the base workspace — match on either. The capture then reflects the app as served from
        // the open workspace root.
        const workspacePathCandidates = [conversation.cwd, summary.parallelBaseCwd]
            .filter((value): value is string => !!value);
        if (!await this.isAnyPathInCurrentWorkspace(workspacePathCandidates)) {
            return;
        }
        const explicitlyRequestedPreview = conversationEverRequestedDevPreview(conversation);
        const needsVisualVerification = summary.visualVerificationPending === true
            || conversationLikelyNeedsVisualVerification(conversation);
        if (!explicitlyRequestedPreview && !needsVisualVerification) {
            return;
        }
        const lastAgentMessage = [...conversation.messages ?? []]
            .reverse()
            .find(message => message.role === 'agent');
        // `[QAAP record]` is headless-only (Playwright webm). Screenshotting here would silently
        // downgrade a video request into the image flow ("Walked N pages" + PNG).
        if (needsVisualVerification && parseQaapCaptureDirective(lastAgentMessage).mode === 'video') {
            return;
        }
        // The evidence target is the reply the user is looking at *now*. Captures are attached
        // by message id so a slow dev-server boot can no longer race the next turn's status.
        const targetAgentMessageId = lastAgentMessage?.id;
        const attempt = (this.captureAttemptsByTurn.get(turnKey) ?? 0) + 1;
        if (needsVisualVerification) {
            this.captureAttemptsByTurn.set(turnKey, attempt);
        }
        const outOfBudget = attempt >= VISUAL_CAPTURE_TURN_BUDGET;
        const readyUrl = await ensureTranscriptDevPreview(this.bootstrap, {
            conversation,
            skipConversationPortProbe: true,
            projectId: conversation.parallelBaseCwd ?? conversation.cwd,
            workspaceRoot: conversation.parallelBaseCwd ?? conversation.cwd,
        });
        if (readyUrl) {
            // Mount the preview widget for headless capture without yanking the Work Hub surface
            // to Browser/Preview — the user opens that tab only via an explicit affordance.
            await this.bootstrap.openPreview(readyUrl, true, { silent: true }).catch(() => undefined);
            const capturePreviewUrl = this.bootstrap.previewUrl ?? readyUrl;
            // Work Hub normally suspends preview iframes to avoid background HMR traffic. Resume
            // them only for this bounded capture, then restore the normal shell policy.
            resumeQaapMiniBrowserPreview(this.shell);
            try {
                await this.captureVisualVerification(summary.id, capturePreviewUrl, targetAgentMessageId, conversation);
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

    /**
     * Walks the affected flow: every derived route is loaded in the same-origin preview frame,
     * smoke-checked, screenshotted, and uploaded; the finalize attaches one evidence block with
     * all captured steps. Steps that fail to load are reported as findings instead of aborting —
     * only a walk with zero captured steps throws (feeding the failure-note path).
     */
    protected async captureVisualVerification(
        conversationId: string,
        expectedPreviewUrl: string,
        targetAgentMessageId: string | undefined,
        conversation: { readonly messages?: readonly { readonly role?: string; readonly content?: string }[] },
    ): Promise<void> {
        if (!targetAgentMessageId) {
            throw new Error('The settled turn has no agent reply to attach evidence to.');
        }
        const steps = deriveVisualFlowSteps(conversation);
        const captured: QaapVisualFlowStepReport[] = [];
        const skipped: string[] = [];
        for (const [index, step] of steps.entries()) {
            try {
                const { frame, doc } = await this.loadPreviewStep(expectedPreviewUrl, step, index === 0);
                // Let the final layout/image paint settle after the load event before serializing the DOM.
                await new Promise(resolve => setTimeout(resolve, 300));
                const result = validateQaapPreviewDocument(doc, frame);
                const screenshot = await captureSameOriginPreview(doc, frame, { maxWidth: 1600, maxHeight: 2400 });
                if (!screenshot) {
                    throw new Error('the preview canvas did not produce a PNG');
                }
                const evidenceId = await uploadVisualEvidenceImage(conversationId, screenshot);
                if (!evidenceId) {
                    throw new Error('the evidence upload was rejected');
                }
                captured.push({ label: step, evidenceId, result });
            } catch (error) {
                skipped.push(`\`${step}\`: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (captured.length === 0) {
            throw new Error(`No step of the flow could be captured — ${skipped.join('; ')}`);
        }
        if (skipped.length > 0) {
            // Surface unreachable steps as findings on the walk itself instead of dropping them.
            const first = captured[0];
            captured[0] = {
                ...first,
                result: {
                    ...first.result,
                    status: 'warning',
                    issues: [...first.result.issues, ...skipped.map(reason => `Could not capture ${reason}.`)],
                },
            };
        }
        await finalizeVisualFlowVerification(conversationId, captured, targetAgentMessageId);
        // Leave the user's preview back on the root route instead of the last walked step.
        if (steps.length > 1) {
            try {
                this.previewSurfaces.getSurfaceForPreviewUrl(expectedPreviewUrl)?.frame
                    .contentWindow?.location.replace(this.buildStepUrl(expectedPreviewUrl, '/'));
            } catch {
                /* best effort */
            }
        }
    }

    /** Resolves a walked route against the (possibly proxied) preview base URL. */
    protected buildStepUrl(previewUrl: string, step: string): string {
        const base = new URL(previewUrl, window.location.href);
        if (!base.pathname.endsWith('/')) {
            base.pathname += '/';
        }
        return step === '/' ? base.toString() : new URL(step.replace(/^\//, ''), base).toString();
    }

    /** Navigates the preview frame to one step and waits until that document finished loading. */
    protected async loadPreviewStep(
        previewUrl: string,
        step: string,
        coldStart: boolean,
    ): Promise<{ frame: HTMLIFrameElement; doc: Document }> {
        const targetUrl = this.buildStepUrl(previewUrl, step);
        const normalizePath = (value: string | undefined): string => (value ?? '').replace(/\/+$/, '') || '/';
        const targetPath = normalizePath(new URL(targetUrl).pathname);
        const attempts = coldStart ? VISUAL_CAPTURE_ATTEMPTS : VISUAL_CAPTURE_STEP_ATTEMPTS;
        let frame: HTMLIFrameElement | undefined;
        let doc: Document | undefined;
        let navigationRequested = false;
        for (let attempt = 0; attempt < attempts; attempt++) {
            // The Work Hub suspension policy parks preview iframes at about:blank, which the
            // port-based match rejects — fall back to the active surface and navigate it directly.
            // Fail closed: an active surface may belong to another project. Only a surface whose
            // registered URL matches this execution may be navigated, inspected, or captured.
            frame = this.previewSurfaces.getSurfaceForPreviewUrl(previewUrl)?.frame;
            if (frame) {
                let currentHref: string | undefined;
                try {
                    currentHref = frame.contentWindow?.location.href;
                } catch {
                    currentHref = undefined;
                }
                const blanked = !currentHref || currentHref === 'about:blank';
                // Re-request navigation when the suspension policy blanks the frame mid-capture.
                if (!navigationRequested || (blanked && attempt % 8 === 0)) {
                    navigationRequested = true;
                    try {
                        const win = frame.contentWindow;
                        if (win && !blanked && normalizePath(win.location.pathname) === targetPath) {
                            win.location.reload();
                        } else if (win && !blanked) {
                            win.location.replace(targetUrl);
                        } else {
                            // Suspended/blank frame: setting src revives it AND restores the
                            // port match for subsequent polls.
                            frame.src = targetUrl;
                        }
                    } catch {
                        frame.src = targetUrl;
                    }
                    await new Promise(resolve => setTimeout(resolve, VISUAL_CAPTURE_INTERVAL_MS));
                    continue;
                }
            }
            try {
                doc = frame?.contentDocument ?? undefined;
            } catch {
                doc = undefined;
            }
            let atTarget = false;
            try {
                atTarget = normalizePath(frame?.contentWindow?.location.pathname) === targetPath;
            } catch {
                atTarget = false;
            }
            if (frame && doc?.body && doc.readyState === 'complete' && atTarget) {
                if (qaapPreviewDocumentIsProxyFailure(doc)) {
                    throw new Error(nls.localize(
                        'qaap/visualVerification/previewExecutionMismatch',
                        'Qaap refused to capture a preview that belongs to another execution.',
                    ));
                }
                return { frame, doc };
            }
            await new Promise(resolve => setTimeout(resolve, VISUAL_CAPTURE_INTERVAL_MS));
        }
        throw new Error('the preview surface did not finish loading this route');
    }

    protected async isAnyPathInCurrentWorkspace(paths: readonly string[]): Promise<boolean> {
        const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/$/, '');
        const roots = await this.workspaceService.roots;
        // Agents may run in a subdirectory of the opened project (monorepo app folder), so accept
        // any cwd nested under a workspace root — not only an exact root match.
        return paths.some(candidate => {
            const expected = normalize(candidate);
            return roots.some(root => {
                const rootPath = normalize(root.resource.path.toString());
                return expected === rootPath || expected.startsWith(`${rootPath}/`);
            });
        });
    }
}
