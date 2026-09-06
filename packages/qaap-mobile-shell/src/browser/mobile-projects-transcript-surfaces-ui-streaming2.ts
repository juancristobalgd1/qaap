// @ts-nocheck
// Extracted from mobile-projects-transcript-surfaces-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { invalidateVerifyWorkspaceSnapshots } from '../common/qaap-verify-commit-readiness';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import {
    mountEmbeddedAgentPreviewChrome,
    type EmbeddedAgentPreviewChrome,
} from '@theia/qaap-adapters/lib/browser/qaap-agent-preview-chrome';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { resolveTranscriptPreviewOpenUrl } from './qaap-transcript-preview-effective-url';
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
import { createTranscriptReviewChrome } from './qaap-transcript-review-chrome';
import {
    pathsEqual as pathsEqualHelper,
    transcriptConversationMeta as transcriptConversationMetaHelper,
    resolveProjectScopedWorkspaceKey as resolveProjectScopedWorkspaceKeyHelper,
    resolveTranscriptTerminalTabTitle as resolveTranscriptTerminalTabTitleHelper,
    toPersistedTerminalWorkspace as toPersistedTerminalWorkspaceHelper,
} from './mobile-projects-transcript-surfaces-helpers';

export async function mountTranscriptReviewWidgetExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        const host = ctx.host.transcriptReviewHost;
        if (!host || !ctx.host.createDiffReviewWidget) {
            return;
        }
        const cwd = summary.cwd ?? ctx.host.projectsService.getProjectCwd(project);
        if (!cwd) {
            host.replaceChildren();
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-review-note';
            note.textContent = nls.localize(
                'qaap/mobileProjects/reviewUnavailable',
                'Review is unavailable for this conversation (no workspace path).',
            );
            host.append(note);
            return;
        }
        const chrome = createTranscriptReviewChrome(
            host,
            ctx.host.transcriptHistoryPanelOpen,
            ctx.host.transcriptHistoryPanelHeightPx,
        );
        const { diffHost, checksHost, historyToggleHost, historyResizeHandle, historyPanel } = chrome;
        ctx.host.transcriptReviewDiffHost = diffHost;
        ctx.host.transcriptReviewChecksHost = checksHost;
        ctx.host.transcriptHistoryRoot = cwd;
        ctx.host.transcriptHistoryUi.installTranscriptHistoryResize(historyResizeHandle, historyPanel, host);

        // A VPS task's summary.cwd is authoritative and can point at an isolated worktree.
        const rootUri = FileUri.create(cwd).toString();
        if (!ctx.host.diffReviewWidget) {
            ctx.host.diffReviewWidget = await ctx.host.createDiffReviewWidget();
        }
        if (ctx.host.transcriptReviewHost !== host || !diffHost.isConnected) {
            return;
        }
        ctx.host.diffReviewWidget.enableTranscriptEmbed({ externalChrome: true });
        ctx.host.diffReviewWidget.node.classList.add('theia-mobile-transcript-diff-embed');
        ctx.host.diffReviewWidget.setTranscriptAgentFeedbackHandler(async message => {
            await ctx.submitTranscriptReviewFeedback(project, summary, message);
        });
        ctx.host.diffReviewWidget.setTranscriptCloseHandler(() => {
            ctx.host.executionSurfaceTabsUi.selectTranscriptTab('messages', project, summary);
        });
        ctx.host.attachDiffReviewWidget(diffHost);
        ctx.host.diffReviewWidget.setRepositoryContext({
            rootUri,
            rootFsPath: cwd,
            isActiveWorkspace: project.isCurrent,
        });
        ctx.host.diffReviewWidget.setCommitReadinessProvider(
            () => ({
                checksLoading: ctx.host.verifyChecksLoading,
                running: ctx.host.verifyRunning,
                results: ctx.host.verifyResults ?? [],
            }),
            () => {
                invalidateVerifyWorkspaceSnapshots(ctx.host.verifyResults ?? []);
                ctx.host.renderChecksSection(checksHost, project, summary, { embedded: true });
            },
        );
        ctx.host.renderChecksSection(checksHost, project, summary, { embedded: true });
        ctx.host.transcriptHistoryUi.renderTranscriptHistoryToggle(historyToggleHost, historyPanel, historyResizeHandle, cwd);
        ctx.host.transcriptHistoryUi.renderTranscriptHistoryPanel(historyPanel, cwd);
}

export async function submitTranscriptReviewFeedbackExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        message: string,): Promise<void> {
        const chatHost = ctx.host.transcriptChatHost;
        if (!chatHost) {
            return;
        }
        try {
            await ctx.host.submitTranscriptViaBackendConversation(project, summary, message, {
                selectedAgentId: ctx.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                modeId: ctx.host.transcriptComposerModeId,
                approvalPolicyId: reconcileAgentApprovalPolicyId(
                    ctx.host.transcriptComposerApprovalPolicyId,
                    summary.cwd,
                ),
            });
            ctx.host.executionSurfaceTabsUi.selectTranscriptTab('messages', project, summary);
        } catch (error) {
            ctx.host.messageService?.error(error instanceof Error ? error.message : String(error));
        }
}

export function detachTranscriptReviewWidgetExtracted(ctx: any): void {
        const diffHost = ctx.host.transcriptReviewDiffHost;
        if (ctx.host.diffReviewWidget?.isAttached && diffHost?.contains(ctx.host.diffReviewWidget.node)) {
            ctx.host.detachDiffReviewWidgetFromHost();
            ctx.host.diffReviewWidget.node.classList.remove('theia-mobile-transcript-diff-embed');
        }
        ctx.host.diffReviewWidget?.setTranscriptAgentFeedbackHandler(undefined);
        ctx.host.diffReviewWidget?.setTranscriptCloseHandler(undefined);
        ctx.host.diffReviewWidget?.setReviewStatsChangeHandler(undefined);
        ctx.host.transcriptReviewDiffHost = undefined;
        ctx.host.transcriptReviewChecksHost = undefined;
        ctx.host.transcriptHistoryRoot = undefined;
        ctx.host.transcriptHistoryLoading = false;
}

export function getOrCreateOffscreenPreviewHostExtracted(ctx: any): HTMLElement {
        if (!ctx.offscreenPreviewHostElement) {
            const host = document.createElement('div');
            host.id = 'qaap-preview-offscreen-host';
            host.style.display = 'none';
            document.body.appendChild(host);
            ctx.offscreenPreviewHostElement = host;
        }
        return ctx.offscreenPreviewHostElement;
}

export function disposeTranscriptEmbeddedPreviewExtracted(ctx: any, conversationScopeId?: string): void {
        const targetScopeId = conversationScopeId ?? ctx.transcriptPreviewConversationScopeId;
        ctx.stopTranscriptPreviewIdentityWatch();
        if (targetScopeId) {
            const cached = ctx.embeddedPreviewByConversationScopeId.get(targetScopeId);
            if (cached) {
                cached.dispose();
                ctx.embeddedPreviewByConversationScopeId.delete(targetScopeId);
            }
            if (ctx.host.transcriptEmbeddedPreview === cached) {
                ctx.host.transcriptEmbeddedPreview = undefined;
            }
            ctx.setMountedPreviewUrl(targetScopeId, undefined);
        } else if (ctx.host.transcriptEmbeddedPreview) {
            ctx.host.transcriptEmbeddedPreview.dispose();
            ctx.host.transcriptEmbeddedPreview = undefined;
        }
}

export function disposePreviewForConversationExtracted(ctx: any, summary: Pick<QaapAgentConversationSummaryDTO, 'id'>): void {
        const scopeId = ctx.previewScopeId(summary);
        if (!scopeId) {
            return;
        }
        ctx.disposeTranscriptEmbeddedPreview(scopeId);
        ctx.clearPreviewRuntimeForConversation(scopeId);
}

export function disposeTranscriptTerminalSlidesForConversationExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,): void {
        const workspaceKey = ctx.resolveTranscriptWorkspaceKey(project, summary);
        if (workspaceKey) {
            ctx.disposeTranscriptTerminalSlides(workspaceKey);
        }
}

