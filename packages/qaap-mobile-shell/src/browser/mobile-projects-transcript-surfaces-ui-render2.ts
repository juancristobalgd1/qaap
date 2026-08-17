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
    qaapPreviewFileUriMatchesProjectName,
    qaapPreviewProjectIdMatches,
    type QaapPreviewIdentity,
} from '../common/qaap-preview-identity';
import type { QaapDiffReviewWidget } from './qaap-diff-review-widget';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import {
    mountTranscriptFilesView,
    writePendingTranscriptFilesViewMode,
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

export function pickTranscriptPreviewAppExtracted(ctx: any, apps: readonly QaapMonorepoAppCandidate[],): Promise<QaapMonorepoAppCandidate | undefined> {
    ctx.closeTranscriptPreviewAppPicker();
    return new Promise(resolve => {
        let settled = false;
        const picker = document.createElement('div');
        const finish = (app: QaapMonorepoAppCandidate | undefined): void => {
            if (settled) {
                return;
            }
            settled = true;
            ctx.transcriptPreviewAppPickerCancel = undefined;
            document.removeEventListener('keydown', onKeyDown, true);
            picker.remove();
            if (ctx.transcriptPreviewAppPicker === picker) {
                ctx.transcriptPreviewAppPicker = undefined;
            }
            resolve(app);
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(undefined);
            }
        };

        picker.className = 'theia-mobile-transcript-app-picker';
        picker.setAttribute('role', 'dialog');
        picker.setAttribute('aria-modal', 'true');
        const backdrop = document.createElement('button');
        backdrop.type = 'button';
        backdrop.className = 'theia-mobile-transcript-app-picker-backdrop';
        backdrop.tabIndex = -1;
        backdrop.setAttribute('aria-label', nls.localize('qaap/mobileProjects/cancelAppPicker', 'Cancel app selection'));
        backdrop.addEventListener('click', () => finish(undefined));

        const sheet = document.createElement('section');
        sheet.className = 'theia-mobile-transcript-app-picker-sheet';
        const heading = document.createElement('h2');
        heading.id = `qaap-preview-app-picker-${Date.now().toString(36)}`;
        heading.textContent = nls.localize('qaap/mobileProjects/pickPreviewApp', 'Choose app to preview');
        picker.setAttribute('aria-labelledby', heading.id);
        const hint = document.createElement('p');
        hint.textContent = nls.localize(
            'qaap/mobileProjects/pickPreviewAppHint',
            'Qaap will run the selected app in its own managed preview with hot reload.',
        );
        const list = document.createElement('div');
        list.className = 'theia-mobile-transcript-app-picker-list';
        for (const app of apps) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'theia-mobile-transcript-app-picker-item';
            const name = document.createElement('span');
            name.className = 'theia-mobile-transcript-app-picker-name';
            name.textContent = app.name;
            const path = document.createElement('span');
            path.className = 'theia-mobile-transcript-app-picker-path';
            path.textContent = app.relativePath;
            item.append(name, path);
            item.addEventListener('click', () => finish(app));
            list.append(item);
        }
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'theia-mobile-transcript-app-picker-cancel';
        cancel.textContent = nls.localize('qaap/mobileProjects/cancel', 'Cancel');
        cancel.addEventListener('click', () => finish(undefined));
        sheet.append(heading, hint, list, cancel);
        picker.append(backdrop, sheet);
        document.body.append(picker);
        ctx.transcriptPreviewAppPicker = picker;
        ctx.transcriptPreviewAppPickerCancel = () => finish(undefined);
        document.addEventListener('keydown', onKeyDown, true);
        window.setTimeout(() => list.querySelector<HTMLButtonElement>('button')?.focus(), 0);
    });
}

export function closeTranscriptPreviewAppPickerExtracted(ctx: any): void {
    ctx.transcriptPreviewAppPickerCancel?.();
    ctx.transcriptPreviewAppPickerCancel = undefined;
    ctx.transcriptPreviewAppPicker?.remove();
    ctx.transcriptPreviewAppPicker = undefined;
}

export function previewRuntimeForExtracted(ctx: any, conversationScopeId: string): ConversationPreviewRuntimeState {
    let state = ctx.previewRuntimeByConversationId.get(conversationScopeId);
    if (!state) {
        state = {};
        ctx.previewRuntimeByConversationId.set(conversationScopeId, state);
    }
    return state;
}

