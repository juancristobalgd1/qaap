// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CommandRegistry, Disposable, DisposableCollection, nls } from '@theia/core/lib/common';
import { ApplicationShell, CommonCommands, Widget } from '@theia/core/lib/browser';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { Message } from '@theia/core/lib/browser/widgets/widget';
import { BrowserMainMenuFactory } from '@theia/core/lib/browser/menu/browser-menu-plugin';
import { CompoundMenuNode, MAIN_MENU_BAR } from '@theia/core/lib/common/menu/menu-types';
import { MenuModelRegistry } from '@theia/core/lib/common/menu/menu-model-registry';
import { collapseLeftPanelIfMobileOneColumn, matchesMobileOneColumnLayout, MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { Menu as LuminoMenu } from '@lumino/widgets';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { QaapMiniBrowserOpenHandler } from '@theia/qaap-adapters/lib/browser/qaap-mini-browser-open-handler';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { renderQaapAccountAvatarVisual } from './qaap-account-avatar-visual';
import {
    buildQaapAccountMenuEntries,
    createQaapViewModeSwitch,
    dismissQaapAccountMenu,
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
    qaapAccountMenuAppearanceFromService,
    toggleQaapAccountMenu,
    type MobileViewToggleId,
    type QaapAccountMenuEntry,
} from './qaap-workbench-account-menu';
import type { QaapAppearanceModeService } from './qaap-appearance-mode-service';
import type { QaapSegmentedFieldController } from './qaap-mobile-form-ui';
import { QaapMobileProjectsDashboardCommands } from './mobile-projects-dashboard-commands';
import {
    peekPreferDesktopIde,
    QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS,
} from '../common/qaap-mobile-work-surface-preference';
import { MobileProjectsService } from './mobile-projects-service';
import { EXPLORER_VIEW_CONTAINER_ID, type MobileBottomButton, type MobileBottomButtonId } from './mobile-shell-bottom-bar-widget';
import { QaapProjectSwitcherService } from './qaap-project-switcher-service';
import { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';

const WORKBENCH_NAV_GO_BACK = 'textEditor.commands.go.back';
const WORKBENCH_NAV_GO_FORWARD = 'textEditor.commands.go.forward';
const WORKBENCH_TOGGLE_TERMINAL = 'workbench.action.terminal.toggleTerminal';
const WORKBENCH_AI_CHAT_TOGGLE = 'aiChat:toggle';
const WORKBENCH_CHAT_VIEW_WIDGET_ID = 'chat-view-widget';
const QAAP_MOBILE_IDE_HEADER_VIEW_OPTIONS = 'qaap.mobile.ideHeaderView.options';
const QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVE = 'qaap.mobile.ideHeaderView.active';
const QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE = 'qaap.mobile.ideHeaderView.activate';
const QAAP_IDE_AVATAR_VIEW_COMMAND_PREFIX = 'qaap.ide.avatarView.';

/** The legacy mobile view picker belongs to Work Hub's one-column surface, never to the classic IDE. */
export function shouldShowMobileIdeHeaderViews(): boolean {
    return matchesMobileOneColumnLayout()
        && !document.body.classList.contains(QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS)
        && !peekPreferDesktopIde();
}

function createWorkbenchNavBtn(iconClasses: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `theia-workbench-nav-btn ${iconClasses}`;
    btn.title = title;
    // Icon-only controls need an explicit accessible name; `title` alone is not reliably
    // exposed to assistive tech across browsers.
    btn.setAttribute('aria-label', title);
    return btn;
}

function createWorkbenchHistoryNavBtn(iconClasses: string, title: string): HTMLButtonElement {
    const btn = createWorkbenchNavBtn(iconClasses, title);
    btn.classList.add('theia-workbench-history-nav-btn');
    return btn;
}

export class QaapWorkbenchNavControlsWidget extends Widget {
    protected readonly toDispose = new DisposableCollection();
    protected readonly leftPanelToggleBtn: HTMLButtonElement;

    constructor(
        protected readonly projectsService: MobileProjectsService,
        protected readonly workspaceService: WorkspaceService,
        protected readonly projectSwitcher: QaapProjectSwitcherService,
        protected readonly shell: ApplicationShell,
    ) {
        const node = document.createElement('motion.div');
        node.classList.add('theia-workbench-nav-controls');
        super({ node });
        this.id = 'theia:workbench-nav';
        this.leftPanelToggleBtn = createWorkbenchNavBtn(
            'codicon codicon-layout-sidebar-left',
            nls.localize('theia/core/workbenchBar/toggleLeftPanel', 'Toggle Side Panel')
        );
        this.leftPanelToggleBtn.classList.add('theia-workbench-left-panel-toggle');
        this.leftPanelToggleBtn.setAttribute('role', 'switch');
        this.leftPanelToggleBtn.setAttribute('aria-checked', 'false');
        this.leftPanelToggleBtn.addEventListener('click', this.onLeftPanelToggleClick);
        node.append(this.leftPanelToggleBtn);
    }

    protected readonly onLeftPanelToggleClick = (): void => {
        if (this.shell.isExpanded('left')) {
            this.shell.collapsePanel('left');
        } else {
            this.shell.expandPanel('left');
        }
        this.updateLeftPanelToggleVisual();
    };

    protected updateLeftPanelToggleVisual(): void {
        const on = this.shell.isExpanded('left');
        this.leftPanelToggleBtn.classList.toggle('theia-mod-toggled', on);
        this.leftPanelToggleBtn.setAttribute('aria-checked', on ? 'true' : 'false');
        // Swap icon: sidebar-left when closed (can open), sidebar-left-off when open (can close).
        this.leftPanelToggleBtn.classList.remove('codicon-layout-sidebar-left', 'codicon-layout-sidebar-left-off');
        this.leftPanelToggleBtn.classList.add(on ? 'codicon-layout-sidebar-left-off' : 'codicon-layout-sidebar-left');
        this.leftPanelToggleBtn.title = on
            ? nls.localize('theia/core/workbenchBar/hideSidePanel', 'Hide Side Panel')
            : nls.localize('theia/core/workbenchBar/showSidePanel', 'Show Side Panel');
        this.leftPanelToggleBtn.setAttribute('aria-label', this.leftPanelToggleBtn.title);
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.updateLeftPanelToggleVisual();
    }

    override dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.toDispose.dispose();
        this.leftPanelToggleBtn.removeEventListener('click', this.onLeftPanelToggleClick);
        super.dispose();
    }
}

/** Editor back / forward; separate top-panel child so mobile CSS can center it in the bar. */
export class QaapWorkbenchHistoryNavWidget extends Widget {
    protected readonly toDispose = new DisposableCollection();
    protected readonly backBtn: HTMLButtonElement;
    protected readonly forwardBtn: HTMLButtonElement;

    constructor(
        protected readonly commands: CommandRegistry,
        protected readonly workspaceService: WorkspaceService,
    ) {
        const node = document.createElement('motion.div');
        node.classList.add('theia-workbench-history-nav-group');
        super({ node });
        this.id = 'theia:workbench-history-nav';
        this.backBtn = createWorkbenchHistoryNavBtn(
            'codicon codicon-chevron-left',
            nls.localizeByDefault('Go Back')
        );
        this.forwardBtn = createWorkbenchHistoryNavBtn(
            'codicon codicon-chevron-right',
            nls.localizeByDefault('Go Forward')
        );
        node.append(this.backBtn, this.forwardBtn);
        this.backBtn.addEventListener('click', this.onBackClick);
        this.forwardBtn.addEventListener('click', this.onForwardClick);
        const refresh = (): void => this.updateEnabledStates();
        this.toDispose.push(this.commands.onDidExecuteCommand(refresh));
        this.toDispose.push(this.commands.onCommandsChanged(refresh));
        this.toDispose.push(this.workspaceService.onWorkspaceChanged(refresh));
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(refresh));
    }

    protected readonly onBackClick = (): void => this.runIfEnabled(WORKBENCH_NAV_GO_BACK);
    protected readonly onForwardClick = (): void => this.runIfEnabled(WORKBENCH_NAV_GO_FORWARD);

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.updateEnabledStates();
    }

    override dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.toDispose.dispose();
        this.backBtn.removeEventListener('click', this.onBackClick);
        this.forwardBtn.removeEventListener('click', this.onForwardClick);
        super.dispose();
    }

    protected runIfEnabled(commandId: string): void {
        if (!this.commands.isEnabled(commandId)) {
            return;
        }
        void this.commands.executeCommand(commandId).catch(() => undefined);
    }

    /** Refresh toggled state after the projects overlay opens or closes outside this widget. */
    refreshChrome(): void {
        this.updateEnabledStates();
    }

    protected updateEnabledStates(): void {
        this.backBtn.disabled = !this.commands.isEnabled(WORKBENCH_NAV_GO_BACK);
        this.forwardBtn.disabled = !this.commands.isEnabled(WORKBENCH_NAV_GO_FORWARD);
    }
}

