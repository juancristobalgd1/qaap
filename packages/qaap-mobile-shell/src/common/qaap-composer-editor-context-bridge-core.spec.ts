// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createComposerContextEntry } from './qaap-composer-context-entry';
import {
    buildEditorContextAttachmentRequest,
    buildEditorSelectionFingerprint,
    buildPinnedEditorContextResolvedVariable,
    extractSelectedTextFromDocument,
    findEditorContextEntryIndex,
    formatEditorContextChipTitle,
    isEditorSelectionFingerprint,
    parseEditorSelectionFingerprint,
    QAAP_EDITOR_CONTEXT_VARIABLE_NAME,
    shouldAutoPinEditorContext,
    shouldOfferEditorContextAttach,
    type EditorSelectionSnapshot,
} from './qaap-composer-editor-context-bridge-core';
import { applyResolvedAttachmentsToPrompt } from './qaap-composer-attachment-prompt';

describe('qaap-composer-editor-context-bridge-core', () => {

    const selectionSnapshot = (overrides?: Partial<EditorSelectionSnapshot>): EditorSelectionSnapshot => ({
        workspaceRelativePath: 'src/app.ts',
        fileName: 'app.ts',
        startLineNumber: 4,
        startColumn: 1,
        endLineNumber: 14,
        endColumn: 8,
        hasSelection: true,
        ...overrides,
    });

    it('buildEditorSelectionFingerprint changes when the selection range changes', () => {
        const first = buildEditorSelectionFingerprint(selectionSnapshot());
        const second = buildEditorSelectionFingerprint(selectionSnapshot({ endLineNumber: 15 }));
        expect(second).to.not.equal(first);
    });

    it('shouldAutoPinEditorContext requires desktop IDE mode and a non-empty selection', () => {
        const snapshot = selectionSnapshot();
        expect(shouldAutoPinEditorContext({
            preferDesktopIde: false,
            snapshot,
            userDismissedFingerprint: undefined,
        })).to.equal(false);
        expect(shouldAutoPinEditorContext({
            preferDesktopIde: true,
            snapshot: selectionSnapshot({ hasSelection: false }),
            userDismissedFingerprint: undefined,
        })).to.equal(false);
        expect(shouldAutoPinEditorContext({
            preferDesktopIde: true,
            snapshot,
            userDismissedFingerprint: undefined,
        })).to.equal(true);
    });

    it('shouldAutoPinEditorContext respects a user-dismissed fingerprint', () => {
        const snapshot = selectionSnapshot();
        const fingerprint = buildEditorSelectionFingerprint(snapshot);
        expect(shouldAutoPinEditorContext({
            preferDesktopIde: true,
            snapshot,
            userDismissedFingerprint: fingerprint,
        })).to.equal(false);
    });

    it('shouldOfferEditorContextAttach is enabled only in desktop IDE with an active editor', () => {
        expect(shouldOfferEditorContextAttach({ preferDesktopIde: true, hasActiveEditor: true })).to.equal(true);
        expect(shouldOfferEditorContextAttach({ preferDesktopIde: false, hasActiveEditor: true })).to.equal(false);
        expect(shouldOfferEditorContextAttach({ preferDesktopIde: true, hasActiveEditor: false })).to.equal(false);
    });

    it('buildEditorContextAttachmentRequest uses the editorContext variable name', () => {
        const request = buildEditorContextAttachmentRequest();
        expect(request.variable.name).to.equal(QAAP_EDITOR_CONTEXT_VARIABLE_NAME);
    });

    it('formatEditorContextChipTitle summarizes file and line range', () => {
        expect(formatEditorContextChipTitle(selectionSnapshot())).to.equal('app.ts:L4-L14');
        expect(formatEditorContextChipTitle(selectionSnapshot({
            startLineNumber: 9,
            endLineNumber: 9,
        }))).to.equal('app.ts:L9');
    });

    it('findEditorContextEntryIndex locates pinned editor context chips', () => {
        const entries = [
            createComposerContextEntry(buildEditorContextAttachmentRequest()),
            createComposerContextEntry({
                variable: { id: 'file', name: 'file', label: 'File', description: 'File' },
                arg: 'README.md',
            }),
        ];
        expect(findEditorContextEntryIndex(entries)).to.equal(0);
    });

    it('parseEditorSelectionFingerprint round-trips buildEditorSelectionFingerprint', () => {
        const snapshot = selectionSnapshot();
        const fingerprint = buildEditorSelectionFingerprint(snapshot);
        expect(isEditorSelectionFingerprint(fingerprint)).to.equal(true);
        expect(parseEditorSelectionFingerprint(fingerprint)).to.deep.equal(snapshot);
    });

    it('extractSelectedTextFromDocument reads a multi-line Monaco range', () => {
        const content = ['alpha', 'beta line', 'gamma'].join('\n');
        const selected = extractSelectedTextFromDocument(content, {
            startLineNumber: 1,
            startColumn: 3,
            endLineNumber: 3,
            endColumn: 3,
        });
        expect(selected).to.equal(['pha', 'beta line', 'ga'].join('\n'));
    });

    it('buildPinnedEditorContextResolvedVariable produces an editorContext block', () => {
        const snapshot = selectionSnapshot();
        const request = {
            ...buildEditorContextAttachmentRequest(),
            arg: buildEditorSelectionFingerprint(snapshot),
        };
        const resolved = buildPinnedEditorContextResolvedVariable(request, snapshot, 'const x = 1;');
        const prompt = applyResolvedAttachmentsToPrompt('Resume this selection briefly', [resolved]);
        expect(prompt).to.contain('### editorContext:');
        expect(prompt).to.contain('"text": "const x = 1;"');
    });

    it('pinned editorContext fingerprint travels in submit without a live Monaco editor', () => {
        const snapshot = selectionSnapshot();
        const request = {
            ...buildEditorContextAttachmentRequest(),
            arg: buildEditorSelectionFingerprint(snapshot),
        };
        expect(isEditorSelectionFingerprint(request.arg)).to.equal(true);
        const resolved = buildPinnedEditorContextResolvedVariable(request, snapshot, 'const pinned = true;');
        const prompt = applyResolvedAttachmentsToPrompt('Continue from this selection', [resolved]);
        expect(prompt).to.contain('### editorContext:');
        expect(prompt).to.contain('src/app.ts');
        expect(prompt).to.contain('"text": "const pinned = true;"');
        expect(prompt.endsWith('Continue from this selection')).to.equal(true);
    });

    it('applyResolvedAttachmentsToPrompt includes an editorContext block', () => {
        const prompt = applyResolvedAttachmentsToPrompt('Fix this selection', [{
            variable: {
                id: QAAP_EDITOR_CONTEXT_VARIABLE_NAME,
                name: QAAP_EDITOR_CONTEXT_VARIABLE_NAME,
                label: 'EditorContext',
                description: 'Editor selection',
            },
            value: 'app.ts L4-L14',
            contextValue: '{"file":{"uri":"src/app.ts"}}',
        }]);
        expect(prompt).to.contain('### editorContext:');
        expect(prompt).to.contain('Fix this selection');
    });
});
