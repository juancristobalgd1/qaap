// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import { isOSX } from '@theia/core/lib/common/os';
import { MessageService } from '@theia/core/lib/common/message-service';
import { KeyCode } from '@theia/core/lib/browser/keyboard/keys';
import { KeybindingRegistry, KeybindingScope, ScopedKeybinding } from '@theia/core/lib/browser/keybinding';
import { KeymapsService } from '@theia/keymaps/lib/browser/keymaps-service';

/** One editable keybinding entry shown in the panel. */
export interface QaapWorkHubKeybindingRow {
    readonly binding: ScopedKeybinding;
    readonly commandId: string;
    readonly label: string;
    readonly group: QaapWorkHubKeybindingGroup;
}

/** Read-only composer shortcut shown above the registry entries. */
export interface QaapWorkHubComposerShortcut {
    readonly label: string;
    readonly keys: string[];
}

export type QaapWorkHubKeybindingGroup = 'qaap' | 'general';

/** Mutable state of one rendered panel; created by each `render` call. */
interface KeybindingsPanelState {
    readonly list: HTMLElement;
    query: string;
    /** Identity of the binding entry being re-recorded (see `recordingId`). */
    recording?: string;
    /** Last complete keystroke captured while recording. */
    pending?: string;
}

const DISABLED_COMMAND_PREFIX = '-';
const PASSTHROUGH_COMMAND = 'passthrough';
const QAAP_COMMAND_PREFIX = 'qaap';

/**
 * Keybindings section of the mobile Work Hub settings sheet.
 * Rendered into the sheet content host by the sheet (`render`), disposed when the section changes.
 * Lists the registry entries (default, user and workspace scopes) with search, Custom badges,
 * conflict hints, keystroke recording and reset. Composer shortcuts are read-only.
 */
@injectable()
export class QaapWorkHubKeybindingsPanel {

    @inject(KeybindingRegistry)
    protected readonly keybindingRegistry: KeybindingRegistry;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(KeymapsService)
    protected readonly keymapsService: KeymapsService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    /**
     * Renders the keybindings list into `host`.
     * @returns a disposable that tears the panel down (listeners and DOM).
     */
    render(host: HTMLElement): Disposable {
        const doc = host.ownerDocument;
        const root = doc.createElement('div');
        root.className = 'theia-mobile-work-hub-keybindings';

        const search = doc.createElement('input');
        search.type = 'search';
        search.className = 'theia-mobile-work-hub-keybindings-search';
        search.placeholder = nls.localize('qaap/settings/keybindings/search', 'Search keybindings');
        search.setAttribute('aria-label', nls.localize('qaap/settings/keybindings/search', 'Search keybindings'));

        const list = doc.createElement('div');
        list.className = 'theia-mobile-work-hub-keybindings-list';

        root.append(search, list);
        host.appendChild(root);

        const state: KeybindingsPanelState = { list, query: '' };
        search.addEventListener('input', () => {
            state.query = search.value.trim().toLowerCase();
            this.renderList(state);
        });
        const toDispose = new DisposableCollection();
        toDispose.push(this.keybindingRegistry.onKeybindingsChanged(() => this.renderList(state)));
        this.renderList(state);

        return Disposable.create(() => {
            toDispose.dispose();
            host.textContent = '';
        });
    }

    protected renderList(state: KeybindingsPanelState): void {
        const list = state.list;
        const doc = list.ownerDocument;
        list.textContent = '';
        const rows = this.collectRows().filter(row => this.matchesRow(row, state.query));
        const composer = this.composerShortcuts().filter(shortcut => this.matchesText(shortcut.label, state.query));

        if (composer.length > 0) {
            list.appendChild(this.groupElement(doc, nls.localize('qaap/settings/keybindings/groupComposer', 'Composer')));
            for (const shortcut of composer) {
                list.appendChild(this.composerRowElement(doc, shortcut));
            }
        }
        const groups: [QaapWorkHubKeybindingGroup, string][] = [
            ['qaap', nls.localize('qaap/settings/keybindings/groupWorkHub', 'Work Hub')],
            ['general', nls.localize('qaap/settings/keybindings/groupGeneral', 'General')]
        ];
        for (const [group, title] of groups) {
            const groupRows = rows.filter(row => row.group === group);
            if (groupRows.length === 0) {
                continue;
            }
            list.appendChild(this.groupElement(doc, title));
            for (const row of groupRows) {
                list.appendChild(this.rowElement(doc, row, state));
            }
        }
        if (composer.length === 0 && rows.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'theia-mobile-work-hub-keybindings-empty';
            empty.textContent = nls.localize('qaap/settings/keybindings/noResults', 'No keybindings match your search.');
            list.appendChild(empty);
        }
    }

