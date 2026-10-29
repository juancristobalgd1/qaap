import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
// Extracted from mobile-projects-transcript-surfaces-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { resolveTranscriptPreviewOpenUrl } from '@theia/qaap-transcript/lib/browser/qaap-transcript-preview-effective-url';
import {
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { reconcileAgentApprovalPolicyId } from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import { ensureTranscriptDevPreview } from '@theia/qaap-shared-core/lib/browser/qaap-transcript-preview-bootstrap';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { clearQaapPreviewDismissedByUser, qaapProjectPreviewDirectory } from '@theia/qaap-shared-core/lib/browser/qaap-preview-user-dismissal';
import { isStalledPreviewAgentFallback, TRANSCRIPT_PREVIEW_AGENT_FALLBACK_TIMEOUT_MS } from './transcript-preview-liveness';

export async function requestTranscriptPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        options?: {
            readonly revealPreviewTab?: boolean;
            readonly allowAgentFallback?: boolean;
        },): Promise<void> {
        if (ctx.host.transcriptPreviewRequestRunning) {
            return;
        }
        ctx.host.transcriptPreviewSuppressedByUser = false;
        clearQaapPreviewDismissedByUser(qaapProjectPreviewDirectory(ctx.host.projectsService, project, ctx.host.preparedCwdByProjectId, summary.cwd));
        const launchGeneration = ++ctx.previewLaunchGeneration;
        const allowAgentFallback = options?.allowAgentFallback !== false;
        let previewTabRevealed = false;
        const revealPreviewTab = (): void => {
            if (previewTabRevealed) {
                return;
            }
            previewTabRevealed = true;
            ctx.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'preview');
            ctx.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab?.('preview');
            ctx.host.executionSurfaceTabsUi.selectTranscriptTab?.('preview', project, summary);
            ctx.updateTranscriptPreviewLaunchStatus();
        };
        const refreshPreviewComposer = (): void => {
            ctx.host.transcriptStickyComposerUi?.refreshComposerQuickActions?.();
            ctx.host.transcriptStickyComposerUi?.refreshComposerActivityStack?.();
            ctx.updateTranscriptPreviewLaunchStatus();
        };
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/previewStarting', 'Starting preview…'),
            { duration: 2200 },
        );
        // Keep the header play control mounted across the whole request lifecycle.
        ctx.syncHeaderPreviewRunButton(project, summary);
        const latestProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;

        const bootstrap = ctx.host.projectBootstrap;
        // Old sessions can carry a corrupt cwd (e.g. the bare `/workspace` container root from an
        // early agent run). Feeding that root to the bootstrap either stalls silently (no
        // package.json → no descriptor) or, worse, falls back to whatever workspace is currently
        // open and records ANOTHER project's preview URL onto this one. Validate first and fail
        // loudly instead.
        const projectRoot = ctx.resolveRunnableTranscriptProjectRoot(project, summary);
        if (bootstrap && !projectRoot) {
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobileProjects/previewRootUnresolved',
                    'Could not resolve this project\'s folder — open the project and retry.'
                ),
                { kind: 'warning' },
            );
        }
        if (bootstrap && projectRoot) {
            // A runnable project does not need an agent to decide how to start it. Detect first,
            // ask which app to run when this is a monorepo, and use the managed terminal directly.
            ctx.beginTranscriptDevPreviewRequest(latestProject, summary);
            if (options?.revealPreviewTab) {
                revealPreviewTab();
            }
            ctx.updateTranscriptPreviewRunButtonState();
            let detected: ReturnType<typeof bootstrap.getStateSnapshot>;
            let readyUrl: string | undefined;
            try {
                await bootstrap.refreshFromProjectRoot(projectRoot, project.id);
                detected = bootstrap.getStateSnapshot();
                if (detected.descriptor && detected.descriptor.apps.length > 1 && !detected.selectedApp) {
                    const selectedApp = await ctx.pickTranscriptPreviewApp(detected.descriptor.apps);
                    if (launchGeneration !== ctx.previewLaunchGeneration || ctx.host.transcriptPreviewSuppressedByUser) {
                        return;
                    }
                    if (!selectedApp) {
                        ctx.host.transcriptPreviewRequestRunning = false;
                        ctx.host.transcriptPreviewRequestPending = false;
                        ctx.syncHeaderPreviewRunButton(project, summary);
                        refreshPreviewComposer();
                        MobileSnackbar.dismiss();
                        return;
                    }
                    await bootstrap.selectMonorepoApp(selectedApp, { conversationId: summary.id });
                }
                readyUrl = await ensureTranscriptDevPreview(bootstrap, {
                    conversationId: summary.id,
                    projectId: project.id,
                    // `refreshFromProjectRoot` above already selected the authoritative Work Hub
                    // project. Refreshing again after an app choice discards the live transition and
                    // can restart the same app twice; wait on the current managed launch instead.
                    skipConversationPortProbe: true,
                });
            } catch (error) {
                // A throwing detection/launch must still resolve the chip: "Starting preview…"
                // otherwise stays up with nothing left to clear it.
                if (launchGeneration === ctx.previewLaunchGeneration) {
                    ctx.host.transcriptPreviewRequestRunning = false;
                    ctx.host.transcriptPreviewRequestPending = false;
                    ctx.syncHeaderPreviewRunButton(project, summary);
                    refreshPreviewComposer();
                    MobileSnackbar.show(error instanceof Error ? error.message : String(error), { kind: 'warning' });
                }
                return;
            }
            if (launchGeneration !== ctx.previewLaunchGeneration) {
                return;
            }
            if (ctx.host.transcriptPreviewSuppressedByUser) {
                // Stopped while launching: release the request this launch still owns.
                ctx.host.transcriptPreviewRequestRunning = false;
                ctx.host.transcriptPreviewRequestPending = false;
                refreshPreviewComposer();
                return;
            }
            if (readyUrl) {
                if (options?.revealPreviewTab) {
                    revealPreviewTab();
                }
                ctx.adoptReadyTranscriptPreview(project, summary, readyUrl);
                refreshPreviewComposer();
                return;
            }
            if (!detected.descriptor) {
                // Neither detection nor .qaap/preview.json yields a command: say so, with a retry,
                // instead of handing the start to the agent (which cannot start a server anyway).
                console.warn('[qaap-preview] no start command detected for project', { projectId: project.id });
                ctx.host.transcriptPreviewRequestRunning = false;
                ctx.host.transcriptPreviewRequestPending = false;
                ctx.syncHeaderPreviewRunButton(project, summary);
                refreshPreviewComposer();
                MobileSnackbar.show(
                    nls.localize(
                        'qaap/mobileProjects/previewNoStartCommand',
                        'No start command found — add a dev/start script or .qaap/preview.json',
                    ),
                    {
                        kind: 'warning',
                        duration: 8000,
                        actionLabel: nls.localize('qaap/mobileProjects/previewRetry', 'Retry'),
                        onAction: () => {
                            void requestTranscriptPreviewExtracted(ctx, project, summary, options);
                        },
                    },
                );
                return;
            }
            if (detected.descriptor) {
                const failure = bootstrap.getStateSnapshot?.();
                MobileSnackbar.show(
                    failure?.error
                        ?? nls.localize(
                            'qaap/mobileProjects/previewDidNotStart',
                            'Preview did not start. Check the Dev terminal and retry.',
                        ),
                    { kind: 'warning' },
                );
                void ctx.discoverAndMountTranscriptPreviewIfReady(project, summary);
                ctx.host.transcriptPreviewRequestRunning = false;
                ctx.host.transcriptPreviewRequestPending = false;
                ctx.syncHeaderPreviewRunButton(project, summary);
                refreshPreviewComposer();
                return;
            }
            if (!allowAgentFallback) {
                MobileSnackbar.show(
                    nls.localize(
                        'qaap/mobileProjects/previewNoRunnableApp',
                        'No runnable app was detected in this project. Ask the agent to generate one, then retry.',
                    ),
                    { kind: 'warning' },
                );
                ctx.host.transcriptPreviewRequestRunning = false;
                ctx.host.transcriptPreviewRequestPending = false;
                ctx.syncHeaderPreviewRunButton(project, summary);
                refreshPreviewComposer();
                return;
            }
        } else if (!allowAgentFallback) {
            ctx.host.transcriptPreviewRequestRunning = false;
            ctx.host.transcriptPreviewRequestPending = false;
            ctx.syncHeaderPreviewRunButton(project, summary);
            refreshPreviewComposer();
            return;
        }

        const message = nls.localize(
            'qaap/mobileProjects/previewAgentRequest',
            'Prepare this app for live in-IDE preview. Qaap starts the dev server from the detected entry point (a dev, start, serve or develop script, or .qaap/preview.json) in a dedicated terminal with hot reload — do NOT run long-lived dev commands in shell (pnpm dev, npm start, vite, next dev, etc.); shell tools time out after ~30s and break preview. Install dependencies only if node_modules is missing. Fix build/typecheck issues with one-shot commands. Confirm dependencies are installed and state whether a runnable entry point exists; if none exists, create .qaap/preview.json and say so. Never describe the app as running on localhost.',
        );
        ctx.host.transcriptPreviewRequestRunning = true;
        ctx.host.transcriptPreviewRequestPending = true;
        // The agent may never start a server (blocked shell, no entry point). Without this watchdog
        // the "Starting preview…" chip would wait forever: release it after a bounded wait instead.
        window.setTimeout(() => {
            const stalled = isStalledPreviewAgentFallback({
                launchGeneration,
                currentGeneration: ctx.previewLaunchGeneration,
                // Running alone keeps the chip up too: the sync path may clear Pending first.
                stillPending: !!ctx.host.transcriptPreviewRequestPending || !!ctx.host.transcriptPreviewRequestRunning,
                hasPreviewUrl: !!ctx.host.projects.find(candidate => candidate.id === project.id)?.previewUrl,
                suppressedByUser: !!ctx.host.transcriptPreviewSuppressedByUser,
            });
            if (!stalled) {
                return;
            }
            console.warn('[qaap-preview] agent fallback produced no live preview before the wait ran out', {
                projectId: project.id,
                conversationId: summary.id,
                waitMs: TRANSCRIPT_PREVIEW_AGENT_FALLBACK_TIMEOUT_MS,
            });
            ctx.host.transcriptPreviewRequestRunning = false;
            ctx.host.transcriptPreviewRequestPending = false;
            ctx.syncHeaderPreviewRunButton(project, summary);
            refreshPreviewComposer();
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobileProjects/previewDidNotStart',
                    'Preview did not start. Check the Dev terminal and retry.',
                ),
                { kind: 'warning', duration: 8000 },
            );
        }, TRANSCRIPT_PREVIEW_AGENT_FALLBACK_TIMEOUT_MS);
        refreshPreviewComposer();
        if (options?.revealPreviewTab) {
            revealPreviewTab();
        } else {
            ctx.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'preview');
        }
        ctx.updateTranscriptPreviewRunButtonState();
        if (summary.cwd) {
            ctx.host.setAutoVerifyEnabled(summary.cwd, true);
            ctx.host.refreshTranscriptChecksViews(project, summary);
        }
        ctx.renderPreviewTab(project, summary);
        ctx.syncHeaderPreviewRunButton(project, summary);
        try {
            await ctx.host.submitTranscriptViaBackendConversation(project, summary, message, {
                selectedAgentId: ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                modeId: ctx.host.transcriptComposerModeId,
                approvalPolicyId: reconcileAgentApprovalPolicyId(
                    ctx.host.transcriptComposerApprovalPolicyId,
                    summary.cwd,
                ),
            });
            // Stop may have landed while submit was still creating the turn — cancel again now
            // that the request exists, same as composer Stop after the message is in flight.
            if (launchGeneration !== ctx.previewLaunchGeneration || ctx.host.transcriptPreviewSuppressedByUser) {
                ctx.cancelPreviewAgentTurn(project, summary);
                return;
            }
            ctx.host.transcriptScheduleRefresh?.();
        } catch (error) {
            if (launchGeneration !== ctx.previewLaunchGeneration || ctx.host.transcriptPreviewSuppressedByUser) {
                ctx.cancelPreviewAgentTurn(project, summary);
                return;
            }
            ctx.host.transcriptPreviewRequestPending = false;
            MobileSnackbar.show(error instanceof Error ? error.message : String(error), { kind: 'warning' });
        } finally {
            if (launchGeneration === ctx.previewLaunchGeneration && !ctx.host.transcriptPreviewSuppressedByUser) {
                ctx.host.transcriptPreviewRequestRunning = false;
                if (ctx.host.executionSurfaceTabsUi.executionSurfaceTabForProject(project) === 'preview'
                    && ctx.matchesActivePreviewSummary(summary)
                    && ctx.transcriptPreviewProjectId === project.id) {
                    ctx.renderPreviewTab(project, summary);
                }
                ctx.syncHeaderPreviewRunButton(project, summary);
            } else {
                ctx.host.transcriptPreviewRequestRunning = false;
            }
            refreshPreviewComposer();
        }
}

