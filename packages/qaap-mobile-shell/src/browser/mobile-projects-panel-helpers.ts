// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Business-logic helpers extracted from MobileProjectsPanel (second pass).
// These functions accept instance fields as parameters (dependency injection).

import { FileUri } from '@theia/core/lib/common/file-uri';
import { nls } from '@theia/core/lib/common/nls';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import type { QaapAgentConversationDTO } from '../common/qaap-agent-conversation-client';
import { getConversation } from '../common/qaap-agent-conversation-client';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { TranscriptOverlayController } from './mobile-projects-transcript-overlay-controller';
import type { MobileProjectsHeaderOverflowMenuItem } from './mobile-projects-panel';

export function projectOwnsActiveBootstrap(
    project: MobileProjectEntry,
    projectBootstrap: QaapProjectBootstrapService | undefined,
    projectsService: MobileProjectsService,
    preparedCwdByProjectId: Map<string, string>,
): boolean {
    const rootUri = projectBootstrap?.descriptor?.rootUri;
    if (!rootUri) {
        return false;
    }
    const cwd = projectsService.getProjectCwd(project) ?? preparedCwdByProjectId.get(project.id);
    if (!cwd) {
        return false;
    }
    const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    try {
        return normalize(FileUri.fsPath(rootUri.toString())) === normalize(cwd);
    } catch {
        return false;
    }
}

export function isCopyConversationEnabled(
    transcriptController: TranscriptOverlayController,
    transcriptConversationCache: Map<string, QaapAgentConversationDTO>,
): boolean {
    const state = transcriptController.state;
    const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
    if (!summary) {
        return false;
    }
    if (state.transcriptLastConv?.id === summary.id && state.transcriptLastConv.messages.length > 0) {
        return true;
    }
    const cached = transcriptConversationCache.get(summary.id);
    if ((cached?.messages.length ?? 0) > 0) {
        return true;
    }
    return (summary.messageCount ?? 0) > 0;
}

export async function resolveActiveConversationForCopy(
    transcriptController: TranscriptOverlayController,
    transcriptConversationCache: Map<string, QaapAgentConversationDTO>,
    conversations: MobileProjectsConversations | undefined,
): Promise<QaapAgentConversationDTO | undefined> {
    const state = transcriptController.state;
    const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
    if (!summary) {
        return undefined;
    }
    if (state.transcriptLastConv?.id === summary.id) {
        return state.transcriptLastConv;
    }
    const cached = transcriptConversationCache.get(summary.id);
    if (cached) {
        return cached;
    }
    if (summary.source === 'theia-chat') {
        return conversations?.getTheiaConversation(summary.id);
    }
    try {
        return await getConversation(summary.id);
    } catch {
        return undefined;
    }
}

// ─── DI-extracted: renderHeaderOverflowMenuItems ────────────────────────────

export interface RenderHeaderOverflowMenuItemsDeps {
    closeHeaderOverflowMenu(): void;
    openHeaderNewChat(): void;
    isHeaderNewChatVisible(): boolean;
    openWorkHubSessionsSidebar(): void;
    copyActiveConversationToClipboard(): Promise<void>;
    isCopyConversationEnabled(): boolean;
    openAiConfigurationSheet?: () => void;
    openPreferencesSheet?: () => void;
    appendHeaderOverflowSeparator(menu: HTMLElement): void;
    headerOverflowMenuGroups?: () => MobileProjectsHeaderOverflowMenuItem[][];
    isHeaderOverflowMenuItemVisible(item: MobileProjectsHeaderOverflowMenuItem): boolean;
    isHeaderOverflowMenuItemEnabled(item: MobileProjectsHeaderOverflowMenuItem): boolean;
    commands: { executeCommand(command: string): void | Promise<void> | unknown };
}

export function renderHeaderOverflowMenuItems(
    menu: HTMLElement,
    deps: RenderHeaderOverflowMenuItemsDeps,
): void {
    menu.replaceChildren();
    const appendItem = (label: string, icon: string, run: () => void | Promise<void>, enabled = true): void => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'qaap-work-hub-toolbar-menu-item';
        item.setAttribute('role', 'menuitem');
        item.disabled = !enabled;
        const iconEl = document.createElement('span');
        iconEl.className = `codicon ${icon}`;
        iconEl.setAttribute('aria-hidden', 'true');
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        item.append(iconEl, labelEl);
        item.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (item.disabled) {
                return;
            }
            deps.closeHeaderOverflowMenu();
            void Promise.resolve(run()).catch(() => undefined);
        });
        menu.append(item);
    };
    appendItem(
        nls.localize('qaap/workHubToolbar/newChat', 'New Chat'),
        'codicon-add',
        () => deps.openHeaderNewChat(),
        deps.isHeaderNewChatVisible(),
    );
    appendItem(
        nls.localize('qaap/workHubToolbar/showChats', 'Show Chats'),
        'codicon-history',
        () => deps.openWorkHubSessionsSidebar(),
    );
    appendItem(
        nls.localize('qaap/workHubToolbar/copyConversation', 'Copy full conversation'),
        'codicon-copy',
        () => deps.copyActiveConversationToClipboard(),
        deps.isCopyConversationEnabled(),
    );
    if (deps.openAiConfigurationSheet) {
        deps.appendHeaderOverflowSeparator(menu);
        appendItem(
            nls.localize('qaap/workHubToolbar/aiSettings', 'AI Settings'),
            'codicon-settings-gear',
            () => deps.openAiConfigurationSheet?.(),
        );
    }
    if (deps.openPreferencesSheet) {
        appendItem(
            nls.localize('qaap/workHubToolbar/preferences', 'Preferences'),
            'codicon-tools',
            () => deps.openPreferencesSheet?.(),
        );
    }
    for (const group of deps.headerOverflowMenuGroups?.() ?? []) {
        const visibleItems = group.filter(item => deps.isHeaderOverflowMenuItemVisible(item));
        if (!visibleItems.length) {
            continue;
        }
        deps.appendHeaderOverflowSeparator(menu);
        for (const item of visibleItems) {
            appendItem(
                item.label,
                item.icon,
                () => {
                    if (item.run) {
                        return item.run();
                    }
                    if (item.command) {
                        return deps.commands.executeCommand(item.command) as void | Promise<void>;
                    }
                },
                deps.isHeaderOverflowMenuItemEnabled(item),
            );
        }
    }
}
