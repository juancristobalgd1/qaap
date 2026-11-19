// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import { KeybindingScope, ScopedKeybinding } from '@theia/core/lib/browser/keybinding';
import { QaapWorkHubKeybindingsPanel } from './qaap-work-hub-keybindings-panel';

disableImportJSDOM();

interface FakeCommand {
    id: string;
    label?: string;
    category?: string;
}

function binding(command: string, keybinding: string, scope: KeybindingScope = KeybindingScope.DEFAULT, when?: string): ScopedKeybinding {
    return { command, keybinding, scope, when };
}

interface Harness {
    host: HTMLElement;
    panel: QaapWorkHubKeybindingsPanel;
    changed: Emitter<void>;
    removed: string[];
    saved: { command: string; keybinding: string }[];
    errors: string[];
}

function createHarness(bindings: ScopedKeybinding[], commands: FakeCommand[]): Harness {
    const changed = new Emitter<void>();
    const removed: string[] = [];
    const saved: { command: string; keybinding: string }[] = [];
    const errors: string[] = [];
    const keybindingRegistry = {
        onKeybindingsChanged: changed.event,
        getKeybindingsByScope: (scope: KeybindingScope): ScopedKeybinding[] => bindings.filter(entry => entry.scope === scope),
        acceleratorFor: (entry: { keybinding: string }): string[] => [entry.keybinding.replace('ctrl', 'Ctrl')]
    };
    const commandRegistry = {
        getAllCommands: (): IterableIterator<FakeCommand> => commands[Symbol.iterator]()
    };
    const keymapsService = {
        setKeybinding: async (next: { command: string; keybinding: string }): Promise<void> => { saved.push(next); },
        removeKeybinding: async (commandId: string): Promise<void> => { removed.push(commandId); }
    };
    const messageService = {
        error: (message: string): void => { errors.push(message); }
    };
    const panel = Object.assign(new QaapWorkHubKeybindingsPanel(), {
        keybindingRegistry,
        commandRegistry,
        keymapsService,
        messageService
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    panel.render(host);
    return { host, panel, changed, removed, saved, errors };
}

function inputEvent(): Event {
    const event = document.createEvent('Event');
    event.initEvent('input', true, true);
    return event;
}

function rowLabels(host: HTMLElement): string[] {
    return Array.from(host.querySelectorAll('.theia-mobile-work-hub-keybindings-label')).map(label => label.textContent ?? '');
}

function registryRowLabels(host: HTMLElement): string[] {
    return Array.from(host.querySelectorAll('.theia-mobile-work-hub-keybindings-row:not(.theia-mobile-work-hub-keybindings-row-readonly) .theia-mobile-work-hub-keybindings-label')).map(label => label.textContent ?? '');
}

function groupTitles(host: HTMLElement): string[] {
    return Array.from(host.querySelectorAll('.theia-mobile-work-hub-keybindings-group-title')).map(title => title.textContent ?? '');
}

describe('QaapWorkHubKeybindingsPanel', () => {

    const commands: FakeCommand[] = [
        { id: 'qaap.chat.maximize', label: 'Maximize Chat', category: 'Chat' },
        { id: 'qaap.composer.addEditorSelection', label: 'Add selection to agent', category: 'Qaap' },
        { id: 'qaap.workHub.unlisted', label: 'Unlisted Qaap Command', category: 'Qaap' },
        { id: 'editor.action.inlineSuggest.commit', label: 'Accept Inline Suggestion' },
        { id: 'editor.action.format', label: 'Format Document' },
        { id: 'internal.hidden' }
    ];

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('lists only the composer keys and the allowlisted Work Hub commands', () => {
        const harness = createHarness([
            binding('qaap.chat.maximize', 'ctrlcmd+alt+e'),
            binding('qaap.composer.addEditorSelection', 'ctrlcmd+shift+.', KeybindingScope.DEFAULT, 'editorFocus'),
            binding('qaap.workHub.unlisted', 'ctrl+alt+u'),
            binding('editor.action.inlineSuggest.commit', 'tab', KeybindingScope.DEFAULT, 'inlineSuggestionVisible && !editorReadonly'),
            binding('editor.action.format', 'ctrl+shift+f'),
            binding('internal.hidden', 'ctrl+h')
        ], commands);
        expect(groupTitles(harness.host)).to.deep.equal(['Composer', 'Work Hub']);
        expect(registryRowLabels(harness.host)).to.deep.equal(['Chat: Maximize Chat', 'Qaap: Add selection to agent']);
        expect(rowLabels(harness.host)).to.include.members(['Send message', 'New line', 'Send in parallel', 'Interrupt agent', 'Select model', 'Previous prompt', 'Search transcript', 'Close']);
        expect(harness.host.textContent).to.not.contain('Accept Inline Suggestion');
        expect(harness.host.textContent).to.not.contain('Format Document');
        expect(harness.host.textContent).to.not.contain('Unlisted Qaap Command');
    });

    it('excludes disabled markers and the passthrough pseudo command', () => {
        const harness = createHarness([
            binding('-qaap.chat.maximize', 'ctrlcmd+alt+e'),
            binding('passthrough', 'ctrl+f'),
            binding('qaap.composer.addEditorSelection', 'ctrlcmd+shift+.')
        ], commands);
        expect(registryRowLabels(harness.host)).to.deep.equal(['Qaap: Add selection to agent']);
    });

    it('filters composer keys and Work Hub rows by the search query', () => {
        const harness = createHarness([
            binding('qaap.chat.maximize', 'ctrlcmd+alt+e'),
            binding('qaap.composer.addEditorSelection', 'ctrlcmd+shift+.'),
            binding('editor.action.format', 'ctrl+shift+f')
        ], commands);
        const search = harness.host.querySelector<HTMLInputElement>('.theia-mobile-work-hub-keybindings-search');
        expect(search).to.be.ok;
        search!.value = 'maximize';
        search!.dispatchEvent(inputEvent());
        expect(rowLabels(harness.host)).to.deep.equal(['Chat: Maximize Chat']);
        expect(groupTitles(harness.host)).to.deep.equal(['Work Hub']);

        search!.value = 'parallel';
        search!.dispatchEvent(inputEvent());
        expect(rowLabels(harness.host)).to.deep.equal(['Send in parallel']);
        expect(groupTitles(harness.host)).to.deep.equal(['Composer']);

        search!.value = 'format';
        search!.dispatchEvent(inputEvent());
        expect(harness.host.querySelector('.theia-mobile-work-hub-keybindings-empty')?.textContent).to.equal('No keybindings match your search.');
    });

    it('marks user bindings as Custom and resets them through the keymaps service', () => {
        const harness = createHarness([
            binding('qaap.chat.maximize', 'ctrl+alt+m', KeybindingScope.USER)
        ], commands);
        const badge = harness.host.querySelector('.theia-mobile-work-hub-keybindings-badge');
        expect(badge?.textContent).to.equal('Custom');
        const reset = harness.host.querySelector<HTMLButtonElement>('.theia-mobile-work-hub-keybindings-reset');
        expect(reset).to.be.ok;
        reset!.click();
        expect(harness.removed).to.deep.equal(['qaap.chat.maximize']);
    });

    it('shows a conflict hint against the whole keymap, not only the listed commands', () => {
        const harness = createHarness([
            binding('qaap.chat.maximize', 'ctrl+k'),
            binding('editor.action.format', 'ctrl+k'),
            binding('qaap.composer.addEditorSelection', 'ctrl+k', KeybindingScope.DEFAULT, 'editorFocus')
        ], commands);
        const conflicts = Array.from(harness.host.querySelectorAll('.theia-mobile-work-hub-keybindings-conflict')).map(node => node.textContent ?? '');
        expect(conflicts).to.deep.equal(['Conflicts with Format Document']);
    });

    it('starts recording on chip click, saves the captured keystroke on Enter and cancels on Escape', async () => {
        const harness = createHarness([
            binding('qaap.chat.maximize', 'ctrl+alt+e')
        ], commands);
        const chip = harness.host.querySelector<HTMLButtonElement>('.theia-mobile-work-hub-keybindings-chip');
        chip!.click();
        const recording = harness.host.querySelector<HTMLButtonElement>('.theia-mobile-work-hub-keybindings-recording');
        expect(recording).to.be.ok;
        recording!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(harness.host.querySelector('.theia-mobile-work-hub-keybindings-recording')).to.not.be.ok;
        expect(harness.saved).to.deep.equal([]);

        harness.host.querySelector<HTMLButtonElement>('.theia-mobile-work-hub-keybindings-chip')!.click();
        const second = harness.host.querySelector<HTMLButtonElement>('.theia-mobile-work-hub-keybindings-recording')!;
        second.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true }));
        second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await Promise.resolve();
        expect(harness.saved).to.have.length(1);
        expect(harness.saved[0].command).to.equal('qaap.chat.maximize');
        expect(harness.saved[0].keybinding).to.equal('ctrl+k');
    });

    it('re-renders when the registry reports a change and tears down on dispose', () => {
        const harness = createHarness([
            binding('qaap.chat.maximize', 'ctrl+alt+e')
        ], commands);
        const host = harness.host;
        expect(rowLabels(host)).to.include('Chat: Maximize Chat');
        harness.changed.fire(undefined);
        expect(rowLabels(host)).to.include('Chat: Maximize Chat');
        const disposable = harness.panel.render(document.createElement('div'));
        disposable.dispose();
    });

});
