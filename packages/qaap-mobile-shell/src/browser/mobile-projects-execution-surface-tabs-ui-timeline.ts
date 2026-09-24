import type { MobileProjectsExecutionSurfaceTabsUiContext } from './mobile-projects-execution-surface-tabs-ui-context';
// Extracted from mobile-projects-execution-surface-tabs-ui.ts

import type { ExecutionSurfaceTabId as TranscriptTab } from '@theia/qaap-shared-core/lib/common/qaap-execution-surface-tabs';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { writePendingTranscriptFilesViewMode } from './qaap-transcript-files-view';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

export function positionExecutionTabOverflowMenuExtracted(ctx: MobileProjectsExecutionSurfaceTabsUiContext, menu: HTMLElement, anchor: HTMLElement): void {
    const margin = 8;
    const gap = 6;
    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = Math.max(menu.offsetWidth || menu.scrollWidth, 188);
    const menuHeight = Math.max(menu.offsetHeight || menu.scrollHeight, 1);
    const minTop = ctx.executionTabOverflowMenuMinTop(anchor);
    let top = Math.max(anchorRect.bottom + gap, minTop);
    const maxBottom = window.innerHeight - margin;
    if (top + menuHeight > maxBottom) {
        const aboveTop = anchorRect.top - gap - menuHeight;
        if (aboveTop >= margin && aboveTop >= minTop) {
            top = aboveTop;
        } else {
            top = Math.max(minTop, Math.max(margin, maxBottom - menuHeight));
        }
    }
    let left = anchorRect.right - menuWidth;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
    menu.style.position = 'fixed';
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
}

export function closeExecutionTabOverflowMenuExtracted(ctx: MobileProjectsExecutionSurfaceTabsUiContext): void {
    const menu = ctx.host.executionTabOverflowMenu;
    const anchor = ctx.host.executionTabOverflowAnchor;
    if (!menu) {
        return;
    }
    menu.hidden = true;
    menu.classList.remove('theia-mod-open', 'theia-mod-floating');
    menu.style.position = '';
    menu.style.zIndex = '';
    menu.style.top = '';
    menu.style.left = '';
    const parent = anchor?.closest('.theia-mobile-transcript-tab-icon-select-host');
    if (parent && !parent.contains(menu)) {
        parent.append(menu);
    }
    anchor?.setAttribute('aria-expanded', 'false');
    ctx.host.executionTabOverflowDispose.dispose();
    ctx.host.executionTabOverflowDispose = Disposable.NULL;
    ctx.host.executionTabOverflowMenu = undefined;
    ctx.host.executionTabOverflowAnchor = undefined;
}

export function mountTranscriptSurfaceTabExtracted(ctx: MobileProjectsExecutionSurfaceTabsUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    tab: TranscriptTab,): void {
    if (tab === 'review') {
        // 'review' (Changes) is merged into the 'files' tab — set pending
        // view-mode flag and mount the files tab instead.
        writePendingTranscriptFilesViewMode('changes');
        ctx.host.transcriptSurfacesUi.ensureTranscriptFilesTab(project, summary);
    } else if (tab === 'preview') {
        ctx.host.transcriptSurfacesUi.renderPreviewTab(project, summary);
    } else if (tab === 'files') {
        // Explicit Files selection must restore the file tree even if Changes
        // was the last persisted mode for this workspace.
        ctx.host.transcriptSurfacesUi.ensureTranscriptFilesTab(project, summary, 'files');
    } else if (tab === 'terminal') {
        void ctx.host.transcriptSurfacesUi.ensureTranscriptTerminalTab(project, summary);
    }
    if (ctx.host.transcriptOpenProject) {
        ctx.syncExecutionSurfaceChrome(ctx.host.transcriptOpenProject);
    }
}

