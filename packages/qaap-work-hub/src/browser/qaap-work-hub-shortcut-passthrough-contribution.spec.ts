// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { Keybinding } from '@theia/core/lib/common/keybinding';
import type { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import {
    isQaapWorkHubKeybindingCommand,
    QAAP_WORK_HUB_ADD_EDITOR_SELECTION_COMMAND_ID,
    QAAP_WORK_HUB_KEYBINDING_COMMANDS,
} from './qaap-work-hub-keybinding-allowlist';
import { QAAP_MAXIMIZE_CHAT_COMMAND_ID } from './qaap-watermark-entries';
import {
    QAAP_MODEL_PICKER_FOCUS_CONTEXT,
    QAAP_TRANSCRIPT_SEARCH_FOCUS_CONTEXT,
    QaapComposerModelPickerFocusKeybindingContext,
    QaapTranscriptSearchFocusKeybindingContext,
    QaapWorkHubShortcutFocus,
    QaapWorkHubShortcutPassthroughContribution,
} from './qaap-work-hub-shortcut-passthrough-contribution';

disableImportJSDOM();

describe('Work Hub keybinding allowlist', () => {

    it('lists exactly the Work Hub registry commands', () => {
        expect([...QAAP_WORK_HUB_KEYBINDING_COMMANDS]).to.deep.equal([QAAP_MAXIMIZE_CHAT_COMMAND_ID, QAAP_WORK_HUB_ADD_EDITOR_SELECTION_COMMAND_ID]);
        expect(isQaapWorkHubKeybindingCommand('qaap.chat.maximize')).to.equal(true);
        expect(isQaapWorkHubKeybindingCommand('qaap.composer.addEditorSelection')).to.equal(true);
    });

    it('leaves IDE and unlisted Qaap commands out', () => {
        for (const id of ['editor.action.inlineSuggest.commit', 'core.find', 'workbench.action.focusFirstEditorGroup', 'qaap.something.else', 'passthrough', '']) {
            expect(isQaapWorkHubKeybindingCommand(id), id).to.equal(false);
        }
    });
});

describe('QaapWorkHubShortcutPassthroughContribution', () => {

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

    it('registers passthrough bindings for Cmd/Ctrl+F and Cmd/Ctrl+1..9, each scoped to its focus context', () => {
        const registered: Keybinding[] = [];
        new QaapWorkHubShortcutPassthroughContribution().registerKeybindings({
            registerKeybinding: (binding: Keybinding) => { registered.push(binding); },
        } as unknown as KeybindingRegistry);
        expect(registered.every(binding => binding.command === 'passthrough')).to.equal(true);
        expect(registered[0]).to.deep.include({ keybinding: 'ctrlcmd+f', context: QAAP_TRANSCRIPT_SEARCH_FOCUS_CONTEXT });
        expect(registered.slice(1).map(binding => binding.keybinding)).to.deep.equal(['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => `ctrlcmd+${digit}`));
        expect(registered.slice(1).every(binding => binding.context === QAAP_MODEL_PICKER_FOCUS_CONTEXT)).to.equal(true);
    });

    it('lets Cmd/Ctrl+F through only while focus is inside the transcript search host', () => {
        const mountHost = document.createElement('div');
        const scroller = document.createElement('div');
        scroller.tabIndex = 0;
        const message = document.createElement('p');
        scroller.appendChild(message);
        const search = document.createElement('form');
        search.className = 'theia-mobile-agent-transcript-search';
        mountHost.append(scroller, search);
        const elsewhere = document.createElement('textarea');
        document.body.append(mountHost, elsewhere);

        expect(QaapWorkHubShortcutFocus.isInTranscriptSearchHost(message)).to.equal(true);
        expect(QaapWorkHubShortcutFocus.isInTranscriptSearchHost(mountHost)).to.equal(true);
        expect(QaapWorkHubShortcutFocus.isInTranscriptSearchHost(elsewhere)).to.equal(false);
        expect(QaapWorkHubShortcutFocus.isInTranscriptSearchHost(undefined)).to.equal(false);

        const context = new QaapTranscriptSearchFocusKeybindingContext();
        scroller.focus();
        expect(context.isEnabled()).to.equal(true);
        elsewhere.focus();
        expect(context.isEnabled()).to.equal(false);
    });

    it('lets Cmd/Ctrl+1..9 through only while focus is inside the model picker', () => {
        const picker = document.createElement('div');
        picker.className = 'qaap-model-picker';
        const input = document.createElement('input');
        picker.appendChild(input);
        const outside = document.createElement('input');
        document.body.append(picker, outside);

        const context = new QaapComposerModelPickerFocusKeybindingContext();
        input.focus();
        expect(context.isEnabled()).to.equal(true);
        outside.focus();
        expect(context.isEnabled()).to.equal(false);
    });
});