export function setMountedPreviewUrlExtracted(ctx: any, conversationScopeId: string, url: string | undefined): void {
    const state = ctx.previewRuntimeFor(conversationScopeId);
    if (url === undefined) {
        delete state.mountedUrl;
    } else {
        state.mountedUrl = url;
    }
}

export function setProbeReadyPreviewUrlExtracted(ctx: any, conversationScopeId: string, url: string | undefined): void {
    const state = ctx.previewRuntimeFor(conversationScopeId);
    if (url === undefined) {
        delete state.probeReadyUrl;
    } else {
        state.probeReadyUrl = normalizePreviewUrlForSameOrigin(url);
    }
}

export function setLastSyncedPreviewUrlExtracted(ctx: any, conversationScopeId: string, url: string | undefined): void {
    const state = ctx.previewRuntimeFor(conversationScopeId);
    if (url === undefined) {
        delete state.lastSyncedUrl;
    } else {
        state.lastSyncedUrl = url;
    }
}

export function matchesActivePreviewSummaryExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO): boolean {
    if (ctx.host.transcriptOpenSummaryId === summary.id) {
        return true;
    }
    return ctx.host.agentsHubShellActive
        && !ctx.host.transcriptOpenSummaryId
        && isAgentsHubIdleConversationSummary(summary);
}

export function bootstrapAppliesToProjectExtracted(ctx: any, project: MobileProjectEntry): boolean {
    const bootstrap = ctx.host.projectBootstrap;
    if (!bootstrap?.descriptor) {
        return project.isCurrent === true;
    }
    const projectCwd = ctx.host.projectsService.getProjectCwd(project)
        ?? ctx.host.preparedCwdByProjectId.get(project.id);
    const bootstrapRoot = FileUri.fsPath(bootstrap.descriptor.rootUri);
    if (projectCwd) {
        return ctx.pathsEqual(projectCwd, bootstrapRoot);
    }
    // Hub cards for skip-auth clones often lack `uri`/`isCurrent` while Theia still has another
    // workspace open. Match the pinned bootstrap root by folder name so Preview can adopt it.
    if (qaapPreviewFileUriMatchesProjectName(bootstrap.descriptor.rootUri.toString(), project.name)) {
        return true;
    }
    return project.isCurrent === true;
}

export function bootstrapPreviewUrlForProjectExtracted(ctx: any, project: MobileProjectEntry): string | undefined {
    const bootstrap = ctx.host.projectBootstrap;
    const previewUrl = bootstrap?.previewUrl ?? bootstrap?.previewClaimUrl;
    if (!bootstrap || bootstrap.phase !== 'running' || !previewUrl) {
        return undefined;
    }
    if (!ctx.bootstrapAppliesToProject(project)) {
        return undefined;
    }
    return normalizePreviewUrlForSameOrigin(previewUrl);
}

export function ensurePreviewProjectContextExtracted(ctx: any, project: MobileProjectEntry): void {
    if (ctx.transcriptPreviewProjectId === project.id) {
        return;
    }
    ctx.stopTranscriptPreviewTabProbe();
    ctx.suspendTranscriptPreviewIframe();
    ctx.transcriptPreviewProjectId = project.id;
}

export function mountProjectDetailSurfaceTabExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    tab: TranscriptTab,): void {
    switch (tab) {
        case 'review':
            // 'review' (Changes) is merged into the 'files' tab — set pending
            // view-mode flag and mount the files tab instead.
            writePendingTranscriptFilesViewMode('changes');
            ctx.ensureTranscriptFilesTab(project, summary);
            break;
        case 'preview':
            ctx.renderPreviewTab(project, summary);
            break;
        case 'files':
            ctx.ensureTranscriptFilesTab(project, summary);
            break;
        case 'terminal':
            void ctx.ensureTranscriptTerminalTab(project, summary);
            break;
        default:
            break;
    }
}

