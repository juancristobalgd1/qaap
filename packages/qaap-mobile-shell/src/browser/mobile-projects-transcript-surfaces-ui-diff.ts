import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
// Extracted from mobile-projects-transcript-surfaces-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { resolveTranscriptPreviewOpenUrl } from './qaap-transcript-preview-effective-url';
import {
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { reconcileAgentApprovalPolicyId } from '../common/qaap-sticky-composer-approval-policy';
import { ensureTranscriptDevPreview } from './qaap-transcript-preview-bootstrap';
import { MobileSnackbar } from '@theia/qaap-mobile-mechanics/lib/browser/mobile-snackbar';
import type { MobileProjectEntry } from './mobile-projects-types';

export async function requestTranscriptPreviewExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        options?: {
            readonly revealPreviewTab?: boolean;
            readonly deferPreviewTabUntilReady?: boolean;
            readonly allowAgentFallback?: boolean;
        },): Promise<void> {
        if (ctx.host.transcriptPreviewRequestRunning) {
            return;
        }
        ctx.host.transcriptPreviewSuppressedByUser = false;
        const launchGeneration = ++ctx.previewLaunchGeneration;
        const allowAgentFallback = options?.allowAgentFallback !== false;
        const revealPreviewTab = (): void => {
            ctx.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'preview');
            ctx.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab?.('preview');
            ctx.host.executionSurfaceTabsUi.selectTranscriptTab?.('preview', project, summary);
        };
        const refreshPreviewComposer = (): void => {
            ctx.host.transcriptStickyComposerUi?.refreshComposerQuickActions?.();
            ctx.host.transcriptStickyComposerUi?.refreshComposerActivityStack?.();
        };
        if (options?.revealPreviewTab && !options.deferPreviewTabUntilReady) {
            revealPreviewTab();
        }
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
            ctx.updateTranscriptPreviewRunButtonState();
            await bootstrap.refreshFromProjectRoot(projectRoot, project.id);
            const detected = bootstrap.getStateSnapshot();
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
            const readyUrl = await ensureTranscriptDevPreview(bootstrap, {
                conversationId: summary.id,
                projectId: project.id,
                // `refreshFromProjectRoot` above already selected the authoritative Work Hub
                // project. Refreshing again after an app choice discards the live transition and
                // can restart the same app twice; wait on the current managed launch instead.
                skipConversationPortProbe: true,
            });
            if (launchGeneration !== ctx.previewLaunchGeneration || ctx.host.transcriptPreviewSuppressedByUser) {
                return;
            }
            if (readyUrl) {
                if (options?.revealPreviewTab && options.deferPreviewTabUntilReady) {
                    revealPreviewTab();
                }
                ctx.adoptReadyTranscriptPreview(project, summary, readyUrl);
                refreshPreviewComposer();
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
            'Prepare this app for live in-IDE preview. Qaap starts and keeps the dev server running in a dedicated terminal with hot reload — do NOT run long-lived dev commands in shell (pnpm dev, npm start, vite, next dev, etc.); shell tools time out after ~30s and break preview. Install dependencies only if node_modules is missing. Fix build/typecheck issues with one-shot commands. When ready, reply with the expected local port (e.g. 5173) and confirm dependencies are installed.',
        );
        ctx.host.transcriptPreviewRequestRunning = true;
        ctx.host.transcriptPreviewRequestPending = true;
        refreshPreviewComposer();
        // Header Play keeps its historical immediate reveal. The composer Run app pill can defer
        // the surface change so the current pill visibly processes until the server is reachable.
        if (!options?.deferPreviewTabUntilReady) {
            ctx.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'preview');
        }
        ctx.updateTranscriptPreviewRunButtonState();
        if (summary.cwd) {
            ctx.host.setAutoVerifyEnabled(summary.cwd, true);
            ctx.host.refreshTranscriptChecksViews(project, summary);
        }
        if (!options?.deferPreviewTabUntilReady) {
            ctx.renderPreviewTab(project, summary);
        }
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