    /** Registry entries with a command label, sorted by label. Work Hub commands are grouped first. */
    protected collectRows(): QaapWorkHubKeybindingRow[] {
        const commands = new Map<string, { label?: string; category?: string }>();
        for (const command of this.commandRegistry.getAllCommands()) {
            commands.set(command.id, command);
        }
        const scopes = [KeybindingScope.DEFAULT, KeybindingScope.USER, KeybindingScope.WORKSPACE];
        const rows: QaapWorkHubKeybindingRow[] = [];
        for (const scope of scopes) {
            for (const binding of this.keybindingRegistry.getKeybindingsByScope(scope)) {
                if (binding.command.startsWith(DISABLED_COMMAND_PREFIX) || binding.command === PASSTHROUGH_COMMAND) {
                    continue;
                }
                const command = commands.get(binding.command);
                if (!command?.label) {
                    continue;
                }
                const label = command.category ? `${command.category}: ${command.label}` : command.label;
                rows.push({
                    binding,
                    commandId: binding.command,
                    label,
                    group: binding.command.startsWith(QAAP_COMMAND_PREFIX) ? 'qaap' : 'general'
                });
            }
        }
        return rows.sort((a, b) => a.label.localeCompare(b.label));
    }

    /** Read-only shortcuts of the composer, which are not part of the keybinding registry. */
    protected composerShortcuts(): QaapWorkHubComposerShortcut[] {
        const mod = isOSX ? '⌘' : 'Ctrl';
        return [
            { label: nls.localize('qaap/settings/keybindings/composerSend', 'Send message'), keys: ['Enter'] },
            { label: nls.localize('qaap/settings/keybindings/composerNewLine', 'New line'), keys: ['Shift', 'Enter'] },
            { label: nls.localize('qaap/settings/keybindings/composerParallel', 'Send in parallel'), keys: ['Alt', 'Enter'] },
            { label: nls.localize('qaap/settings/keybindings/composerInterrupt', 'Interrupt agent'), keys: [mod, 'Enter'] },
            { label: nls.localize('qaap/settings/keybindings/composerModel', 'Select model'), keys: [mod, '1–9'] },
            { label: nls.localize('qaap/settings/keybindings/composerHistory', 'Previous prompt'), keys: ['↑'] },
            { label: nls.localize('qaap/settings/keybindings/composerFind', 'Search transcript'), keys: [mod, 'F'] },
            { label: nls.localizeByDefault('Close'), keys: ['Esc'] }
        ];
    }

    protected matchesRow(row: QaapWorkHubKeybindingRow, query: string): boolean {
        if (!query) {
            return true;
        }
        return this.matchesText(row.label, query)
            || this.matchesText(row.commandId, query)
            || this.matchesText(row.binding.keybinding, query)
            || this.matchesText(row.binding.when ?? '', query);
    }

    protected matchesText(text: string, query: string): boolean {
        return !query || text.toLowerCase().includes(query);
    }

    protected groupElement(doc: Document, title: string): HTMLElement {
        const heading = doc.createElement('h3');
        heading.className = 'theia-mobile-work-hub-keybindings-group-title';
        heading.textContent = title;
        return heading;
    }

    protected composerRowElement(doc: Document, shortcut: QaapWorkHubComposerShortcut): HTMLElement {
        const row = doc.createElement('div');
        row.className = 'theia-mobile-work-hub-keybindings-row theia-mobile-work-hub-keybindings-row-readonly';
        row.append(this.labelElement(doc, shortcut.label), this.keysElement(doc, shortcut.keys));
        return row;
    }

    protected rowElement(doc: Document, row: QaapWorkHubKeybindingRow, state: KeybindingsPanelState): HTMLElement {
        const element = doc.createElement('div');
        element.className = 'theia-mobile-work-hub-keybindings-row';
        element.setAttribute('role', 'row');
        const isRecording = state.recording === this.recordingId(row);

        element.appendChild(this.labelElement(doc, row.label));
        element.appendChild(isRecording ? this.recordingElement(doc, row, state) : this.chipElement(doc, row, state));

        const meta = doc.createElement('div');
        meta.className = 'theia-mobile-work-hub-keybindings-meta';
        if (row.binding.when) {
            const when = doc.createElement('span');
            when.className = 'theia-mobile-work-hub-keybindings-when';
            when.textContent = row.binding.when;
            meta.appendChild(when);
        }
        const conflict = this.conflictLabel(row, isRecording && state.pending ? state.pending : row.binding.keybinding);
        if (conflict) {
            const warning = doc.createElement('span');
            warning.className = 'theia-mobile-work-hub-keybindings-conflict';
            warning.textContent = conflict;
            meta.appendChild(warning);
        }
        if (row.binding.scope === KeybindingScope.USER) {
            const badge = doc.createElement('span');
            badge.className = 'theia-mobile-work-hub-keybindings-badge';
            badge.textContent = nls.localize('qaap/settings/keybindings/custom', 'Custom');
            meta.appendChild(badge);
            const reset = doc.createElement('button');
            reset.type = 'button';
            reset.className = 'theia-mobile-work-hub-keybindings-reset codicon codicon-discard';
            reset.title = nls.localize('qaap/settings/keybindings/reset', 'Reset to default');
            reset.setAttribute('aria-label', reset.title);
            reset.addEventListener('click', () => this.resetCommand(row.commandId));
            meta.appendChild(reset);
        }
        if (meta.childElementCount > 0) {
            element.appendChild(meta);
        }
        return element;
    }