export async function mountProjectDetailReviewWidgetExtracted(ctx: any, project: MobileProjectEntry): Promise<void> {
    const host = ctx.host.projectDetailSurfaceTargets?.reviewHost;
    if (!host || !ctx.host.createDiffReviewWidget) {
        return;
    }
    const cwd = ctx.host.projectsService.getProjectCwd(project) ?? ctx.host.preparedCwdByProjectId.get(project.id);
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
    host.replaceChildren();
    const diffHost = document.createElement('div');
    diffHost.className = 'theia-mobile-transcript-review-diff-host';
    host.append(diffHost);
    // Review can be scoped to an agent worktree, not the hub card's clone. Keep the URI and
    // filesystem root aligned so opening a changed/untracked file cannot jump to another repo.
    const rootUri = FileUri.create(cwd).toString();
    if (!ctx.host.diffReviewWidget) {
        ctx.host.diffReviewWidget = await ctx.host.createDiffReviewWidget();
    }
    if (!host.isConnected) {
        return;
    }
    ctx.host.diffReviewWidget.enableTranscriptEmbed({ externalChrome: true });
    ctx.host.diffReviewWidget.node.classList.add('theia-mobile-transcript-diff-embed');
    ctx.host.diffReviewWidget.setTranscriptAgentFeedbackHandler(async () => { /* project-level — use composer below */ });
    ctx.host.diffReviewWidget.setTranscriptCloseHandler(() => {
        const summary = ctx.host.transcriptOpenSummary;
        if (summary) {
            ctx.host.selectTranscriptTab('messages', project, summary);
            return;
        }
        ctx.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'messages');
        ctx.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab('messages');
        ctx.host.executionSurfaceTabsUi.syncExecutionSurfaceChrome(project);
        ctx.host.root.classList.toggle('theia-mod-project-surface-chat', true);
        ctx.host.root.classList.toggle('theia-mod-project-surface-tools', false);
    });
    ctx.host.attachDiffReviewWidget(diffHost);
    ctx.host.diffReviewWidget.setRepositoryContext({
        rootUri,
        rootFsPath: cwd,
        isActiveWorkspace: project.isCurrent,
    });
}

export function executionSurfaceHostExtracted(ctx: any, transcriptHost: HTMLElement | undefined,
    projectDetailHost: HTMLElement | undefined,): HTMLElement | undefined {
    if ((ctx.host.transcriptSheet || ctx.host.agentsHubShellActive) && transcriptHost) {
        return transcriptHost;
    }
    return projectDetailHost ?? transcriptHost;
}

export function executionPreviewHostExtracted(ctx: any): HTMLElement | undefined {
    return ctx.executionSurfaceHost(
        ctx.host.transcriptPreviewHost,
        ctx.host.projectDetailSurfaceTargets?.previewHost,
    );
}

export function executionFilesHostExtracted(ctx: any): HTMLElement | undefined {
    return ctx.executionSurfaceHost(
        ctx.host.transcriptFilesHost,
        ctx.host.projectDetailSurfaceTargets?.filesHost,
    );
}

export function executionTerminalHostExtracted(ctx: any): HTMLElement | undefined {
    return ctx.executionSurfaceHost(
        ctx.host.transcriptTerminalHost,
        ctx.host.projectDetailSurfaceTargets?.terminalHost,
    );
}

export function latestAgentSegmentsExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined): QaapAgentMessageSegmentDTO[] | undefined {
    if (!conv) {
        return undefined;
    }
    for (let i = conv.messages.length - 1; i >= 0; i--) {
        const msg = conv.messages[i];
        if (msg.role !== 'agent') {
            continue;
        }
        const segments = ctx.host.transcriptMessagesUi.resolveTranscriptAgentSegments(conv, msg);
        if (segments && segments.length > 0) {
            return segments;
        }
    }
    return undefined;
}

export function transcriptConversationMetaExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): string {
    return transcriptConversationMetaHelper(project, summary);
}

export function updateTranscriptHeaderExtracted(ctx: any, project: MobileProjectEntry,
    summary,): void {
    const titleEl = ctx.host.transcriptSheet?.querySelector('.theia-mobile-agent-log-header h2');
    const subtitle = ctx.host.transcriptHeaderSubtitle;
    if (!titleEl || !subtitle) {
        return;
    }
    titleEl.textContent = summary
        ? ctx.host.transcriptHeaderUi.resolveTranscriptHeaderTitle(project, summary)
        : project.name;
    subtitle.hidden = true;
    subtitle.className = 'theia-mobile-projects-subtitle';
    subtitle.replaceChildren();
}

