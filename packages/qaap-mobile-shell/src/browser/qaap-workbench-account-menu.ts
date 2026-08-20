// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CommandRegistry, nls } from '@theia/core/lib/common';
import { Disposable } from '@theia/core/lib/common/disposable';
import { CommonCommands } from '@theia/core/lib/browser/common-commands';
import type { WorkHubCatalogAction, WorkHubCatalogItem, WorkHubCatalogSection } from '../common/mobile-work-hub-catalog';
import type { QaapAppearanceMode } from '../common/qaap-appearance-mode';
import { bindCatalogCardTapFeedback } from './qaap-catalog-card-tap-feedback';
import { QAAP_MESSAGE_CIRCLE_ICON_CLASS } from '../common/qaap-scm-changes-icon';
import { createQaapAppearanceModeSwitch } from './qaap-appearance-mode-switch';
import { createSegmentedField, type QaapSegmentedFieldController } from './qaap-mobile-form-ui';

export const QAAP_AUTH_SIGN_IN_GITHUB_COMMAND = 'qaap.auth.signInGithub';
export const QAAP_AUTH_SIGN_OUT_COMMAND = 'qaap.auth.signOut';
export const QAAP_WORK_HUB_OVERVIEW_COMMAND = 'qaap.workHub.showOverview';
export const QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND = 'qaap.mobile.openDesktopIde';

const WORKBENCH_SHOW_COMMANDS = 'workbench.action.showCommands';
const WORKBENCH_OPEN_EXTENSIONS = 'workbench.view.extensions';
const WORKBENCH_OPEN_KEYBINDINGS = 'workbench.action.openGlobalKeybindings';

export interface QaapAccountMenuEntry {
    kind: 'action' | 'separator';
    label?: string;
    commandId?: string;
    iconClass?: string;
    args?: unknown[];
    activeMark?: boolean;
    run?: () => void | Promise<void>;
}

export interface QaapAccountMenuViewToggleOptions {
    readonly activeId: MobileViewToggleId;
    readonly onSelect: (id: MobileViewToggleId) => void;
}

/** Shared IDE/Agents selector used by desktop navigation surfaces. */
export function createQaapViewModeSwitch(
    options: QaapAccountMenuViewToggleOptions,
): QaapSegmentedFieldController<MobileViewToggleId> {
    const field = createSegmentedField<MobileViewToggleId>({
        segments: [
            {
                id: 'editor',
                label: nls.localize('qaap/mobileBottomBar/ide', 'IDE'),
                iconClass: 'codicon-code',
            },
            {
                id: 'agent',
                label: nls.localize('qaap/mobileBottomBar/agents', 'Agents'),
                iconClass: QAAP_MESSAGE_CIRCLE_ICON_CLASS,
            },
        ],
        value: options.activeId,
        iconOnly: false,
        onChange: options.onSelect,
    });
    field.root.classList.add('theia-mod-header-surface');
    return field;
}

export interface QaapAccountMenuGettingStartedOptions {
    readonly section: WorkHubCatalogSection;
    readonly onCatalogAction: (action: WorkHubCatalogAction) => void;
}

export interface QaapAccountMenuAppearanceOptions {
    getMode(): QaapAppearanceMode;
    setMode(mode: QaapAppearanceMode): void;
    onDidChangeMode?(listener: (mode: QaapAppearanceMode) => void): Disposable;
}

export interface QaapAccountMenuOpenOptions {
    /** Prefer opening above the anchor (e.g. sessions sidebar footer). */
    readonly placement?: 'below' | 'above';
    /** Gap in px between menu and anchor (default 4 above, 8 below). */
    readonly anchorGap?: number;
    /** Invoked when the user picks a menu item or catalog card (before dismiss). */
    readonly onMenuAction?: () => void;
    /** Light / Dark / System switch shown in the avatar menu. */
    readonly appearance?: QaapAccountMenuAppearanceOptions;
}

export function qaapAccountMenuAppearanceFromService(service?: {
    getMode(): QaapAppearanceMode;
    setMode(mode: QaapAppearanceMode): void;
    onDidChangeMode(listener: (mode: QaapAppearanceMode) => void): Disposable;
}): QaapAccountMenuAppearanceOptions | undefined {
    if (!service) {
        return undefined;
    }
    return {
        getMode: () => service.getMode(),
        setMode: mode => service.setMode(mode),
        onDidChangeMode: listener => service.onDidChangeMode(listener),
    };
}

let activeMenu: HTMLElement | undefined;
let activeDismiss: (() => void) | undefined;
let activeAnchor: HTMLElement | undefined;

export const QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE = 'qaap.mobile.ideHeaderView.activate';

export type MobileViewToggleId = 'editor' | 'agent';

