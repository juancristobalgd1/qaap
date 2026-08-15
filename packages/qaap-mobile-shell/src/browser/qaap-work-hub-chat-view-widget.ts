// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AIVariableService, FrontendLanguageModelRegistry, PromptService } from '@theia/ai-core';
import { SkillService } from '@theia/ai-core/lib/browser/skill-service';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { AI_SHOW_SETTINGS_COMMAND } from '@theia/ai-core/lib/browser';
import { ChatViewTreeWidget } from '@theia/ai-chat-ui/lib/browser/chat-tree-view/chat-view-tree-widget';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';
import { AI_CHAT_SHOW_CHATS_COMMAND, ChatCommands } from '@theia/ai-chat-ui/lib/browser/chat-view-commands';
import { AIConfigurationSelectionService } from '@theia/ai-ide/lib/browser/ai-configuration/ai-configuration-service';
import { MCPFrontendService } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { ApplicationShell, LabelProvider, PanelLayout } from '@theia/core/lib/browser';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';
import { DecorationsService } from '@theia/core/lib/browser/decorations-service';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { QuickInputService } from '@theia/core';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { Disposable } from '@theia/core/lib/common/disposable';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { Widget as LuminoWidget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import { EditorManager } from '@theia/editor/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileUploadService } from '@theia/filesystem/lib/common/upload/file-upload';
import { MonacoEditorProvider } from '@theia/monaco/lib/browser/monaco-editor-provider';
import { MarkdownPreviewHandler } from '@theia/preview/lib/browser/markdown/markdown-preview-handler';
import { createWorkHubMoreActionsIcon } from '@theia/qaap-adapters/lib/browser/qaap-lucide-icons';
import { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import { ElementInspectorService } from '@theia/qaap-element-inspector/lib/browser/element-inspector-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { ScmService } from '@theia/scm/lib/browser/scm-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { MobileProjectsActiveTasks } from './mobile-projects-active-tasks';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { MobileProjectsConversationFlags } from './mobile-projects-conversation-flags';
import { MobileProjectsHeaderOverflowMenuItem, MobileProjectsPanel } from './mobile-projects-panel';
import { MobileProjectsPanelFactory } from './mobile-projects-panel-factory';
import { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsHubView } from './mobile-projects-types';
import { MobileWorkHubInboxStream } from './mobile-work-hub-inbox-stream';
import { MobileProjectChatViewWidgetFactory } from './mobile-project-ai-chat-input-widget';
import { MobileWorkHubAiConfigurationSheet } from './mobile-work-hub-ai-configuration-sheet';
import { MobileWorkHubPreferencesSheet } from './mobile-work-hub-preferences-sheet';
import { QaapAgUiFrontendToolService } from './qaap-ag-ui-frontend-tool-service';
import { QaapBackgroundContextProvider } from './qaap-background-context-provider';
import { QaapCommitMessageAi } from './qaap-commit-message-ai';
import { QaapComposerEditorContextService } from './qaap-composer-editor-context-service';
import { QaapComposerPromptImprover } from './qaap-composer-prompt-improver';
import { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { QaapWorkHubComposerPromptService } from './qaap-work-hub-composer-prompt-service';
import { QaapWorkHubProjectSkillRoots } from './qaap-work-hub-project-skill-roots';

/**
 * Product replacement for Theia's AI Chat panel body.
 *
 * The widget keeps the upstream ChatViewWidget id so all existing View/toolbar commands still
 * target the same right-panel slot, but the mounted content is the QAAP Work Hub.
 */
@injectable()
export class QaapWorkHubChatViewWidget extends ChatViewWidget {

    @inject(MobileProjectsService)
    protected readonly projectsService: MobileProjectsService;
    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;
    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;
    @inject(ApplicationShell)
    protected readonly applicationShell: ApplicationShell;
    @inject(ScmService)
    protected readonly scmService: ScmService;
    @inject(MobileProjectChatViewWidgetFactory)
    protected readonly mobileProjectChatViewWidgetFactory: MobileProjectChatViewWidgetFactory;
    @inject(ChatAgentService)
    protected readonly chatAgentService: ChatAgentService;
    @inject(AIVariableService)
    protected readonly aiVariableService: AIVariableService;
    @inject(SkillService)
    protected readonly skillService: SkillService;
    @inject(PromptService)
    protected readonly promptService: PromptService;
    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;
    @inject(FileUploadService)
    protected readonly fileUploadService: FileUploadService;
    @inject(FileService)
    protected readonly fileService: FileService;
    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;
    @inject(EditorManager)
    protected readonly editorManager: EditorManager;
    @inject(MonacoEditorProvider)
    protected readonly monacoEditorProvider: MonacoEditorProvider;
    @inject(LabelProvider)
    protected readonly labelProvider: LabelProvider;
    @inject(DecorationsService)
    protected readonly decorationsService: DecorationsService;
    @inject(ColorRegistry)
    protected readonly colorRegistry: ColorRegistry;
    @inject(MarkdownPreviewHandler)
    protected readonly markdownPreviewHandler: MarkdownPreviewHandler;
    @inject(TerminalService)
    protected readonly terminalService: TerminalService;
    @inject(StorageService)
    protected readonly storageService: StorageService;
    @inject(QaapPreviewSurfaceRegistry)
    protected readonly previewSurfaceRegistry: QaapPreviewSurfaceRegistry;
    @inject(ElementInspectorService)
    protected readonly elementInspectorService: ElementInspectorService;
    @inject(ClipboardService)
    protected readonly clipboardService: ClipboardService;
    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;
    @inject(MCPFrontendService) @optional()
    protected readonly mcpFrontendService?: MCPFrontendService;
    @inject(FrontendLanguageModelRegistry) @optional()
    protected readonly workHubLanguageModelRegistry?: FrontendLanguageModelRegistry;
    @inject(QaapCommitMessageAi) @optional()
    protected readonly commitMessageAi?: QaapCommitMessageAi;
    @inject(QaapComposerPromptImprover) @optional()
    protected readonly composerPromptImprover?: QaapComposerPromptImprover;
    @inject(QaapProjectBootstrapService)
    protected readonly projectBootstrap: QaapProjectBootstrapService;
    @inject(QaapWorkHubProjectSkillRoots)
    protected readonly workHubProjectSkillRoots: QaapWorkHubProjectSkillRoots;
    @inject(QaapAgUiFrontendToolService) @optional()
    protected readonly agUiFrontendTools?: QaapAgUiFrontendToolService;
    @inject(QaapComposerEditorContextService)
    protected readonly composerEditorContextService: QaapComposerEditorContextService;
    @inject(QaapWorkHubComposerPromptService)
    protected readonly composerPromptService: QaapWorkHubComposerPromptService;
    @inject(MobileProjectsActiveTasks)
    protected readonly activeTasks: MobileProjectsActiveTasks;
    @inject(MobileProjectsConversations)
    protected readonly conversations: MobileProjectsConversations;
    @inject(QaapBackgroundContextProvider)
    protected readonly backgroundContext: QaapBackgroundContextProvider;
    @inject(MobileWorkHubInboxStream)
    protected readonly inboxStream: MobileWorkHubInboxStream;
    @inject(MobileProjectsConversationFlags)
    protected readonly conversationFlags: MobileProjectsConversationFlags;
    @inject(AIConfigurationSelectionService)
    protected readonly aiConfigurationSelectionService: AIConfigurationSelectionService;

    protected workHubPanel: MobileProjectsPanel | undefined;
    protected preferencesSheet: MobileWorkHubPreferencesSheet | undefined;
    protected aiConfigurationSheet: MobileWorkHubAiConfigurationSheet | undefined;
    protected toolbarMenuButton: HTMLButtonElement | undefined;
    protected toolbarMenu: HTMLElement | undefined;
    protected toolbarMenuDismiss: Disposable = Disposable.NULL;

    constructor(
        @inject(ChatViewTreeWidget)
        treeWidget: ChatViewTreeWidget,
        @inject(AIChatInputWidget)
        inputWidget: AIChatInputWidget,
    ) {
        super(treeWidget, inputWidget);
        this.node.classList.add('qaap-work-hub-chat-view-widget');
        this.node.tabIndex = -1;
    }

    @postConstruct()
    protected override init(): void {
        this.toDispose.pushAll([this.treeWidget, this.inputWidget]);
        this.chatSession = this.chatService.createSession();
        // Handlers before model assignment: async Monaco / React updates must not
        // hit undefined onQuery/onUnpin while the shell input is still wiring up.
        this.inputWidget.onQuery = async () => { /* Work Hub uses its sticky composer. */ };
        this.inputWidget.onUnpin = () => undefined;
        this.inputWidget.onCancel = () => undefined;
        this.inputWidget.onDeleteChangeSet = () => undefined;
        this.inputWidget.onDeleteChangeSetElement = () => undefined;
        // The Work Hub replaces the upstream chat body, but the inherited
        // ChatViewWidget still owns an AIChatInputWidget (WorkHubShellAIChatInputWidget).
        // Bind a real model so restore cannot blank the shell on undefined chatModel.
        this.inputWidget.chatModel = this.chatSession.model;
        this.inputWidget.pinnedAgent = this.chatSession.pinnedAgent;

        const layout = this.layout = new PanelLayout();
        const host = new LuminoWidget();
        host.node.className = 'qaap-work-hub-chat-view-host';
        layout.addWidget(host);
        this.toDispose.push(Disposable.create(() => host.dispose()));

        const factory = new MobileProjectsPanelFactory({
            deps: {
                projectsService: this.projectsService,
                commands: this.commands,
                widgetManager: this.widgetManager,
                applicationShell: this.applicationShell,
                scmService: this.scmService,
                mobileProjectChatViewWidgetFactory: this.mobileProjectChatViewWidgetFactory,
                chatService: this.chatService,
                chatAgentService: this.chatAgentService,
                messageService: this.messageService,
                variableService: this.aiVariableService,
                skillService: this.skillService,
                promptService: this.promptService,
                quickInputService: this.quickInputService,
                fileUploadService: this.fileUploadService,
                fileService: this.fileService,
                workspaceService: this.workspaceService,
                editorManager: this.editorManager,
                monacoEditorProvider: this.monacoEditorProvider,
                labelProvider: this.labelProvider,
                markdownPreviewHandler: this.markdownPreviewHandler,
                decorationsService: this.decorationsService,
                colorRegistry: this.colorRegistry,
                terminalService: this.terminalService,
                storageService: this.storageService,
                previewSurfaceRegistry: this.previewSurfaceRegistry,
                elementInspectorService: this.elementInspectorService,
                clipboardService: this.clipboardService,
                preferenceService: this.preferences,
                mcpFrontendService: this.mcpFrontendService,
                languageModelRegistry: this.workHubLanguageModelRegistry ?? this.languageModelRegistry,
                commitMessageAi: this.commitMessageAi,
                composerPromptImprover: this.composerPromptImprover,
                composerEditorContextService: this.composerEditorContextService,
                workHubProjectSkillRoots: this.workHubProjectSkillRoots,
                projectBootstrap: this.projectBootstrap,
                agUiFrontendTools: this.agUiFrontendTools,
                activeTasks: this.activeTasks,
                conversations: this.conversations,
                backgroundContext: this.backgroundContext,
                inboxStream: this.inboxStream,
                conversationFlags: this.conversationFlags,
            },
            delegate: {
                onProjectOpen: project => { void this.projectsService.openInCurrentWindowAsync(project); },
                onProjectOpenInIde: project => { void this.projectsService.openInCurrentWindowAsync(project); },
                onDismiss: () => this.close(),
                onWorkspaceOpened: () => undefined,
                onProjectsChanged: () => undefined,
                onCurrentProjectActivated: () => undefined,
                onResumePreview: project => { void this.commands.executeCommand('qaap.hub.resumePreview', project); },
                onOpenAgentOnTask: project => { void this.commands.executeCommand('qaap.mobile.openAgentOnTask', project); },
                onOpenPullRequest: () => undefined,
                onShowAgentsHub: () => this.navigateWorkHub('tasks'),
                onHubLandingViewChanged: () => undefined,
                onEnterActiveTranscript: () => undefined,
                onEnterWorkHubConversation: () => undefined,
                onExitActiveTranscript: () => undefined,
                openWorkHubPreferencesSheet: query => this.openWorkHubPreferencesSheet(query),
                openWorkHubAiConfigurationSheet: tabId => this.openWorkHubAiConfigurationSheet(tabId),
            },
            panelOptions: {
                headerOverflowMenuGroups: () => this.createIdeHeaderOverflowMenuGroups(),
                sessionsSidebarContainer: () => this.workHubPanel?.node,
            },
        });

        this.workHubPanel = factory.create(true);
        this.workHubPanel.node.classList.add('qaap-work-hub-chat-view-panel');
        host.node.appendChild(this.workHubPanel.node);
        this.resetWorkHubHostScroll(host.node);
        this.toDispose.push(this.composerPromptService.trackPanel(this.workHubPanel));
        this.toDispose.push(Disposable.create(() => {
            this.workHubPanel?.dispose();
            this.workHubPanel?.node.parentElement?.removeChild(this.workHubPanel.node);
            this.workHubPanel = undefined;
        }));

        void this.workHubPanel.show({ preferredHubView: 'tasks' });
        window.requestAnimationFrame(() => this.resetWorkHubHostScroll(host.node));
        this.installToolbarOverflowMenu();
        window.requestAnimationFrame(() => this.installToolbarOverflowMenu());
        this.toDispose.push(this.progressBarFactory({ container: this.node, insertMode: 'prepend', locationId: 'ai-chat' }));
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.focusWorkHubChatView();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // The panel creates its execution shell in @postConstruct init(), before the widget is
        // attached to the DOM. At that point chatHost?.isConnected is false, so renderStickyComposer()
        // hides the composer. Re-render after attach to show it now that elements are live.
        this.workHubPanel?.refreshStickyComposerAfterAttach();
    }

    protected focusWorkHubChatView(): void {
        const host = this.node.querySelector<HTMLElement>('.qaap-work-hub-chat-view-host');
        if (host) {
            this.resetWorkHubHostScroll(host);
        }
        const target = this.workHubPanel?.node.querySelector<HTMLElement>(
            'textarea, input, [contenteditable="true"], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? this.node;
        target.focus({ preventScroll: true });
        window.requestAnimationFrame(() => {
            if (!this.node.contains(document.activeElement)) {
                this.node.focus({ preventScroll: true });
            }
        });
    }

    protected resetWorkHubHostScroll(host: HTMLElement): void {
        host.scrollLeft = 0;
        host.scrollTop = 0;
    }

    protected navigateWorkHub(view: MobileProjectsHubView): void {
        this.workHubPanel?.navigateHubTab(view);
    }

    protected async openWorkHubPreferencesSheet(query?: string): Promise<void> {
        if (!this.preferencesSheet) {
            this.preferencesSheet = new MobileWorkHubPreferencesSheet(this.widgetManager, this.preferences);
            document.body.appendChild(this.preferencesSheet.node);
            this.toDispose.push(Disposable.create(() => {
                this.preferencesSheet?.dispose();
                this.preferencesSheet?.node.parentElement?.removeChild(this.preferencesSheet.node);
                this.preferencesSheet = undefined;
            }));
        }
        await this.preferencesSheet.show(query);
    }

    protected async openWorkHubAiConfigurationSheet(tabId?: string): Promise<void> {
        if (!this.aiConfigurationSheet) {
            this.aiConfigurationSheet = new MobileWorkHubAiConfigurationSheet(this.widgetManager, this.aiConfigurationSelectionService);
            document.body.appendChild(this.aiConfigurationSheet.node);
            this.toDispose.push(Disposable.create(() => {
                this.aiConfigurationSheet?.dispose();
                this.aiConfigurationSheet?.node.parentElement?.removeChild(this.aiConfigurationSheet.node);
                this.aiConfigurationSheet = undefined;
            }));
        }
        await this.aiConfigurationSheet.show(tabId);
    }

    protected createIdeHeaderOverflowMenuGroups(): MobileProjectsHeaderOverflowMenuItem[][] {
        return [
            [
                this.createIdeCommandMenuItem('Navigate Back', 'codicon-arrow-left', ChatCommands.AI_CHAT_NAVIGATE_BACK.id),
                this.createIdeCommandMenuItem('Navigate Forward', 'codicon-arrow-right', ChatCommands.AI_CHAT_NAVIGATE_FORWARD.id),
            ],
            [
                this.createIdeCommandMenuItem('Session Settings', 'codicon-bracket', ChatCommands.EDIT_SESSION_SETTINGS.id),
            ],
            [
                this.createIdeCommandMenuItem('Summarize Current Session', 'codicon-go-to-editing-session', ChatCommands.AI_CHAT_SUMMARIZE_CURRENT_SESSION.id),
                this.createIdeCommandMenuItem('Open Current Summary', 'codicon-note', ChatCommands.AI_CHAT_OPEN_SUMMARY_FOR_CURRENT_SESSION.id),
                this.createIdeCommandMenuItem(
                    this.isLocked ? 'Turn Auto Scrolling On' : 'Turn Auto Scrolling Off',
                    this.isLocked ? 'codicon-lock' : 'codicon-unlock',
                    this.isLocked ? ChatCommands.SCROLL_UNLOCK_WIDGET.id : ChatCommands.SCROLL_LOCK_WIDGET.id,
                ),
            ],
        ];
    }

    protected createIdeCommandMenuItem(label: string, icon: string, command: string): MobileProjectsHeaderOverflowMenuItem {
        return {
            label,
            icon,
            command,
            isVisible: () => this.commands.isVisible(command, this),
            isEnabled: () => this.commands.isEnabled(command, this),
            run: () => this.commands.executeCommand(command, this),
        };
    }

    protected installToolbarOverflowMenu(): void {
        if (this.toolbarMenuButton || !this.workHubPanel?.node.isConnected) {
            return;
        }
        if (this.workHubPanel.node.querySelector('.qaap-work-hub-toolbar-menu-button')) {
            return;
        }
        const cluster = this.workHubPanel.node.querySelector<HTMLElement>('.theia-mobile-projects-header-execution-cluster');
        const tabHost = this.workHubPanel.node.querySelector<HTMLElement>('.theia-mobile-projects-header-execution-tabs');
        if (!cluster) {
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-workbench-nav-btn qaap-work-hub-toolbar-menu-button';
        button.title = 'More actions';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.append(createWorkHubMoreActionsIcon());
        button.addEventListener('click', this.onToolbarMenuButtonClick);
        if (tabHost && tabHost.parentElement === cluster) {
            cluster.insertBefore(button, tabHost);
        } else {
            cluster.append(button);
        }
        this.workHubPanel.node.querySelector<HTMLElement>('.theia-mobile-projects-new-chat-btn')?.remove();

        const menu = document.createElement('div');
        menu.className = 'qaap-work-hub-toolbar-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', button.title);
        this.workHubPanel.node.append(menu);

        this.toolbarMenuButton = button;
        this.toolbarMenu = menu;
        this.toDispose.push(Disposable.create(() => {
            this.closeToolbarMenu();
            button.removeEventListener('click', this.onToolbarMenuButtonClick);
            button.remove();
            menu.remove();
            this.toolbarMenuButton = undefined;
            this.toolbarMenu = undefined;
        }));
    }

    protected readonly onToolbarMenuButtonClick = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        if (this.toolbarMenu?.classList.contains('theia-mod-open')) {
            this.closeToolbarMenu();
            return;
        }
        this.openToolbarMenu();
    };

    protected openToolbarMenu(): void {
        const button = this.toolbarMenuButton;
        const menu = this.toolbarMenu;
        if (!button || !menu) {
            return;
        }
        this.renderToolbarMenuItems(menu);
        if (!menu.childElementCount) {
            return;
        }
        button.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
        menu.classList.add('theia-mod-open');
        this.positionToolbarMenu();

        const onDismiss = (event: Event): void => {
            const target = event.target;
            if (target instanceof Node && (menu.contains(target) || button.contains(target))) {
                return;
            }
            this.closeToolbarMenu();
        };
        const onReposition = (): void => this.positionToolbarMenu();
        window.setTimeout(() => window.addEventListener('pointerdown', onDismiss, true), 0);
        window.addEventListener('resize', onReposition);
        this.toolbarMenuDismiss.dispose();
        this.toolbarMenuDismiss = Disposable.create(() => {
            window.removeEventListener('pointerdown', onDismiss, true);
            window.removeEventListener('resize', onReposition);
        });
    }

    protected closeToolbarMenu(): void {
        this.toolbarMenuButton?.setAttribute('aria-expanded', 'false');
        if (this.toolbarMenu) {
            this.toolbarMenu.hidden = true;
            this.toolbarMenu.classList.remove('theia-mod-open');
            this.toolbarMenu.style.top = '';
            this.toolbarMenu.style.left = '';
        }
        this.toolbarMenuDismiss.dispose();
        this.toolbarMenuDismiss = Disposable.NULL;
    }

    protected positionToolbarMenu(): void {
        const button = this.toolbarMenuButton;
        const menu = this.toolbarMenu;
        if (!button || !menu || menu.hidden) {
            return;
        }
        const margin = 8;
        const gap = 6;
        const anchor = button.getBoundingClientRect();
        const menuWidth = Math.max(menu.offsetWidth || menu.scrollWidth, 220);
        let left = anchor.right - menuWidth;
        left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
        menu.style.top = `${Math.round(anchor.bottom + gap)}px`;
        menu.style.left = `${Math.round(left)}px`;
    }

    protected renderToolbarMenuItems(menu: HTMLElement): void {
        menu.replaceChildren();
        const groups: QaapWorkHubToolbarMenuItem[][] = [
            [
                { label: 'Navigate Back', icon: 'codicon-arrow-left', command: ChatCommands.AI_CHAT_NAVIGATE_BACK.id },
                { label: 'Navigate Forward', icon: 'codicon-arrow-right', command: ChatCommands.AI_CHAT_NAVIGATE_FORWARD.id },
            ],
            [
                {
                    label: 'New Chat',
                    icon: 'codicon-add',
                    isVisible: () => this.isHeaderNewChatVisible(),
                    isEnabled: () => this.isHeaderNewChatVisible(),
                    run: () => this.workHubPanel?.openHeaderNewChat(),
                },
                { label: 'Show Chats', icon: 'codicon-history', command: AI_CHAT_SHOW_CHATS_COMMAND.id },
            ],
            [
                { label: 'AI Settings', icon: 'codicon-settings-gear', command: AI_SHOW_SETTINGS_COMMAND.id },
                { label: 'Session Settings', icon: 'codicon-bracket', command: ChatCommands.EDIT_SESSION_SETTINGS.id },
            ],
            [
                { label: 'Summarize Current Session', icon: 'codicon-go-to-editing-session', command: ChatCommands.AI_CHAT_SUMMARIZE_CURRENT_SESSION.id },
                { label: 'Open Current Summary', icon: 'codicon-note', command: ChatCommands.AI_CHAT_OPEN_SUMMARY_FOR_CURRENT_SESSION.id },
                {
                    label: this.isLocked ? 'Turn Auto Scrolling On' : 'Turn Auto Scrolling Off',
                    icon: this.isLocked ? 'codicon-lock' : 'codicon-unlock',
                    command: this.isLocked ? ChatCommands.SCROLL_UNLOCK_WIDGET.id : ChatCommands.SCROLL_LOCK_WIDGET.id,
                },
            ],
        ];

        for (const group of groups) {
            const visible = group.filter(item => this.isToolbarMenuItemVisible(item));
            if (!visible.length) {
                continue;
            }
            if (menu.childElementCount) {
                const separator = document.createElement('div');
                separator.className = 'qaap-work-hub-toolbar-menu-separator';
                separator.setAttribute('role', 'separator');
                menu.append(separator);
            }
            for (const item of visible) {
                menu.append(this.createToolbarMenuItem(item));
            }
        }
    }

    protected createToolbarMenuItem(item: QaapWorkHubToolbarMenuItem): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'qaap-work-hub-toolbar-menu-item';
        button.setAttribute('role', 'menuitem');
        button.disabled = !this.isToolbarMenuItemEnabled(item);
        const icon = document.createElement('span');
        icon.className = `codicon ${item.icon}`;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = item.label;
        button.append(icon, label);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled) {
                return;
            }
            this.closeToolbarMenu();
            if (item.run) {
                void Promise.resolve(item.run()).catch(() => undefined);
            } else if (item.command) {
                void this.commands.executeCommand(item.command, this).catch(() => undefined);
            }
        });
        return button;
    }

    protected isHeaderNewChatVisible(): boolean {
        return this.workHubPanel?.isHeaderNewChatVisible() ?? false;
    }

    protected isToolbarMenuItemVisible(item: QaapWorkHubToolbarMenuItem): boolean {
        if (item.isVisible) {
            return item.isVisible();
        }
        return item.command ? this.commands.isVisible(item.command, this) : true;
    }

    protected isToolbarMenuItemEnabled(item: QaapWorkHubToolbarMenuItem): boolean {
        if (item.isEnabled) {
            return item.isEnabled();
        }
        return item.command ? this.commands.isEnabled(item.command, this) : true;
    }
}

interface QaapWorkHubToolbarMenuItem {
    label: string;
    icon: string;
    command?: string;
    isVisible?: () => boolean;
    isEnabled?: () => boolean;
    run?: () => void | Promise<void>;
}