/** Compact replacement for the horizontal IDE menubar. */
export class QaapWorkbenchMenuButtonWidget extends Widget {
    protected readonly toDispose = new DisposableCollection();
    protected readonly menuBtn: HTMLButtonElement;
    protected activeMenu: LuminoMenu | undefined;

    constructor(
        protected readonly commands: CommandRegistry,
        protected readonly menuFactory: BrowserMainMenuFactory,
        protected readonly menuProvider: MenuModelRegistry,
        protected readonly contextKeyService: ContextKeyService,
    ) {
        const node = document.createElement('motion.div');
        node.classList.add('theia-workbench-menu-button');
        super({ node });
        this.id = 'theia:workbench-menu-button';
        this.menuBtn = createWorkbenchNavBtn(
            'codicon codicon-menu',
            nls.localize('qaap/workbench/menuButton', 'Open menu')
        );
        this.menuBtn.classList.add('theia-workbench-menu-toggle');
        this.menuBtn.setAttribute('aria-haspopup', 'menu');
        this.menuBtn.setAttribute('aria-expanded', 'false');
        node.append(this.menuBtn);
        this.menuBtn.addEventListener('click', this.onMenuClick);
        const refresh = (): void => this.syncVisibility();
        this.toDispose.push(this.commands.onDidExecuteCommand(refresh));
        this.toDispose.push(this.commands.onCommandsChanged(refresh));
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            const mq = window.matchMedia(MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY);
            const onMqChange = (): void => refresh();
            mq.addEventListener('change', onMqChange);
            this.toDispose.push(Disposable.create(() => mq.removeEventListener('change', onMqChange)));
        }
        this.syncVisibility();
    }

    protected readonly onMenuClick = (): void => {
        if (this.activeMenu) {
            this.activeMenu.close();
            return;
        }
        const menuModel = this.menuProvider.getMenuNode(MAIN_MENU_BAR);
        if (!CompoundMenuNode.is(menuModel)) {
            return;
        }
        const menu = this.menuFactory.createContextMenu(
            MAIN_MENU_BAR,
            menuModel,
            this.contextKeyService,
            undefined,
            this.menuBtn,
        );
        this.activeMenu = menu;
        menu.aboutToClose.connect(() => {
            if (this.activeMenu === menu) {
                this.activeMenu = undefined;
                this.menuBtn.setAttribute('aria-expanded', 'false');
            }
        });
        const rect = this.menuBtn.getBoundingClientRect();
        this.menuBtn.setAttribute('aria-expanded', 'true');
        menu.open(rect.left, rect.bottom, { host: document.body });
    };

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.syncVisibility();
    }

    override dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.toDispose.dispose();
        this.activeMenu?.close();
        this.activeMenu = undefined;
        this.menuBtn.removeEventListener('click', this.onMenuClick);
        super.dispose();
    }

    protected syncVisibility(): void {
        const visible = document.body.classList.contains(QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS)
            || peekPreferDesktopIde();
        this.node.hidden = !visible;
        this.node.style.display = visible ? '' : 'none';
        this.menuBtn.setAttribute('aria-hidden', visible ? 'false' : 'true');
        if (!visible) {
            this.activeMenu?.close();
        }
    }
}

