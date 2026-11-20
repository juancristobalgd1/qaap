import type { MobileProjectsExecutionSurfaceTabsUiContext } from './mobile-projects-execution-surface-tabs-ui-context';
// Extracted from mobile-projects-execution-surface-tabs-ui.ts

import type { ExecutionSurfaceTabId as TranscriptTab } from '@theia/qaap-shared-core/lib/common/qaap-execution-surface-tabs';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { writePendingTranscriptFilesViewMode } from '@theia/qaap-transcript/lib/browser/qaap-transcript-files-view';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

/** Rectangle in viewport coordinates that a floating menu may occupy. */
type ExecutionTabOverflowMenuBounds = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

export function positionExecutionTabOverflowMenuExtracted(ctx: MobileProjectsExecutionSurfaceTabsUiContext, menu: HTMLElement, anchor: HTMLElement): void {
    const margin = 8;
    const gap = 6;
    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = Math.max(menu.offsetWidth || menu.scrollWidth, 188);
    const menuHeight = Math.max(menu.offsetHeight || menu.scrollHeight, 1);
    const minTop = ctx.executionTabOverflowMenuMinTop(anchor);
    const bounds = resolveExecutionTabOverflowMenuBoundsExtracted(menu);
    let top = Math.max(anchorRect.bottom + gap, minTop);
    const maxBottom = bounds.bottom - margin;
    if (top + menuHeight > maxBottom) {
        const aboveTop = anchorRect.top - gap - menuHeight;
        if (aboveTop >= bounds.top + margin && aboveTop >= minTop) {
            top = aboveTop;
        } else {
            top = Math.max(minTop, Math.max(bounds.top + margin, maxBottom - menuHeight));
        }
    }
    // Right-align with the trigger, then keep the menu inside what the portal actually shows.
    let left = anchorRect.right - menuWidth;
    left = Math.max(bounds.left + margin, Math.min(left, bounds.right - menuWidth - margin));
    applyExecutionTabOverflowMenuPositionExtracted(menu, top, left);
}

/**
 * The viewport, narrowed to the portal when the portal paints with containment: its content is
 * clipped to its own box, so a menu placed outside that box would be invisible.
 */
function resolveExecutionTabOverflowMenuBoundsExtracted(menu: HTMLElement): ExecutionTabOverflowMenuBounds {
    const viewport: ExecutionTabOverflowMenuBounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const portal = menu.parentElement;
    if (!(portal instanceof HTMLElement) || !hasExecutionTabOverflowPaintContainmentExtracted(portal)) {
        return viewport;
    }
    const rect = portal.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return viewport;
    }
    const visible: ExecutionTabOverflowMenuBounds = {
        left: Math.max(viewport.left, rect.left),
        top: Math.max(viewport.top, rect.top),
        right: Math.min(viewport.right, rect.right),
        bottom: Math.min(viewport.bottom, rect.bottom),
    };
    return visible.right > visible.left && visible.bottom > visible.top ? visible : viewport;
}

function hasExecutionTabOverflowPaintContainmentExtracted(element: HTMLElement): boolean {
    const contain = window.getComputedStyle(element).getPropertyValue('contain') || element.style.getPropertyValue('contain');
    return /\b(paint|strict|content)\b/.test(contain);
}

/**
 * A fixed box is placed against its nearest ancestor with transform, filter or containment, not
 * against the viewport. Measure where the menu actually landed and shift the request by that offset.
 */
function applyExecutionTabOverflowMenuPositionExtracted(menu: HTMLElement, top: number, left: number): void {
    menu.style.position = 'fixed';
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    const actual = menu.getBoundingClientRect();
    if (actual.width <= 0 && actual.height <= 0) {
        // Not laid out (e.g. detached or hidden): there is no containing-block offset to measure.
        return;
    }
    const offsetLeft = actual.left - left;
    const offsetTop = actual.top - top;
    if (Math.abs(offsetLeft) < 0.5 && Math.abs(offsetTop) < 0.5) {
        return;
    }
    menu.style.top = `${top - offsetTop}px`;
    menu.style.left = `${left - offsetLeft}px`;
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
        // 'review' (Changes) mounts the shared files surface in Changes mode.
        writePendingTranscriptFilesViewMode('changes');
        ctx.host.transcriptSurfacesUi.ensureTranscriptFilesTab(project, summary, 'changes');
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

