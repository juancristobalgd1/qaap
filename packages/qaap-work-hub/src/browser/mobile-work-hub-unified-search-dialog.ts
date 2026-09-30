// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

export interface MobileWorkHubUnifiedSearchChat {
    readonly project: MobileProjectEntry;
    readonly summary: QaapAgentConversationSummaryDTO;
}

type MobileWorkHubUnifiedSearchTab = 'chats' | 'commands';

/** Search chats and executable commands in one Work Hub dialog. */
export class MobileWorkHubUnifiedSearchDialog {

    readonly node: HTMLElement;
    protected readonly searchInput: HTMLInputElement;
    protected readonly chatsTab: HTMLButtonElement;
    protected readonly commandsTab: HTMLButtonElement;
    protected readonly results: HTMLElement;
    protected readonly emptyState: HTMLElement;
    protected activeTab: MobileWorkHubUnifiedSearchTab = 'chats';
    protected resultButtons: HTMLButtonElement[] = [];
    protected readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
        }
    };

    constructor(
        protected readonly commandRegistry: CommandRegistry,
        protected readonly chats: readonly MobileWorkHubUnifiedSearchChat[],
        protected readonly onOpenChat: (chat: MobileWorkHubUnifiedSearchChat) => void,
        protected readonly onRunCommand: (command: Command) => void,
        protected readonly returnFocus: HTMLElement,
    ) {
        this.node = document.createElement('div');
        this.node.className = 'theia-mobile-work-hub-unified-search';
        this.node.setAttribute('role', 'dialog');
        this.node.setAttribute('aria-modal', 'true');
        this.node.setAttribute('aria-label', nls.localize(
            'qaap/sessionsSidebar/unifiedSearch',
            'Search chats and commands',
        ));
        this.node.addEventListener('click', event => {
            if (event.target === this.node) {
                this.close();
            }
        });

        const panel = document.createElement('section');
        panel.className = 'theia-mobile-work-hub-unified-search-panel';

        const header = document.createElement('header');
        header.className = 'theia-mobile-work-hub-unified-search-header';
        const heading = document.createElement('h2');
        heading.textContent = nls.localize('qaap/sessionsSidebar/searchTitle', 'Search');
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'theia-mobile-work-hub-unified-search-close codicon codicon-close';
        closeButton.title = nls.localize('qaap/sessionsSidebar/closeSearch', 'Close search');
        closeButton.setAttribute('aria-label', closeButton.title);
        closeButton.addEventListener('click', () => this.close());
        header.append(heading, closeButton);

        const searchBox = document.createElement('label');
        searchBox.className = 'theia-mobile-work-hub-unified-search-box';
        const searchIcon = document.createElement('span');
        searchIcon.className = 'codicon codicon-search';
        searchIcon.setAttribute('aria-hidden', 'true');
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'search';
        this.searchInput.autocomplete = 'off';
        this.searchInput.placeholder = nls.localize('qaap/sessionsSidebar/searchChats', 'Search chats');
        this.searchInput.setAttribute('aria-label', this.searchInput.placeholder);
        this.searchInput.addEventListener('input', () => this.renderResults());
        this.searchInput.addEventListener('keydown', event => {
            if (event.key === 'Enter' && this.resultButtons.length > 0) {
                event.preventDefault();
                this.resultButtons[0].click();
            } else if (event.key === 'ArrowDown' && this.resultButtons.length > 0) {
                event.preventDefault();
                this.resultButtons[0].focus();
            }
        });
        searchBox.append(searchIcon, this.searchInput);

        const tabs = document.createElement('div');
        tabs.className = 'theia-mobile-work-hub-unified-search-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', nls.localize(
            'qaap/sessionsSidebar/searchType',
            'Search type',
        ));
        this.chatsTab = this.createTab('chats', 'comment-discussion', nls.localize(
            'qaap/sessionsSidebar/chatsTab',
            'Chats',
        ));
        this.commandsTab = this.createTab('commands', 'terminal', nls.localize(
            'qaap/sessionsSidebar/commandsTab',
            'Commands',
        ));
        tabs.append(this.chatsTab, this.commandsTab);

        this.results = document.createElement('div');
        this.results.className = 'theia-mobile-work-hub-unified-search-results';
        this.results.setAttribute('role', 'listbox');
        this.results.setAttribute('aria-label', nls.localize(
            'qaap/sessionsSidebar/searchResults',
            'Search results',
        ));
        this.results.setAttribute('aria-live', 'polite');

        this.emptyState = document.createElement('p');
        this.emptyState.className = 'theia-mobile-work-hub-unified-search-empty';
        panel.append(header, searchBox, tabs, this.results, this.emptyState);
        this.node.append(panel);
    }

    show(): void {
        document.body.append(this.node);
        document.addEventListener('keydown', this.onKeyDown, true);
        this.renderResults();
        this.searchInput.focus();
    }

    dispose(): void {
        this.close(false);
        this.node.remove();
    }

    protected close(restoreFocus = true): void {
        document.removeEventListener('keydown', this.onKeyDown, true);
        this.node.remove();
        if (restoreFocus && this.returnFocus.isConnected) {
            this.returnFocus.focus({ preventScroll: true });
        }
    }

    protected createTab(tab: MobileWorkHubUnifiedSearchTab, icon: string, label: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-unified-search-tab';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(this.activeTab === tab));
        const iconNode = document.createElement('span');
        iconNode.className = `codicon codicon-${icon}`;
        iconNode.setAttribute('aria-hidden', 'true');
        const labelNode = document.createElement('span');
        labelNode.textContent = label;
        button.append(iconNode, labelNode);
        button.addEventListener('click', () => {
            this.activeTab = tab;
            this.chatsTab.setAttribute('aria-selected', String(tab === 'chats'));
            this.commandsTab.setAttribute('aria-selected', String(tab === 'commands'));
            this.searchInput.placeholder = tab === 'chats'
                ? nls.localize('qaap/sessionsSidebar/searchChats', 'Search chats')
                : nls.localize('qaap/sessionsSidebar/searchCommands', 'Search commands');
            this.searchInput.setAttribute('aria-label', this.searchInput.placeholder);
            this.renderResults();
            this.searchInput.focus({ preventScroll: true });
        });
        return button;
    }

    protected renderResults(): void {
        this.results.replaceChildren();
        this.resultButtons = [];
        const query = this.searchInput.value.trim().toLocaleLowerCase();
        if (this.activeTab === 'chats') {
            for (const chat of this.filteredChats(query).slice(0, 30)) {
                const label = chat.summary.title?.trim() || nls.localize(
                    'qaap/mobileProjects/untitledChat',
                    'Untitled chat',
                );
                const detail = `${chat.project.name} · ${chat.summary.agentId}`;
                this.appendResult('comment-discussion', label, detail, () => {
                    this.close(false);
                    this.onOpenChat(chat);
                });
            }
        } else {
            for (const command of this.filteredCommands(query).slice(0, 30)) {
                const category = command.category?.trim();
                const detail = category ? `${category} · ${command.id}` : command.id;
                this.appendResult(command.iconClass || 'terminal', command.label!.trim(), detail, () => {
                    this.close(false);
                    this.onRunCommand(command);
                });
            }
        }
        const hasResults = this.resultButtons.length > 0;
        this.results.hidden = !hasResults;
        this.emptyState.hidden = hasResults;
        if (!hasResults) {
            this.emptyState.textContent = this.activeTab === 'chats'
                ? nls.localize('qaap/sessionsSidebar/noChatsFound', 'No matching chats')
                : nls.localize('qaap/sessionsSidebar/noCommandsFound', 'No matching commands');
        }
    }

    protected filteredChats(query: string): MobileWorkHubUnifiedSearchChat[] {
        if (!query) {
            return [...this.chats].sort((a, b) => b.summary.updatedAt - a.summary.updatedAt);
        }
        return this.chats.filter(({ project, summary }) => [
            summary.title,
            summary.agentId,
            summary.lastMessagePreview,
            project.name,
            project.github?.fullName,
        ].some(value => value?.toLocaleLowerCase().includes(query)));
    }

    protected filteredCommands(query: string): Command[] {
        const commands = this.commandRegistry.commands.filter(command =>
            !!command.label?.trim() && this.commandRegistry.isVisible(command.id));
        const recentIds = new Set(this.commandRegistry.recent.map(command => command.id));
        const recent = commands.filter(command => recentIds.has(command.id));
        const other = commands
            .filter(command => !recentIds.has(command.id))
            .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '')
                || (a.label ?? '').localeCompare(b.label ?? ''));
        const ordered = [...recent, ...other];
        if (!query) {
            return ordered;
        }
        return ordered.filter(command => [command.label, command.category, command.id]
            .some(value => value?.toLocaleLowerCase().includes(query)));
    }

    protected appendResult(iconClass: string, label: string, detail: string, onClick: () => void): void {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-unified-search-result';
        button.setAttribute('role', 'option');
        const icon = document.createElement('span');
        const normalizedIconClass = iconClass.split(/\s+/).filter(value => value && !value.includes('/'));
        icon.className = normalizedIconClass.includes('codicon')
            ? normalizedIconClass.join(' ')
            : `codicon codicon-${normalizedIconClass.at(-1) || 'search'}`;
        icon.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('span');
        copy.className = 'theia-mobile-work-hub-unified-search-result-copy';
        const title = document.createElement('strong');
        title.textContent = label;
        const description = document.createElement('span');
        description.textContent = detail;
        copy.append(title, description);
        button.append(icon, copy);
        button.addEventListener('click', onClick);
        this.resultButtons.push(button);
        this.results.append(button);
    }
}