/** Centered IDE/Agents switch for the classic IDE top bar. */
export class QaapWorkbenchViewModeCenterWidget extends Widget {
    protected readonly toDispose = new DisposableCollection();
    protected readonly viewModeSwitchHost: HTMLElement;
    protected readonly viewModeSwitch: QaapSegmentedFieldController<MobileViewToggleId>;

    constructor(
        protected readonly commands: CommandRegistry,
        protected readonly workspaceService: WorkspaceService,
    ) {
        const node = document.createElement('motion.div');
        node.classList.add('theia-workbench-view-mode-center');
        super({ node });
        this.id = 'theia:workbench-view-mode-center';
        this.viewModeSwitchHost = document.createElement('span');
        this.viewModeSwitchHost.className = 'theia-workbench-view-mode-switch';
        this.viewModeSwitchHost.hidden = true;
        this.viewModeSwitchHost.setAttribute('aria-hidden', 'true');
        this.viewModeSwitch = createQaapViewModeSwitch({
            activeId: 'editor',
            onSelect: this.onViewModeSwitchSelect,
        });
        this.viewModeSwitchHost.append(this.viewModeSwitch.root);
        node.append(this.viewModeSwitchHost);
        const refresh = (): void => this.syncViewModeSwitch();
        this.toDispose.push(this.commands.onDidExecuteCommand(refresh));
        this.toDispose.push(this.commands.onCommandsChanged(refresh));
        this.toDispose.push(this.workspaceService.onWorkspaceChanged(refresh));
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(refresh));
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            const mq = window.matchMedia(MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY);
            const onMqChange = (): void => refresh();
            mq.addEventListener('change', onMqChange);
            this.toDispose.push(Disposable.create(() => mq.removeEventListener('change', onMqChange)));
        }
        this.syncViewModeSwitch();
    }

    protected readonly onViewModeSwitchSelect = (id: MobileViewToggleId): void => {
        if (id === 'editor') {
            if (this.commands.getCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)
                && this.commands.isEnabled(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)) {
                void this.commands.executeCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)
                    .catch(error => console.warn('[qaap-mobile-shell] failed to open the desktop IDE', error));
                return;
            }
        } else if (this.commands.getCommand(QaapMobileProjectsDashboardCommands.TOGGLE.id)
            && this.commands.isEnabled(QaapMobileProjectsDashboardCommands.TOGGLE.id)) {
            void this.commands.executeCommand(QaapMobileProjectsDashboardCommands.TOGGLE.id)
                .catch(error => console.warn('[qaap-mobile-shell] failed to return to Agents', error));
            return;
        }
        if (this.commands.getCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)
            && this.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)) {
            void this.commands.executeCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, id)
                .catch(error => console.warn('[qaap-mobile-shell] failed to activate the IDE header view', error));
        }
    };

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.syncViewModeSwitch();
    }

    override dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.toDispose.dispose();
        super.dispose();
    }

    protected syncViewModeSwitch(): void {
        const visible = document.body.classList.contains(QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS)
            || peekPreferDesktopIde();
        this.node.hidden = !visible;
        this.node.style.display = visible ? '' : 'none';
        this.viewModeSwitchHost.hidden = !visible;
        this.viewModeSwitchHost.style.display = visible ? '' : 'none';
        this.viewModeSwitchHost.setAttribute('aria-hidden', visible ? 'false' : 'true');
        if (visible) {
            this.viewModeSwitch.setValue('editor');
        }
    }
}

export class QaapWorkbenchRightControlsWidget extends Widget {
    protected readonly toDispose = new DisposableCollection();
    protected readonly terminalBtn: HTMLButtonElement;
    protected readonly aiChatBtn: HTMLButtonElement;
    protected readonly mobileChatTabBtn: HTMLButtonElement;
    protected readonly mobileViewPickerBtn: HTMLButtonElement;
    protected readonly mobileViewPickerSlot: HTMLElement;
    protected readonly accountBtn: HTMLButtonElement;
    protected readonly accountAvatar: HTMLSpanElement;
    protected mobileViewPickerMenu: HTMLElement | undefined;
    protected mobileViewPickerDismiss = Disposable.NULL;
    protected mobileViewPickerOptions: MobileBottomButton[] = [];
    protected mobileViewPickerActiveId: MobileBottomButtonId = 'editor';
    protected mobileViewPickerUpdating = false;
    protected mobileViewPickerUpdatePromise: Promise<void> | undefined;
    protected mobileViewPickerUpdateFrame = 0;
    protected mobileViewPickerActivating = false;
    protected mobileViewPickerSuppressClick = false;
    protected readonly onAuthSessionChanged = (): void => this.updateAccountVisual();