export function suspendTranscriptPreviewIframeExtracted(ctx: any): void {
        ctx.stopTranscriptPreviewIdentityWatch();
        const chrome = ctx.host.transcriptEmbeddedPreview;
        if (!chrome) {
            return;
        }
        const conversationScopeId = ctx.transcriptPreviewConversationScopeId;
        const isEmptyPlaceholder = chrome.root.classList.contains('theia-mod-empty-preview');
        const stagedUrl = (conversationScopeId ? ctx.mountedPreviewUrl(conversationScopeId) : undefined)
            ?? ctx.getTranscriptEmbeddedPreviewUrl();

        if (conversationScopeId && !isEmptyPlaceholder) {
            const offscreen = ctx.getOrCreateOffscreenPreviewHost();
            offscreen.appendChild(chrome.root);
            if (stagedUrl) {
                ctx.setProbeReadyPreviewUrl(conversationScopeId, stagedUrl);
            }
        } else {
            chrome.dispose();
            if (conversationScopeId) {
                ctx.embeddedPreviewByConversationScopeId.delete(conversationScopeId);
                ctx.setMountedPreviewUrl(conversationScopeId, undefined);
            }
        }
        ctx.host.transcriptEmbeddedPreview = undefined;
        ctx.executionPreviewHost()?.replaceChildren();
}

export function clearTranscriptEmptyPreviewChromeExtracted(ctx: any): void {
        const root = ctx.host.transcriptEmbeddedPreview?.root;
        if (!root?.classList.contains('theia-mod-empty-preview')) {
            return;
        }
        root.classList.remove('theia-mod-empty-preview');
        root.querySelector('.theia-mobile-transcript-preview-empty-overlay')?.remove();
}

export function getTranscriptEmbeddedPreviewUrlExtracted(ctx: any): string | undefined {
        const chrome = ctx.host.transcriptEmbeddedPreview;
        if (!chrome) {
            return undefined;
        }
        const input = chrome.root.querySelector<HTMLInputElement>('.theia-mini-browser-url-field input');
        const raw = input?.value?.trim();
        return raw ? normalizePreviewUrlForSameOrigin(raw) : undefined;
}

export function mountTranscriptEmbeddedPreviewExtracted(ctx: any, host: HTMLElement,
        previewUrl: string,
        project: MobileProjectEntry,
        summary?: QaapAgentConversationSummaryDTO,): void {
        const normalized = resolveTranscriptPreviewOpenUrl({
            candidateUrl: previewUrl,
            project,
            bootstrap: ctx.host.projectBootstrap,
            appliesToProject: ctx.bootstrapAppliesToProject(project),
        });
        const conversationScopeId = ctx.previewScopeId(summary);

        if (ctx.transcriptPreviewConversationScopeId && ctx.transcriptPreviewConversationScopeId !== conversationScopeId) {
            ctx.suspendTranscriptPreviewIframe();
        }

        ctx.transcriptPreviewProjectId = project.id;
        ctx.transcriptPreviewConversationScopeId = conversationScopeId;
        ctx.scheduleTranscriptPreviewIdentityWatch(project);

        let chrome = ctx.embeddedPreviewByConversationScopeId.get(conversationScopeId);
        if (chrome) {
            ctx.host.transcriptEmbeddedPreview = chrome;
            ctx.clearTranscriptEmptyPreviewChrome();
            const root = chrome.root;
            const current = ctx.getTranscriptEmbeddedPreviewUrl();
            if (!host.contains(root)) {
                host.replaceChildren(root);
            }
            if (current !== normalized) {
                chrome.setUrl(normalized);
            }
            ctx.wireTranscriptPreviewAnnotationScope(project, normalized);
            ctx.setMountedPreviewUrl(conversationScopeId, normalized);
            ctx.syncHeaderPreviewRunButton(project, summary);
            return;
        }

        chrome = mountEmbeddedAgentPreviewChrome(host, {
            url: normalized,
            historyScope: project.id,
            messageService: ctx.host.messageService,
            clipboard: ctx.host.previewClipboard,
            previewSurfaces: ctx.host.previewSurfaceRegistry,
            inspectorDeps: ctx.host.previewInspectorDeps,
            notify: (message, kind) => {
                MobileSnackbar.show(message, { kind: kind === 'warn' ? 'warning' : 'success' });
            },
            openExternal: target => {
                window.open(target, '_blank', 'noopener,noreferrer');
            },
            getAnnotationScope: () => ctx.resolvePreviewAnnotationScope(project, normalized),
            composerSession: ctx.host.resolveAnnotationComposerSession(),
        });
        ctx.embeddedPreviewByConversationScopeId.set(conversationScopeId, chrome);
        ctx.host.transcriptEmbeddedPreview = chrome;
        ctx.wireTranscriptPreviewAnnotationScope(project, normalized);
        ctx.setMountedPreviewUrl(conversationScopeId, normalized);
        ctx.syncHeaderPreviewRunButton(project, summary);
}