export function buildMobileViewToggleEntries(activeId: MobileViewToggleId): QaapAccountMenuEntry[] {
    return [
        {
            kind: 'action',
            label: nls.localize('qaap/mobileBottomBar/editor', 'Editor'),
            commandId: QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE,
            iconClass: 'codicon-code',
            args: ['editor'],
            activeMark: activeId === 'editor',
        },
        {
            kind: 'action',
            label: nls.localize('theia/core/mobileBottomBar/agent', 'Agent'),
            commandId: QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE,
            iconClass: 'codicon-comment-discussion',
            args: ['agent'],
            activeMark: activeId === 'agent',
        },
        { kind: 'separator' },
    ];
}

export interface QaapAccountMenuEntriesOptions {
    /**
     * Work Hub surface marker: omit Settings / Extensions / Keybindings from the avatar menu.
     * Settings stays available via Getting started / Command Palette sheets.
     */
    readonly workHub?: boolean;
    /** Work Hub: open the Billing sheet. */
    readonly openBilling?: () => void | Promise<void>;
}

function settingsMenuEntry(): QaapAccountMenuEntry {
    return {
        kind: 'action',
        label: nls.localize('qaap/accountMenu/settings', 'Settings'),
        iconClass: 'codicon-settings-gear',
        commandId: CommonCommands.OPEN_PREFERENCES.id,
    };
}

function billingMenuEntry(options?: QaapAccountMenuEntriesOptions): QaapAccountMenuEntry | undefined {
    if (!options?.openBilling) {
        return undefined;
    }
    return {
        kind: 'action',
        label: nls.localize('qaap/accountMenu/billing', 'Billing'),
        iconClass: 'codicon-credit-card',
        run: () => options.openBilling?.(),
    };
}

export function buildQaapAccountMenuEntries(
    signedIn: boolean = true,
    options?: QaapAccountMenuEntriesOptions,
): QaapAccountMenuEntry[] {
    const workHub = !!options?.workHub || !!options?.openBilling;
    const billing = billingMenuEntry(options);
    // Extensions / Keybindings open IDE views behind the hub.
    const ideWorkbenchLinks: QaapAccountMenuEntry[] = workHub ? [] : [
        {
            kind: 'action',
            label: nls.localize('qaap/accountMenu/extensions', 'Extensions'),
            commandId: WORKBENCH_OPEN_EXTENSIONS,
        },
        {
            kind: 'action',
            label: nls.localize('qaap/accountMenu/keybindings', 'Keyboard Shortcuts'),
            commandId: WORKBENCH_OPEN_KEYBINDINGS,
        },
    ];
    const settings: QaapAccountMenuEntry[] = workHub ? [] : [settingsMenuEntry()];
    if (!signedIn) {
        return [
            {
                kind: 'action',
                label: nls.localize('qaap/accountMenu/signInGithub', 'Sign in with GitHub'),
                commandId: QAAP_AUTH_SIGN_IN_GITHUB_COMMAND,
            },
            { kind: 'separator' },
            ...settings,
            ...(billing ? [billing] : []),
        ];
    }
    return [
        {
            kind: 'action',
            label: nls.localize('qaap/accountMenu/commandPalette', 'Command Palette…'),
            commandId: WORKBENCH_SHOW_COMMANDS,
        },
        { kind: 'separator' },
        ...settings,
        ...(billing ? [billing] : []),
        ...ideWorkbenchLinks,
        { kind: 'separator' },
        {
            kind: 'action',
            label: nls.localize('qaap/accountMenu/signOut', 'Sign Out'),
            commandId: QAAP_AUTH_SIGN_OUT_COMMAND,
        },
    ];
}

/** Minimal account menu for Work Hub / mobile projects (auth only). */
export function buildQaapAccountMenuSignOutOnly(signedIn: boolean): QaapAccountMenuEntry[] {
    if (!signedIn) {
        return [
            {
                kind: 'action',
                label: nls.localize('qaap/accountMenu/signInGithub', 'Sign in with GitHub'),
                commandId: QAAP_AUTH_SIGN_IN_GITHUB_COMMAND,
            },
        ];
    }
    return [
        {
            kind: 'action',
            label: nls.localize('qaap/accountMenu/signOut', 'Sign Out'),
            commandId: QAAP_AUTH_SIGN_OUT_COMMAND,
        },
    ];
}

export function dismissQaapAccountMenu(): void {
    activeDismiss?.();
}

export function isQaapAccountMenuOpen(anchor?: HTMLElement): boolean {
    if (!activeMenu || !activeDismiss) {
        return false;
    }
    if (anchor !== undefined && activeAnchor !== anchor) {
        return false;
    }
    return true;
}