export function adoptReadyTranscriptPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        readyUrl: string,): MobileProjectEntry {
        // ALWAYS record the ready URL, even when the user stayed on the Chat view. Recording only
        // on Preview meant a chat-dwelling user never got an actionable "Open preview" pill.
        const refreshed = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
        const effectiveUrl = resolveTranscriptPreviewOpenUrl({
            candidateUrl: readyUrl,
            project: refreshed,
            bootstrap: ctx.host.projectBootstrap,
            appliesToProject: ctx.bootstrapAppliesToProject(refreshed),
        });
        const readyProject = { ...refreshed, previewUrl: effectiveUrl };
        ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === refreshed.id
            ? readyProject
            : candidate);
        if (ctx.host.transcriptOpenProject?.id === readyProject.id) {
            ctx.host.transcriptOpenProject = readyProject;
        }
        void ctx.host.projectsService.recordProjectPreviewUrl(readyProject, effectiveUrl);
        ctx.host.transcriptPreviewRequestRunning = false;
        ctx.host.transcriptPreviewRequestPending = false;
        const previewTabActive = ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview';
        if (ctx.matchesActivePreviewSummary(summary) || previewTabActive) {
            ctx.stageTranscriptPreviewReadyUrl(ctx.previewScopeId(summary), effectiveUrl);
            if (previewTabActive) {
                ctx.renderPreviewTab(readyProject, summary);
            } else {
                ctx.host.transcriptScheduleRefresh?.();
            }
        }
        ctx.syncHeaderPreviewRunButton(readyProject, summary);
        return readyProject;
}