export function wireTranscriptPreviewAnnotationScopeExtracted(ctx: any, project: MobileProjectEntry, previewUrl: string): void {
        const frame = ctx.host.transcriptEmbeddedPreview?.frame;
        const surface = ctx.host.previewSurfaceRegistry?.getSurfaceForFrame(frame);
        surface?.picker.setAnnotationScopeProvider(() => ctx.resolvePreviewAnnotationScope(project, previewUrl));
        surface?.picker.setComposerSession(ctx.host.resolveAnnotationComposerSession());
}

export function resolvePreviewAnnotationScopeExtracted(ctx: any, project: MobileProjectEntry, previewUrl: string): {
        previewId: string;
        workspaceId: string;
        threadId: string;
        previewUrl: string;
        route: string;
        viewportMode: 'desktop' | 'mobile';
        viewportWidth: number;
        viewportHeight: number;
    } {
        const live = ctx.getTranscriptEmbeddedPreviewUrl() || previewUrl;
        let stablePreviewUrl = previewUrl;
        let route = '/';
        try {
            const parsed = new URL(live, window.location.href);
            stablePreviewUrl = parsed.origin;
            route = `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
        } catch {
            route = '/';
        }
        const narrow = typeof matchMedia === 'function'
            && matchMedia('(max-width: 767px), (pointer: coarse)').matches;
        const frame = ctx.host.transcriptEmbeddedPreview?.frame;
        const identity = ctx.resolveTranscriptPreviewIdentity(project, ctx.host.transcriptOpenSummary);
        return {
            previewId: buildQaapPreviewId(identity),
            workspaceId: project.id,
            threadId: ctx.host.transcriptOpenSummaryId
                ?? ctx.host.transcriptLastConv?.id
                ?? 'default',
            previewUrl: stablePreviewUrl,
            route,
            viewportMode: narrow ? 'mobile' : 'desktop',
            viewportWidth: frame?.clientWidth || window.innerWidth,
            viewportHeight: frame?.clientHeight || window.innerHeight,
        };
}

export function resolveTranscriptPreviewIdentityExtracted(ctx: any, project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO | undefined,): QaapPreviewIdentity {
        const conversationId = summary?.id
            ?? ctx.host.transcriptOpenSummaryId
            ?? ctx.host.transcriptLastConv?.id
            ?? 'default';
        const conversation = ctx.host.transcriptLastConv?.id === conversationId
            ? ctx.host.transcriptLastConv
            : undefined;
        const runId = ctx.bootstrapAppliesToProject(project)
            ? ctx.host.projectBootstrap?.getStateSnapshot().previewRunId
            : undefined;
        const fallbackRunId = [...(conversation?.messages ?? [])].reverse()
            .find(message => message.role === 'user' && !!message.taskId)?.taskId
            ?? `turn-${summary?.turnStartedAt ?? summary?.updatedAt ?? conversation?.updatedAt ?? 0}`;
        return { projectId: project.id, conversationId, runId: runId ?? fallbackRunId };
}

export async function claimTranscriptPreviewExecutionExtracted(ctx: any, _project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        port: number,
        fallbackUrl: string,): Promise<string | undefined> {
        const bootstrap = ctx.host.projectBootstrap;
        if (!bootstrap) {
            return undefined;
        }
        // claimPreviewExecution allocates a per-conversation processId; do not require the
        // previous section's global process UUID or section B would never reserve its own preview.
        const claim = await bootstrap.claimPreviewExecution(port, summary.id);
        return claim.kind === 'claimed' ? claim.previewUrl ?? fallbackUrl : undefined;
}
