// @ts-nocheck
// Extracted from mobile-projects-execution-surface-tabs-ui.ts

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import {
    type ExecutionSurfaceTabId,
    recordExecutionSurfaceTabUse,
} from '../common/qaap-execution-surface-tabs';
import {
    appendExecutionSurfaceTabIcon,
    createExecutionSurfaceIconElement,
    isExecutionSurfaceIconElement,
    QAAP_MESSAGE_CIRCLE_ICON_CLASS,
    QAAP_SCM_CHANGES_ICON_CLASS,
} from '../common/qaap-scm-changes-icon';
import { applyExecutionSurfaceHeaderChrome, queryExecutionSurfaceViewSelect } from './qaap-execution-surface-header-chrome';
import { appendAgentBrandIcon, createAgentBrandIcon } from '../common/qaap-agent-branding';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import { resolveInteractiveAgentCliBin } from '../common/qaap-agent-tui-command';
import { writePendingTranscriptFilesViewMode } from './qaap-transcript-files-view';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsProjectDetailUi } from './mobile-projects-project-detail-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsTranscriptSurfacesUi } from './mobile-projects-transcript-surfaces-ui';

export function positionExecutionTabOverflowMenuExtracted(ctx: any, menu: HTMLElement, anchor: HTMLElement): void {
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

export function closeExecutionTabOverflowMenuExtracted(ctx: any): void {
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

export function mountTranscriptSurfaceTabExtracted(ctx: any, project: MobileProjectEntry,
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
        ctx.host.transcriptSurfacesUi.ensureTranscriptFilesTab(project, summary);
    } else if (tab === 'terminal') {
        void ctx.host.transcriptSurfacesUi.ensureTranscriptTerminalTab(project, summary);
    }
    if (ctx.host.transcriptOpenProject) {
        ctx.syncExecutionSurfaceChrome(ctx.host.transcriptOpenProject);
    }
}