/** Open the account menu, or close it if it is already open for the same anchor. */
export function toggleQaapAccountMenu(
    anchor: HTMLElement,
    commands: CommandRegistry,
    entries: QaapAccountMenuEntry[],
    gettingStarted?: QaapAccountMenuGettingStartedOptions,
    openOptions?: QaapAccountMenuOpenOptions,
): void {
    if (isQaapAccountMenuOpen(anchor)) {
        dismissQaapAccountMenu();
        return;
    }
    openQaapAccountMenu(anchor, commands, entries, gettingStarted, openOptions);
}

export function openQaapAccountMenu(
    anchor: HTMLElement,
    commands: CommandRegistry,
    entries: QaapAccountMenuEntry[],
    gettingStarted?: QaapAccountMenuGettingStartedOptions,
    openOptions?: QaapAccountMenuOpenOptions,
): void {
    if (activeAnchor !== anchor) {
        dismissQaapAccountMenu();
    }

    const panel = document.createElement('div');
    panel.className = 'theia-qaap-account-menu';
    panel.setAttribute('role', 'menu');
    panel.tabIndex = -1;

    if (gettingStarted && gettingStarted.section.items.length > 0) {
        panel.classList.add('theia-mod-with-getting-started');
        panel.appendChild(createAccountMenuGettingStartedBlock(
            gettingStarted.section,
            gettingStarted.onCatalogAction,
            openOptions?.onMenuAction,
        ));
        const sep = document.createElement('div');
        sep.className = 'theia-qaap-account-menu-separator';
        sep.setAttribute('role', 'separator');
        panel.appendChild(sep);
    }

    for (const entry of entries) {
        if (entry.kind === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'theia-qaap-account-menu-separator';
            sep.setAttribute('role', 'separator');
            panel.appendChild(sep);
            continue;
        }
        const commandId = entry.commandId;
        const run = entry.run;
        if ((!commandId && !run) || !entry.label) {
            continue;
        }
        const isQaapAuthCommand = commandId === QAAP_AUTH_SIGN_OUT_COMMAND
            || commandId === QAAP_AUTH_SIGN_IN_GITHUB_COMMAND;
        if (!run && commandId && !isQaapAuthCommand && !commands.getCommand(commandId)) {
            continue;
        }
        if (!run && commandId && !isQaapAuthCommand && !commands.isEnabled(commandId)) {
            continue;
        }
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'theia-qaap-account-menu-item';
        item.setAttribute('role', 'menuitem');
        if (entry.activeMark) {
            item.classList.add('theia-mod-active');
            item.setAttribute('aria-checked', 'true');
        }
        if (entry.iconClass) {
            const icon = document.createElement('span');
            icon.className = `codicon ${entry.iconClass}`;
            icon.setAttribute('aria-hidden', 'true');
            item.append(icon);
        }
        const labelSpan = document.createElement('span');
        labelSpan.className = 'theia-qaap-account-menu-item-label';
        labelSpan.textContent = entry.label;
        item.append(labelSpan);
        item.addEventListener('click', () => {
            openOptions?.onMenuAction?.();
            dismissQaapAccountMenu();
            if (run) {
                void Promise.resolve(run()).catch(() => undefined);
            } else if (commandId && (isQaapAuthCommand || (commands.getCommand(commandId) && commands.isEnabled(commandId)))) {
                void commands.executeCommand(commandId, ...(entry.args ?? [])).catch(() => undefined);
            }
        });
        panel.appendChild(item);
    }

    const appearanceDispose = appendAccountMenuAppearance(panel, openOptions?.appearance);

    if (!panel.childElementCount) {
        appearanceDispose.dispose();
        return;
    }

    document.body.appendChild(panel);
    activeMenu = panel;
    activeAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');

    const positionPanel = (): void => {
        const rect = anchor.getBoundingClientRect();
        const margin = 8;
        const gap = openOptions?.anchorGap ?? (openOptions?.placement === 'above' ? 4 : 8);
        const maxLeft = window.innerWidth - panel.offsetWidth - margin;
        let left = openOptions?.placement === 'above' ? rect.left : rect.right - panel.offsetWidth;
        left = Math.max(margin, Math.min(left, maxLeft));
        panel.style.left = `${left}px`;
        if (openOptions?.placement === 'above') {
            panel.style.top = 'auto';
            panel.style.bottom = `${window.innerHeight - rect.top + gap}px`;
            const maxHeight = Math.max(160, rect.top - gap - margin);
            panel.style.maxHeight = `${maxHeight}px`;
            panel.style.overflowY = 'auto';
            return;
        }
        panel.style.bottom = 'auto';
        panel.style.maxHeight = '';
        panel.style.overflowY = '';
        let top = rect.bottom + gap;
        const maxTop = window.innerHeight - panel.offsetHeight - margin;
        if (top > maxTop) {
            top = Math.max(margin, rect.top - panel.offsetHeight - gap);
        }
        panel.style.top = `${top}px`;
    };

    const onPointerDown = (event: PointerEvent): void => {
        const target = event.target as Node | null;
        if (target && (panel.contains(target) || anchor.contains(target))) {
            return;
        }
        dismissQaapAccountMenu();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            dismissQaapAccountMenu();
            anchor.focus();
        }
    };

    const dismiss = (): void => {
        appearanceDispose.dispose();
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        panel.remove();
        if (activeMenu === panel) {
            activeMenu = undefined;
        }
        if (activeDismiss === dismiss) {
            activeDismiss = undefined;
        }
        if (activeAnchor === anchor) {
            anchor.setAttribute('aria-expanded', 'false');
            anchor.classList.remove('theia-mod-active');
            activeAnchor = undefined;
        }
    };

    activeDismiss = dismiss;
    anchor.classList.add('theia-mod-active');
    requestAnimationFrame(() => {
        positionPanel();
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        panel.focus();
    });
}

