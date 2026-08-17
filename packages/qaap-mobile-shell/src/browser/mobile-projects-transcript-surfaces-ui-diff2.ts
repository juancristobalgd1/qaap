// @ts-nocheck
// Extracted from mobile-projects-transcript-surfaces-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import {
    mountEmbeddedAgentPreviewChrome,
    type EmbeddedAgentPreviewChrome,
} from '@theia/qaap-adapters/lib/browser/qaap-agent-preview-chrome';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import type { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import type { QaapPreviewInspectorDeps } from '@theia/qaap-adapters/lib/browser/qaap-preview-inline-inspector';
import type { AnnotationComposerSessionControls } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-popover';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import { reconcileAgentApprovalPolicyId, type QaapAgentApprovalPolicyId } from '../common/qaap-sticky-composer-approval-policy';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import { resolveTranscriptWorkspaceCwd, isTranscriptWorkspaceFilesystemPath } from '../common/qaap-transcript-workspace-cwd';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import type { ExecutionSurfaceTabId } from '../common/qaap-execution-surface-tabs';
import {
    conversationShouldWatchDevPreview,
    findTranscriptPreviewUrlFromConversation,
    previewPageTitleMatchesProjectName,
    resolveReadyTranscriptPreviewUrlFromProbe,
} from '../common/qaap-transcript-preview-offer';
import { fetchQaapCurrentDevPreview, probeQaapDevPreviewPort, probeQaapIdentityPreview, waitForQaapDevPreviewPort } from './qaap-dev-preview-client';
import {
    findQaapIdentityPreviewUrl,
    isLocalQaapPreviewOrigin,
    parseQaapIdentityPreviewRequestPath,
    resolveDevPreviewPublicOrigin,
} from '../common/qaap-dev-preview';
import { ensureTranscriptDevPreview, extractDevPreviewPortFromUrl } from './qaap-transcript-preview-bootstrap';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import type { QaapMonorepoAppCandidate } from './qaap-project-bootstrap-types';
import { isTerminalDoesNotExistError } from './qaap-project-bootstrap-dev-errors';
import {
    buildQaapPreviewId,
    normalizeQaapPreviewConversationId,
    qaapPreviewProjectIdMatches,
    type QaapPreviewIdentity,
} from '../common/qaap-preview-identity';
import type { QaapDiffReviewWidget } from './qaap-diff-review-widget';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import {
    mountTranscriptFilesView,
    type TranscriptFilesViewServices,
} from './qaap-transcript-files-view';
import {
    createTranscriptTerminalStagingHost,
    createTranscriptTerminalSurface,
    markTranscriptTerminalRestorable,
    scheduleTranscriptTerminalResize,
    type TranscriptTerminalPersistedWorkspace,
    type TranscriptTerminalSurface,
    type TranscriptTerminalViewServices,
} from './qaap-transcript-terminal-view';
import { resolveInteractiveAgentCliBin, resolveInteractiveAgentLoginCommand } from '../common/qaap-agent-tui-command';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import {
    TranscriptWorkspaceSurfacesCache,
    type TranscriptWorkspaceSurfaceKey,
} from './qaap-transcript-workspace-surfaces-cache';
import type { MobileProjectsTranscriptHistoryUi } from './mobile-projects-transcript-history-ui';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectsTranscriptMessagesUi } from './mobile-projects-transcript-messages-ui';
import {
    pathsEqual as pathsEqualHelper,
    transcriptConversationMeta as transcriptConversationMetaHelper,
    resolveProjectScopedWorkspaceKey as resolveProjectScopedWorkspaceKeyHelper,
    resolveTranscriptTerminalTabTitle as resolveTranscriptTerminalTabTitleHelper,
    toPersistedTerminalWorkspace as toPersistedTerminalWorkspaceHelper,
} from './mobile-projects-transcript-surfaces-helpers';