    constructor(
        protected readonly commands: CommandRegistry,
        protected readonly shell: ApplicationShell,
        protected readonly terminalService: TerminalService,
        protected readonly miniBrowserOpenHandler: QaapMiniBrowserOpenHandler,
        protected readonly projectBootstrap: QaapProjectBootstrapService,
        protected readonly workspaceService: WorkspaceService,
        protected readonly appearanceModeService?: QaapAppearanceModeService,
    ) {
        const node = document.createElement('motion.div');
        node.classList.add('theia-workbench-right-controls');
        super({ node });
        this.id = 'theia:workbench-right-controls';
        this.terminalBtn = createWorkbenchNavBtn(
            'codicon codicon-terminal',
            nls.localize('theia/core/workbenchBar/toggleTerminal', 'Toggle Terminal')
        );
        this.terminalBtn.classList.add('theia-workbench-in-mobile-bottom-bar');
        this.terminalBtn.setAttribute('role', 'switch');
        this.aiChatBtn = createWorkbenchNavBtn(
            'codicon codicon-comment-discussion',
            nls.localize('theia/core/workbenchBar/openAiChat', 'Open AI Chat')
        );
        this.aiChatBtn.classList.add('theia-workbench-in-mobile-bottom-bar');
        this.mobileChatTabBtn = createWorkbenchNavBtn(
            'codicon codicon-comment-discussion',
            nls.localize('theia/core/workbenchBar/openAiChat', 'Open AI Chat')
        );
        this.mobileChatTabBtn.classList.add('theia-workbench-mobile-chat-tab-btn');
        this.mobileChatTabBtn.setAttribute('role', 'switch');
        this.mobileChatTabBtn.setAttribute('aria-checked', 'false');
        this.mobileViewPickerBtn = document.createElement('button');
        this.mobileViewPickerBtn.type = 'button';
        this.mobileViewPickerBtn.className = 'theia-workbench-nav-btn theia-workbench-mobile-view-picker-btn';
        this.mobileViewPickerBtn.hidden = true;
        this.mobileViewPickerBtn.setAttribute('aria-hidden', 'true');
        this.mobileViewPickerBtn.setAttribute('aria-haspopup', 'menu');
        this.mobileViewPickerBtn.setAttribute('aria-expanded', 'false');
        this.mobileViewPickerBtn.title = nls.localize('qaap/mobileBottomBar/viewSelector', 'View');
        this.mobileViewPickerBtn.setAttribute('aria-label', this.mobileViewPickerBtn.title);
        this.mobileViewPickerOptions = this.getFallbackMobileViewPickerOptions();
        this.renderMobileViewPickerButton();
        this.mobileViewPickerSlot = document.createElement('span');
        this.mobileViewPickerSlot.className = 'theia-workbench-mobile-view-picker-slot';
        this.mobileViewPickerSlot.hidden = true;
        this.accountBtn = document.createElement('button');
        this.accountBtn.type = 'button';
        this.accountBtn.className = 'theia-workbench-nav-btn theia-workbench-account-btn';
        this.accountBtn.title = nls.localize('qaap/accountMenu/title', 'Account');
        this.accountBtn.setAttribute('aria-haspopup', 'menu');
        this.accountAvatar = document.createElement('span');
        this.accountAvatar.className = 'theia-workbench-account-avatar';
        this.accountAvatar.setAttribute('aria-hidden', 'true');
        this.accountBtn.appendChild(this.accountAvatar);
        this.mobileViewPickerSlot.append(this.mobileViewPickerBtn);
        node.append(this.terminalBtn, this.aiChatBtn, this.mobileViewPickerSlot, this.accountBtn);
        this.terminalBtn.addEventListener('click', this.onTerminalClick);
        this.aiChatBtn.addEventListener('click', this.onAiChatClick);
        this.mobileChatTabBtn.addEventListener('click', this.onAiChatClick);
        this.mobileViewPickerBtn.addEventListener('pointerdown', this.onMobileViewPickerPointerDown);
        this.mobileViewPickerBtn.addEventListener('click', this.onMobileViewPickerClick);
        this.accountBtn.addEventListener('click', this.onAccountClick);
        const refresh = (): void => this.updateEnabledStates();
        this.toDispose.push(this.commands.onDidExecuteCommand(refresh));
        this.toDispose.push(this.commands.onCommandsChanged(refresh));
        this.toDispose.push(this.shell.onDidChangeActiveWidget(refresh));
        this.toDispose.push(this.shell.onDidChangeCurrentWidget(refresh));
        this.toDispose.push(this.shell.onDidAddWidget(refresh));
        this.toDispose.push(this.shell.onDidRemoveWidget(refresh));
        // The view picker's enable checks depend on `workspaceService.opened`, which flips
        // asynchronously after startup. Without these, a cold boot straight into the IDE
        // surface can run the last picker update while `opened` is still false and leave
        // the picker hidden until some unrelated command fires.
        this.toDispose.push(this.workspaceService.onWorkspaceChanged(refresh));
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(refresh));
        // Re-evaluate the mobile view picker when the viewport crosses the one-column
        // breakpoint: command/widget events alone leave it stuck when the layout mode
        // changes without any command executing (e.g. rotation or window resize).
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            const mq = window.matchMedia(MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY);
            const onMqChange = (): void => refresh();
            mq.addEventListener('change', onMqChange);
            this.toDispose.push(Disposable.create(() => mq.removeEventListener('change', onMqChange)));
        }
    }

    protected readonly onTerminalClick = (): void => {
        void this.activateTerminalFromAvatar();
    };
    protected readonly onAiChatClick = (): void => {
        if (shouldShowMobileIdeHeaderViews()) {
            collapseLeftPanelIfMobileOneColumn(this.shell);
            if (this.commands.getCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE) && this.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)) {
                void this.commands.executeCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, 'agent');
                return;
            }
        }
        this.runIfEnabled(WORKBENCH_AI_CHAT_TOGGLE);
    };
    protected readonly onAccountClick = (): void => {
        const signedIn = readQaapSignedIn();
        toggleQaapAccountMenu(this.accountBtn, this.commands, this.buildAccountMenuEntries(signedIn), undefined, {
            appearance: qaapAccountMenuAppearanceFromService(this.appearanceModeService),
        });
    };
    protected buildAccountMenuEntries(signedIn: boolean): QaapAccountMenuEntry[] {
        // The IDE views (Preview / Terminal / Explorer / PR) live in the dedicated view
        // picker (the ▷ dropdown in the tab-bar row), not in the account menu. Keep the
        // avatar menu as the standard account menu; IDE/Agents switching lives in the
        // Work Hub sidebar header and the centered IDE top bar.
        return buildQaapAccountMenuEntries(signedIn);
    }

    protected buildIdeHeaderViewMenuEntries(): QaapAccountMenuEntry[] {
        const options = this.mobileViewPickerOptions.length
            ? this.mobileViewPickerOptions
            : this.getFallbackMobileViewPickerOptions();
        return options.map(option => ({
            kind: 'action',
            label: option.id === 'explore' ? nls.localize('qaap/accountMenu/explorer', 'Explorer') : option.label,
            commandId: `${QAAP_IDE_AVATAR_VIEW_COMMAND_PREFIX}${option.id}`,
            iconClass: option.icon,
            activeMark: option.id === this.mobileViewPickerActiveId,
            run: () => this.activateIdeAvatarView(option.id),
        }));
    }

    protected activateIdeAvatarView(id: MobileBottomButtonId): void {
        switch (id) {
            case 'agent':
                this.onAiChatClick();
                return;
            case 'preview':
                void this.activatePreviewFromAvatar();
                return;
            case 'terminal':
                void this.activateTerminalFromAvatar();
                return;
            case 'explore':
                this.activateExplorerFromAvatar();
                return;
            default:
                if (this.commands.getCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE) && this.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)) {
                    void this.commands.executeCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, id).catch(() => undefined);
                }
        }
    }

    protected async activatePreviewFromAvatar(): Promise<void> {
        const preview = await this.miniBrowserOpenHandler.openEmptyPreviewTab();
        if (preview) {
            await this.shell.activateWidget(preview.id);
        }
        void this.focusOrBootstrapPreview().catch(e => console.error('[qaap-mobile-shell] activatePreviewFromAvatar failed', e));
    }

    protected async focusOrBootstrapPreview(): Promise<void> {
        if (this.projectBootstrap.previewUrl) {
            await this.projectBootstrap.focusPreview();
            return;
        }
        const phase = this.projectBootstrap.phase;
        const descriptor = this.projectBootstrap.descriptor;
        if (phase === 'run-failed' && this.projectBootstrap.needsInstall && descriptor?.installCommand) {
            await this.projectBootstrap.runInstall();
            return;
        }
        if (this.projectBootstrap.hasRunnableDevPlan()
            && (phase === 'ready-to-run' || phase === 'starting' || phase === 'run-failed')) {
            await this.projectBootstrap.runDevServer();
            return;
        }
        if (phase === 'detected' && descriptor?.installCommand) {
            await this.projectBootstrap.runInstall();
        }
    }

    protected async activateTerminalFromAvatar(): Promise<void> {
        // Toggle: if the bottom panel is already showing a terminal, collapse it.
        if (this.shell.isExpanded('bottom') && !this.shell.bottomPanel.isEmpty) {
            this.shell.collapsePanel('bottom');
            return;
        }
        const terminal = this.terminalService.currentTerminal
            ?? this.terminalService.lastUsedTerminal
            ?? this.terminalService.all.find(candidate => !candidate.hiddenFromUser)
            ?? await this.terminalService.newTerminal({});
        await this.terminalService.open(terminal, { mode: 'activate' });
        if (!this.shell.isExpanded('bottom')) {
            this.shell.expandPanel('bottom');
        }
    }

    protected activateExplorerFromAvatar(): void {
        void this.shell.activateWidget(EXPLORER_VIEW_CONTAINER_ID).then(widget => {
            if (widget && !this.shell.isExpanded('left')) {
                this.shell.expandPanel('left');
            }
        }).catch(() => undefined);
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        window.addEventListener('qaap-auth-session-changed', this.onAuthSessionChanged);
        this.updateEnabledStates();
        this.updateAccountVisual();
        this.syncMobileViewPickerSlot();
    }

    protected override onBeforeDetach(msg: Message): void {
        dismissQaapAccountMenu();
        this.closeMobileViewPickerMenu();
        window.removeEventListener('qaap-auth-session-changed', this.onAuthSessionChanged);
        super.onBeforeDetach(msg);
    }

    override dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.toDispose.dispose();
        dismissQaapAccountMenu();
        if (this.mobileViewPickerUpdateFrame) {
            window.cancelAnimationFrame(this.mobileViewPickerUpdateFrame);
            this.mobileViewPickerUpdateFrame = 0;
        }
        this.closeMobileViewPickerMenu();
        this.mobileViewPickerMenu?.remove();
        this.mobileViewPickerMenu = undefined;
        this.mobileViewPickerSlot.append(this.mobileViewPickerBtn);
        document.body.classList.remove('theia-mobile-mod-ide-header-view-picker');
        window.removeEventListener('qaap-auth-session-changed', this.onAuthSessionChanged);
        this.terminalBtn.removeEventListener('click', this.onTerminalClick);
        this.aiChatBtn.removeEventListener('click', this.onAiChatClick);
        this.mobileViewPickerBtn.removeEventListener('pointerdown', this.onMobileViewPickerPointerDown);
        this.mobileViewPickerBtn.removeEventListener('click', this.onMobileViewPickerClick);
        this.accountBtn.removeEventListener('click', this.onAccountClick);
        super.dispose();
    }

    protected runIfEnabled(commandId: string): void {
        if (!this.commands.isEnabled(commandId)) {
            return;
        }
        void this.commands.executeCommand(commandId).catch(() => undefined);
    }

    protected updateEnabledStates(): void {
        const canToggleBottom = this.commands.isEnabled(CommonCommands.TOGGLE_BOTTOM_PANEL.id);
        const canOpenTerminal = this.commands.isEnabled(WORKBENCH_TOGGLE_TERMINAL);
        this.terminalBtn.disabled = !canToggleBottom && !canOpenTerminal;
        this.aiChatBtn.disabled = !this.commands.isEnabled(WORKBENCH_AI_CHAT_TOGGLE);
        this.updateTerminalSwitchVisual();
        this.updateAiChatSwitchVisual();
        this.scheduleMobileViewPickerUpdate();
        this.updateAccountVisual();
    }

    /** Refresh toggled state after mobile shell surfaces open or close outside this widget. */
    refreshChrome(): void {
        this.updateEnabledStates();
    }

    protected updateAccountVisual(): void {
        this.accountBtn.hidden = false;
        this.accountBtn.style.display = '';
        renderQaapAccountAvatarVisual(this.accountAvatar, { titleTarget: this.accountBtn });
    }

    protected updateTerminalSwitchVisual(): void {
        const on = this.shell.isExpanded('bottom') && !this.shell.bottomPanel.isEmpty;
        this.terminalBtn.classList.toggle('theia-mod-toggled', on);
        this.terminalBtn.setAttribute('aria-checked', on ? 'true' : 'false');
        this.terminalBtn.title = on
            ? nls.localize('theia/core/workbenchBar/hideTerminal', 'Hide Terminal')
            : nls.localize('theia/core/workbenchBar/showTerminal', 'Show Terminal');
        this.terminalBtn.setAttribute('aria-label', this.terminalBtn.title);
    }

    protected updateAiChatSwitchVisual(): void {
        const narrow = shouldShowMobileIdeHeaderViews();
        if (!narrow) {
            this.aiChatBtn.classList.remove('theia-mod-toggled');
            this.aiChatBtn.title = nls.localize('theia/core/workbenchBar/openAiChat', 'Open AI Chat');
            this.aiChatBtn.setAttribute('aria-label', this.aiChatBtn.title);
            this.mobileChatTabBtn.classList.remove('theia-mod-toggled');
            this.mobileChatTabBtn.setAttribute('aria-checked', 'false');
            return;
        }
        const title = this.shell.rightPanelHandler.tabBar.currentTitle;
        const on = this.shell.isExpanded('right') && title?.owner?.id === WORKBENCH_CHAT_VIEW_WIDGET_ID;
        this.aiChatBtn.classList.toggle('theia-mod-toggled', on);
        this.aiChatBtn.title = on
            ? nls.localize('theia/core/workbenchBar/hideAiChat', 'Hide AI Chat')
            : nls.localize('theia/core/workbenchBar/openAiChat', 'Open AI Chat');
        this.aiChatBtn.setAttribute('aria-label', this.aiChatBtn.title);
        this.mobileChatTabBtn.classList.toggle('theia-mod-toggled', on);
        this.mobileChatTabBtn.setAttribute('aria-checked', on ? 'true' : 'false');
        this.mobileChatTabBtn.title = this.aiChatBtn.title;
        this.mobileChatTabBtn.setAttribute('aria-label', this.aiChatBtn.title);
    }

    protected scheduleMobileViewPickerUpdate(): void {
        if (this.mobileViewPickerUpdateFrame) {
            return;
        }
        this.mobileViewPickerUpdateFrame = window.requestAnimationFrame(() => {
            this.mobileViewPickerUpdateFrame = 0;
            void this.updateMobileViewPicker();
        });
    }

    protected async updateMobileViewPicker(): Promise<void> {
        if (this.mobileViewPickerUpdatePromise) {
            return this.mobileViewPickerUpdatePromise;
        }
        this.mobileViewPickerUpdatePromise = this.doUpdateMobileViewPicker()
            .finally(() => this.mobileViewPickerUpdatePromise = undefined);
        return this.mobileViewPickerUpdatePromise;
    }

    protected async doUpdateMobileViewPicker(): Promise<void> {
        this.mobileViewPickerUpdating = true;
        const visible = shouldShowMobileIdeHeaderViews()
            && this.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_OPTIONS)
            && this.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVE)
            && this.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE);
        this.mobileViewPickerBtn.hidden = !visible;
        this.mobileViewPickerBtn.style.display = visible ? '' : 'none';
        this.mobileViewPickerBtn.setAttribute('aria-hidden', visible ? 'false' : 'true');
        this.mobileViewPickerSlot.hidden = !visible;
        this.mobileViewPickerSlot.style.display = visible ? '' : 'none';
        document.body.classList.toggle('theia-mobile-mod-ide-header-view-picker', visible);
        this.syncMobileViewPickerSlot();
        if (!visible) {
            this.mobileViewPickerOptions = [];
            this.closeMobileViewPickerMenu();
            this.mobileViewPickerUpdating = false;
            return;
        }
        try {
            const [options, activeId] = await Promise.all([
                this.commands.executeCommand<MobileBottomButton[]>(QAAP_MOBILE_IDE_HEADER_VIEW_OPTIONS),
                this.commands.executeCommand<MobileBottomButtonId>(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVE),
            ]);
            this.mobileViewPickerOptions = options ?? [];
            this.mobileViewPickerActiveId = activeId ?? 'editor';
            this.renderMobileViewPickerButton();
            this.syncMobileViewPickerSlot();
            if (this.mobileViewPickerMenu?.classList.contains('theia-mod-open')) {
                this.populateMobileViewPickerMenu();
                this.positionMobileViewPickerMenu();
            }
        } catch {
            this.mobileViewPickerBtn.hidden = true;
            this.mobileViewPickerBtn.style.display = 'none';
            this.mobileViewPickerBtn.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('theia-mobile-mod-ide-header-view-picker');
            this.closeMobileViewPickerMenu();
        } finally {
            this.mobileViewPickerUpdating = false;
        }
    }

    protected renderMobileViewPickerButton(): void {
        const active = this.mobileViewPickerOptions.find(option => option.id === this.mobileViewPickerActiveId)
            ?? this.mobileViewPickerOptions[0];
        if (!active) {
            return;
        }
        this.mobileViewPickerBtn.title = active.label;
        this.mobileViewPickerBtn.setAttribute('aria-label', active.label);
        this.mobileViewPickerBtn.replaceChildren(
            this.createMobileViewPickerIcon(active.icon),
            this.createMobileViewPickerChevron(),
        );
    }

    protected syncMobileViewPickerSlot(): void {
        const tabBarRow = this.resolveMobileViewPickerTabBarRow();
        const historyNav = document.getElementById('theia:workbench-history-nav');
        const showMobileIdeHeaderViews = shouldShowMobileIdeHeaderViews() && !this.mobileViewPickerBtn.hidden;
        if (showMobileIdeHeaderViews && tabBarRow) {
            this.mobileChatTabBtn.hidden = false;
            this.mobileChatTabBtn.style.display = '';
            // Chat tab button: always first in the tab bar row, before the view picker.
            if (this.mobileChatTabBtn.parentElement !== tabBarRow) {
                tabBarRow.insertBefore(this.mobileChatTabBtn, tabBarRow.firstChild);
            } else if (this.mobileChatTabBtn.nextElementSibling !== this.mobileViewPickerBtn) {
                tabBarRow.insertBefore(this.mobileChatTabBtn, tabBarRow.firstChild);
            }
            if (this.mobileViewPickerBtn.parentElement !== tabBarRow) {
                tabBarRow.insertBefore(this.mobileViewPickerBtn, this.mobileChatTabBtn.nextSibling);
            }
            return;
        }
        if (showMobileIdeHeaderViews && historyNav) {
            this.mobileChatTabBtn.hidden = false;
            this.mobileChatTabBtn.style.display = '';
            if (this.mobileChatTabBtn.parentElement !== historyNav) {
                historyNav.insertBefore(this.mobileChatTabBtn, historyNav.firstChild);
            }
            if (this.mobileViewPickerBtn.parentElement !== historyNav) {
                historyNav.insertBefore(this.mobileViewPickerBtn, this.mobileChatTabBtn.nextSibling);
            }
            return;
        }
        this.mobileChatTabBtn.hidden = true;
        this.mobileChatTabBtn.style.display = 'none';
        if (this.mobileChatTabBtn.parentElement !== this.node) {
            this.node.insertBefore(this.mobileChatTabBtn, this.mobileViewPickerSlot);
        }
        if (this.mobileViewPickerBtn.parentElement !== this.mobileViewPickerSlot) {
            this.mobileViewPickerSlot.append(this.mobileViewPickerBtn);
        }
    }

    protected resolveMobileViewPickerTabBarRow(): HTMLElement | undefined {
        const rows = Array.from(document.querySelectorAll<HTMLElement>(
            '#theia-main-content-panel .lm-TabBar .theia-tabBar-tab-row',
        ));
        return rows.find(row => {
            const rect = row.getBoundingClientRect();
            const style = window.getComputedStyle(row);
            return rect.width > 120
                && rect.height > 20
                && rect.top >= 40
                && rect.top < 120
                && style.display !== 'none'
                && style.visibility !== 'hidden';
        });
    }

    protected createMobileViewPickerIcon(icon: string): HTMLElement {
        const span = document.createElement('span');
        span.className = `codicon ${icon} theia-workbench-mobile-view-picker-icon`;
        span.setAttribute('aria-hidden', 'true');
        return span;
    }

    protected createMobileViewPickerChevron(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'codicon codicon-chevron-down theia-workbench-mobile-view-picker-chevron';
        span.setAttribute('aria-hidden', 'true');
        return span;
    }

    protected readonly onMobileViewPickerPointerDown = (event: PointerEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        this.mobileViewPickerSuppressClick = true;
        window.setTimeout(() => this.mobileViewPickerSuppressClick = false, 0);
        this.toggleMobileViewPickerMenu();
    };

    protected readonly onMobileViewPickerClick = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        if (this.mobileViewPickerSuppressClick) {
            return;
        }
        this.toggleMobileViewPickerMenu();
    };

    protected toggleMobileViewPickerMenu(): void {
        if (this.mobileViewPickerMenu?.classList.contains('theia-mod-open')) {
            this.closeMobileViewPickerMenu();
            return;
        }
        this.openMobileViewPickerMenu();
    }

    protected openMobileViewPickerMenu(): void {
        if (!shouldShowMobileIdeHeaderViews()) {
            return;
        }
        if (!this.mobileViewPickerOptions.length) {
            this.mobileViewPickerOptions = this.getFallbackMobileViewPickerOptions();
            this.renderMobileViewPickerButton();
        }
        if (!this.mobileViewPickerOptions.length || this.mobileViewPickerBtn.hidden) {
            return;
        }
        const menu = this.ensureMobileViewPickerMenu();
        this.populateMobileViewPickerMenu();
        this.mobileViewPickerBtn.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
        menu.classList.add('theia-mod-open');
        this.positionMobileViewPickerMenu();
        this.focusMobileViewPickerActiveItem();

        const onDismiss = (event: Event): void => {
            const target = event.target;
            if (target instanceof Node && (menu.contains(target) || this.mobileViewPickerBtn.contains(target))) {
                return;
            }
            this.closeMobileViewPickerMenu();
        };
        const onReposition = (): void => this.positionMobileViewPickerMenu();
        window.setTimeout(() => window.addEventListener('pointerdown', onDismiss, true), 0);
        window.addEventListener('resize', onReposition);
        window.addEventListener('scroll', onReposition, true);
        this.mobileViewPickerDismiss.dispose();
        this.mobileViewPickerDismiss = Disposable.create(() => {
            window.removeEventListener('pointerdown', onDismiss, true);
            window.removeEventListener('resize', onReposition);
            window.removeEventListener('scroll', onReposition, true);
        });
        this.scheduleMobileViewPickerUpdate();
    }

    protected getFallbackMobileViewPickerOptions(): MobileBottomButton[] {
        return [
            { id: 'agent', label: nls.localize('theia/core/mobileBottomBar/agent', 'Chat'), icon: 'codicon-comment-discussion' },
            { id: 'preview', label: nls.localize('theia/core/mobileBottomBar/preview', 'Preview'), icon: 'codicon-play' },
            { id: 'terminal', label: nls.localize('theia/core/mobileBottomBar/terminal', 'Terminal'), icon: 'codicon-terminal' },
            { id: 'explore', label: nls.localize('theia/core/mobileBottomBar/explore', 'Explore'), icon: 'codicon-folder-opened' },
            { id: 'pr', label: nls.localize('theia/core/mobileBottomBar/pr', 'PR'), icon: 'codicon-git-pull-request' },
        ];
    }

    protected ensureMobileViewPickerMenu(): HTMLElement {
        if (this.mobileViewPickerMenu) {
            return this.mobileViewPickerMenu;
        }
        const menu = document.createElement('div');
        menu.className = 'qaap-work-hub-toolbar-menu theia-workbench-mobile-view-picker-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', nls.localize('qaap/mobileBottomBar/viewSelector', 'View'));
        menu.addEventListener('keydown', event => this.onMobileViewPickerMenuKeydown(event));
        document.body.append(menu);
        this.mobileViewPickerMenu = menu;
        return menu;
    }

    protected populateMobileViewPickerMenu(): void {
        const menu = this.ensureMobileViewPickerMenu();
        menu.replaceChildren();
        for (const option of this.mobileViewPickerOptions) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'qaap-work-hub-toolbar-menu-item theia-workbench-mobile-view-picker-item';
            item.setAttribute('role', 'menuitem');
            item.tabIndex = option.id === this.mobileViewPickerActiveId ? 0 : -1;
            item.setAttribute('aria-current', option.id === this.mobileViewPickerActiveId ? 'true' : 'false');
            item.dataset.viewId = option.id;
            item.append(this.createMobileViewPickerIcon(option.icon), document.createTextNode(option.label));
            item.addEventListener('pointerup', event => this.onMobileViewPickerItemActivate(event, option.id));
            item.addEventListener('click', event => this.onMobileViewPickerItemActivate(event, option.id));
            menu.append(item);
        }
    }

    protected onMobileViewPickerItemActivate(event: Event, id: MobileBottomButtonId): void {
        event.preventDefault();
        event.stopPropagation();
        void this.activateMobileViewPickerItem(id);
    }

    protected async activateMobileViewPickerItem(id: MobileBottomButtonId): Promise<void> {
        if (this.mobileViewPickerActivating) {
            return;
        }
        this.mobileViewPickerActivating = true;
        this.mobileViewPickerBtn.disabled = true;
        this.closeMobileViewPickerMenu();
        try {
            await this.commands.executeCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, id);
        } catch (error) {
            console.error(`[qaap-mobile-shell] mobile view selector failed: ${id}`, error);
        } finally {
            this.mobileViewPickerBtn.disabled = false;
            this.mobileViewPickerActivating = false;
            this.scheduleMobileViewPickerUpdate();
        }
    }

    protected onMobileViewPickerMenuKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.closeMobileViewPickerMenu();
            this.mobileViewPickerBtn.focus();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
            return;
        }
        const items = this.getMobileViewPickerMenuItems();
        if (!items.length) {
            return;
        }
        event.preventDefault();
        const currentIndex = Math.max(0, items.findIndex(item => item === document.activeElement));
        const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? items.length - 1
                : event.key === 'ArrowDown'
                    ? (currentIndex + 1) % items.length
                    : (currentIndex - 1 + items.length) % items.length;
        items.forEach((item, index) => item.tabIndex = index === nextIndex ? 0 : -1);
        items[nextIndex].focus();
    }

    protected focusMobileViewPickerActiveItem(): void {
        const items = this.getMobileViewPickerMenuItems();
        const active = items.find(item => item.getAttribute('aria-current') === 'true') ?? items[0];
        active?.focus();
    }

    protected getMobileViewPickerMenuItems(): HTMLButtonElement[] {
        if (!this.mobileViewPickerMenu) {
            return [];
        }
        return Array.from(this.mobileViewPickerMenu.querySelectorAll<HTMLButtonElement>('.theia-workbench-mobile-view-picker-item'));
    }

    protected closeMobileViewPickerMenu(): void {
        this.mobileViewPickerBtn.setAttribute('aria-expanded', 'false');
        if (this.mobileViewPickerMenu) {
            this.mobileViewPickerMenu.hidden = true;
            this.mobileViewPickerMenu.classList.remove('theia-mod-open');
            this.mobileViewPickerMenu.style.top = '';
            this.mobileViewPickerMenu.style.left = '';
        }
        this.mobileViewPickerDismiss.dispose();
        this.mobileViewPickerDismiss = Disposable.NULL;
    }

    protected positionMobileViewPickerMenu(): void {
        const menu = this.mobileViewPickerMenu;
        if (!menu || menu.hidden) {
            return;
        }
        const margin = 8;
        const gap = 6;
        const anchor = this.mobileViewPickerBtn.getBoundingClientRect();
        const menuWidth = Math.max(menu.offsetWidth || menu.scrollWidth, 220);
        const leftAnchored = this.mobileViewPickerBtn.closest('#theia\\:workbench-history-nav, .theia-tabBar-tab-row') !== null;
        let left = leftAnchored ? anchor.left : anchor.right - menuWidth;
        left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
        menu.style.top = `${Math.round(anchor.bottom + gap)}px`;
        menu.style.left = `${Math.round(left)}px`;
    }
}
