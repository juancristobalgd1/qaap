// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ENABLE_AI_CONTEXT_KEY } from '@theia/ai-core/lib/browser';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry, nls } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorContextMenu } from '@theia/editor/lib/browser';
import { QAAP_MOBILE_TOGGLE_PROJECTS_DASHBOARD } from './mobile-projects-dashboard-commands';
import { peekPreferDesktopIde } from './mobile-projects-open';
import { QaapComposerEditorContextService } from './qaap-composer-editor-context-service';

export const QAAP_COMPOSER_ADD_EDITOR_SELECTION_COMMAND = 'qaap.composer.addEditorSelection';

@injectable()
export class QaapComposerEditorContextContribution implements
    CommandContribution,
    MenuContribution,
    KeybindingContribution {

    @inject(QaapComposerEditorContextService)
    protected readonly editorContextService: QaapComposerEditorContextService;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({
            id: QAAP_COMPOSER_ADD_EDITOR_SELECTION_COMMAND,
            label: nls.localize('qaap/composer/addEditorSelection', 'Add selection to agent'),
            category: 'Qaap',
        }, {
            execute: () => { void this.addEditorSelectionToComposer(); },
            isEnabled: () => this.editorContextService.hasActiveEditor(),
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(EditorContextMenu.NAVIGATION, {
            commandId: QAAP_COMPOSER_ADD_EDITOR_SELECTION_COMMAND,
            label: nls.localize('qaap/composer/addEditorSelection', 'Add selection to agent'),
            when: ENABLE_AI_CONTEXT_KEY,
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: QAAP_COMPOSER_ADD_EDITOR_SELECTION_COMMAND,
            keybinding: 'ctrlcmd+shift+.',
            when: `${ENABLE_AI_CONTEXT_KEY} && editorFocus && !editorReadonly`,
        });
    }

    protected async addEditorSelectionToComposer(): Promise<void> {
        if (peekPreferDesktopIde()) {
            await this.commands.executeCommand(QAAP_MOBILE_TOGGLE_PROJECTS_DASHBOARD);
        }
        const pinned = this.editorContextService.pinEditorSelection({ focusComposer: true });
        if (!pinned) {
            return;
        }
    }
}