function appendAccountMenuAppearance(
    panel: HTMLElement,
    appearance: QaapAccountMenuAppearanceOptions | undefined,
): Disposable {
    if (!appearance) {
        return Disposable.NULL;
    }
    if (panel.childElementCount > 0) {
        const sep = document.createElement('div');
        sep.className = 'theia-qaap-account-menu-separator';
        sep.setAttribute('role', 'separator');
        panel.appendChild(sep);
    }
    const row = document.createElement('div');
    row.className = 'theia-qaap-account-menu-appearance';
    const control = createQaapAppearanceModeSwitch({
        value: appearance.getMode(),
        onChange: mode => appearance.setMode(mode),
    });
    row.append(control.root);
    panel.appendChild(row);
    return appearance.onDidChangeMode?.(mode => control.setValue(mode)) ?? Disposable.NULL;
}

function createAccountMenuGettingStartedBlock(
    section: WorkHubCatalogSection,
    onCatalogAction: (action: WorkHubCatalogAction) => void,
    onMenuAction?: () => void,
): HTMLElement {
    const block = document.createElement('div');
    block.className = 'theia-qaap-account-menu-getting-started';

    const head = document.createElement('div');
    head.className = 'theia-qaap-account-menu-getting-started-head';
    const title = document.createElement('span');
    title.className = 'theia-qaap-account-menu-getting-started-title';
    title.textContent = section.title;
    head.append(title);

    const list = document.createElement('div');
    list.className = 'theia-qaap-account-menu-getting-started-cards';
    for (const item of section.items) {
        list.appendChild(createAccountMenuCatalogCard(item, onCatalogAction, onMenuAction));
    }

    block.append(head, list);
    return block;
}

function createAccountMenuCatalogCard(
    item: WorkHubCatalogItem,
    onCatalogAction: (action: WorkHubCatalogAction) => void,
    onMenuAction?: () => void,
): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theia-qaap-account-menu-catalog-card';
    card.setAttribute('role', 'menuitem');
    if (item.accent) {
        card.style.setProperty('--qaap-hub-catalog-accent', item.accent);
    }

    const icon = document.createElement('span');
    icon.className = `theia-qaap-account-menu-catalog-card-icon codicon ${item.iconClass}`;
    icon.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'theia-qaap-account-menu-catalog-card-body';

    const title = document.createElement('span');
    title.className = 'theia-qaap-account-menu-catalog-card-title';
    title.textContent = item.title;

    const subtitle = document.createElement('span');
    subtitle.className = 'theia-qaap-account-menu-catalog-card-subtitle';
    subtitle.textContent = item.subtitle;

    body.append(title, subtitle);

    if (item.progress !== undefined) {
        const progressWrap = document.createElement('div');
        progressWrap.className = 'theia-qaap-account-menu-catalog-card-progress';
        progressWrap.setAttribute('role', 'progressbar');
        progressWrap.setAttribute('aria-valuemin', '0');
        progressWrap.setAttribute('aria-valuemax', '100');
        const percent = Math.round(Math.max(0, Math.min(1, item.progress)) * 100);
        progressWrap.setAttribute('aria-valuenow', String(percent));
        const bar = document.createElement('span');
        bar.className = 'theia-qaap-account-menu-catalog-card-progress-bar';
        bar.style.width = `${percent}%`;
        progressWrap.append(bar);
        body.append(progressWrap);
    }

    if (item.meta) {
        const meta = document.createElement('span');
        meta.className = 'theia-qaap-account-menu-catalog-card-meta';
        meta.textContent = item.meta;
        body.append(meta);
    }

    card.append(icon, body);
    bindCatalogCardTapFeedback(card);
    card.addEventListener('click', () => {
        onMenuAction?.();
        dismissQaapAccountMenu();
        onCatalogAction(item.action);
    });
    return card;
}