export async function requestTranscriptPreviewExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        if (ctx.host.transcriptPreviewRequestRunning) {
            return;
        }
        ctx.host.transcriptPreviewSuppressedByUser = false;
        const launchGeneration = ++ctx.previewLaunchGeneration;
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/previewStarting', 'Levantando preview…'),
            { duration: 2200 },
        );
        // Keep the header play control mounted across the whole request lifecycle.
        ctx.syncHeaderPreviewRunButton(project, summary);
        const latestProject = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
        if (latestProject.previewUrl && ctx.host.onResumePreview) {
            if (launchGeneration !== ctx.previewLaunchGeneration || ctx.host.transcriptPreviewSuppressedByUser) {
                return;
            }
            await ctx.host.onResumePreview(latestProject);
            ctx.syncHeaderPreviewRunButton(project, summary);
            return;
        }

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
            // Agent troubleshooting remains the fallback only when that launch cannot get ready.
            ctx.host.transcriptPreviewRequestRunning = true;
            ctx.host.transcriptPreviewRequestPending = true;
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
                ctx.adoptReadyTranscriptPreview(project, summary, readyUrl);
                return;
            }
        }

        const message = nls.localize(
            'qaap/mobileProjects/previewAgentRequest',
            'Prepare this app for live in-IDE preview. Qaap starts and keeps the dev server running in a dedicated terminal with hot reload — do NOT run long-lived dev commands in shell (pnpm dev, npm start, vite, next dev, etc.); shell tools time out after ~30s and break preview. Install dependencies only if node_modules is missing. Fix build/typecheck issues with one-shot commands. When ready, reply with the expected local port (e.g. 5173) and confirm dependencies are installed.',
        );
        ctx.host.transcriptPreviewRequestRunning = true;
        ctx.host.transcriptPreviewRequestPending = true;
        // Pin Preview before submit — create/open conversation paths force Messages and would
        // otherwise tear the header play control out mid-click.
        ctx.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'preview');
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
                ctx.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'preview');
                ctx.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab('preview');
                ctx.host.root.classList.toggle('theia-mod-project-surface-chat', false);
                ctx.host.root.classList.toggle('theia-mod-project-surface-tools', true);
                if (ctx.matchesActivePreviewSummary(summary) && ctx.transcriptPreviewProjectId === project.id) {
                    ctx.renderPreviewTab(project, summary);
                }
                ctx.syncHeaderPreviewRunButton(project, summary);
            } else {
                ctx.host.transcriptPreviewRequestRunning = false;
            }
        }
}

export function adoptReadyTranscriptPreviewExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        readyUrl: string,): MobileProjectEntry {
        // ALWAYS record the ready URL, even when the user stayed on the Chat view. Recording only
        // on Preview meant a chat-dwelling user never got an actionable "Open preview" pill.
        const refreshed = ctx.host.projects.find(candidate => candidate.id === project.id) ?? project;
        const readyProject = { ...refreshed, previewUrl: readyUrl };
        ctx.host.projects = ctx.host.projects.map(candidate => candidate.id === refreshed.id
            ? readyProject
            : candidate);
        if (ctx.host.transcriptOpenProject?.id === readyProject.id) {
            ctx.host.transcriptOpenProject = readyProject;
        }
        void ctx.host.projectsService.recordProjectPreviewUrl(readyProject, readyUrl);
        ctx.host.transcriptPreviewRequestRunning = false;
        ctx.host.transcriptPreviewRequestPending = false;
        const previewTabActive = ctx.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview';
        if (ctx.matchesActivePreviewSummary(summary) || previewTabActive) {
            ctx.stageTranscriptPreviewReadyUrl(ctx.previewScopeId(summary), readyUrl);
            if (previewTabActive) {
                ctx.renderPreviewTab(readyProject, summary);
            } else {
                ctx.host.transcriptScheduleRefresh?.();
            }
        }
        ctx.syncHeaderPreviewRunButton(readyProject, summary);
        return readyProject;
}