    protected labelElement(doc: Document, text: string): HTMLElement {
        const label = doc.createElement('span');
        label.className = 'theia-mobile-work-hub-keybindings-label';
        label.textContent = text;
        label.title = text;
        return label;
    }

    protected keysElement(doc: Document, keys: string[]): HTMLElement {
        const container = doc.createElement('span');
        container.className = 'theia-mobile-work-hub-keybindings-keys';
        for (const key of keys) {
            const kbd = doc.createElement('kbd');
            kbd.textContent = key;
            container.appendChild(kbd);
        }
        return container;
    }

    /** Chip(s) of the accelerator; clicking it starts recording a new keystroke for the row. */
    protected chipElement(doc: Document, row: QaapWorkHubKeybindingRow, state: KeybindingsPanelState): HTMLElement {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-keybindings-chip';
        button.setAttribute('aria-label', nls.localize('qaap/settings/keybindings/changeKey', 'Change keybinding for {0}', row.label));
        button.appendChild(this.keysElement(doc, this.keyChips(row.binding)));
        button.addEventListener('click', () => {
            state.recording = this.recordingId(row);
            state.pending = undefined;
            this.renderList(state);
            state.list.querySelector<HTMLElement>('.theia-mobile-work-hub-keybindings-recording')?.focus();
        });
        return button;
    }

    /** Focusable element that captures the next keystroke; Enter or blur confirms, Escape cancels. */
    protected recordingElement(doc: Document, row: QaapWorkHubKeybindingRow, state: KeybindingsPanelState): HTMLElement {
        const recording = doc.createElement('button');
        recording.type = 'button';
        recording.className = 'theia-mobile-work-hub-keybindings-recording';
        recording.textContent = nls.localize('qaap/settings/keybindings/pressKeys', 'Press keys… Esc to cancel');
        recording.addEventListener('keydown', (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') {
                this.stopRecording(state, row, false);
                return;
            }
            if (event.key === 'Enter') {
                this.stopRecording(state, row, true);
                return;
            }
            const keyCode = KeyCode.createKeyCode(event);
            if (keyCode.isModifierOnly()) {
                return;
            }
            state.pending = keyCode.toString();
            recording.textContent = this.keyChips(row.binding, state.pending).join(' ');
            const warning = recording.closest('.theia-mobile-work-hub-keybindings-row')
                ?.querySelector('.theia-mobile-work-hub-keybindings-conflict');
            if (warning) {
                warning.textContent = this.conflictLabel(row, state.pending) ?? '';
            }
        });
        recording.addEventListener('blur', () => this.stopRecording(state, row, true));
        return recording;
    }

    /** Ends recording. Idempotent, because removing the focused element can fire a second blur. */
    protected stopRecording(state: KeybindingsPanelState, row: QaapWorkHubKeybindingRow, confirm: boolean): void {
        if (state.recording === undefined) {
            return;
        }
        const pending = state.pending;
        state.recording = undefined;
        state.pending = undefined;
        this.renderList(state);
        if (confirm && pending && pending !== row.binding.keybinding) {
            this.saveBinding(row, pending);
        }
    }

    /** Human-readable conflict hint when another command already uses `keybinding` with the same `when`. */
    protected conflictLabel(row: QaapWorkHubKeybindingRow, keybinding: string): string | undefined {
        const other = this.collectRows().find(candidate =>
            candidate.commandId !== row.commandId
            && candidate.binding.keybinding === keybinding
            && (candidate.binding.when ?? '') === (row.binding.when ?? ''));
        return other
            ? nls.localize('qaap/settings/keybindings/conflict', 'Conflicts with {0}', other.label)
            : undefined;
    }

    /** Display chips for a keystroke string: one chip per key, with ⌘⇧⌥⌃ symbols on macOS. */
    protected keyChips(binding: ScopedKeybinding, keybinding: string = binding.keybinding): string[] {
        const accelerator = this.keybindingRegistry.acceleratorFor({ ...binding, keybinding }, '+');
        return accelerator.flatMap(element => element.split('+').filter(part => part.length > 0));
    }

    protected recordingId(row: QaapWorkHubKeybindingRow): string {
        return `${row.commandId}|${row.binding.scope}|${row.binding.keybinding}`;
    }

    protected async saveBinding(row: QaapWorkHubKeybindingRow, keybinding: string): Promise<void> {
        try {
            await this.keymapsService.setKeybinding({
                command: row.commandId,
                keybinding,
                when: row.binding.when,
                args: row.binding.args
            }, row.binding);
        } catch (error) {
            this.messageService.error(nls.localize('qaap/settings/keybindings/saveFailed', 'The keybinding could not be saved.'));
        }
    }

    protected async resetCommand(commandId: string): Promise<void> {
        try {
            await this.keymapsService.removeKeybinding(commandId);
        } catch (error) {
            this.messageService.error(nls.localize('qaap/settings/keybindings/resetFailed', 'The keybinding could not be reset.'));
        }
    }

}
