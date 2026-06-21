// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';
import { AIVariableResolutionRequest, AIVariableService } from '@theia/ai-core';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoEditorProvider } from '@theia/monaco/lib/browser/monaco-editor-provider';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    createComposerContextEntry,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import {
    buildEditorContextAttachmentRequest,
    buildEditorSelectionFingerprint,
    findEditorContextEntryIndex,
    formatEditorContextChipTitle,
    isEditorContextEntry,
    QAAP_EDITOR_CONTEXT_VARIABLE_NAME,
    shouldAutoPinEditorContext,
    shouldOfferEditorContextAttach,
    type EditorSelectionSnapshot,
} from '../common/qaap-composer-editor-context-bridge-core';
import { peekPreferDesktopIde } from './mobile-projects-open';

export type ComposerEditorContextTarget = 'transcript' | 'sticky';

export interface QaapComposerEditorContextPanelDelegate {
    resolveActiveComposerContextTarget(): ComposerEditorContextTarget;
    getComposerContextEntries(target: ComposerEditorContextTarget): StickyComposerContextEntry[];
    upsertEditorContextEntry(target: ComposerEditorContextTarget, entry: StickyComposerContextEntry): void;
    notifyEditorContextRemoved(entry: StickyComposerContextEntry): void;
    refreshComposerAfterContextPin(target: ComposerEditorContextTarget): void;
    focusComposerInput(target: ComposerEditorContextTarget): void;
}

@injectable()
export class QaapComposerEditorContextService implements Disposable {

    @inject(MonacoEditorProvider)
    protected readonly monacoEditorProvider: MonacoEditorProvider;

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(AIVariableService)
    protected readonly variableService: AIVariableService;

    protected readonly toDispose = new DisposableCollection();
    protected panelDelegate: QaapComposerEditorContextPanelDelegate | undefined;
    protected userDismissedFingerprint: string | undefined;
    protected lastAutoPinFingerprint: string | undefined;
    protected pendingEntry: StickyComposerContextEntry | undefined;
    protected autoPinTimer: number | undefined;
    protected selectionDispose = new DisposableCollection();

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.editorManager.onCurrentEditorChanged(editor => {
            this.selectionDispose.dispose();
            this.selectionDispose = new DisposableCollection();
            if (editor) {
                this.attachSelectionListener(editor);
            }
            this.scheduleAutoPinFromActiveEditor();
        }));
        const current = this.editorManager.currentEditor;
        if (current) {
            this.attachSelectionListener(current);
        }
    }

    dispose(): void {
        if (this.autoPinTimer !== undefined) {
            window.clearTimeout(this.autoPinTimer);
            this.autoPinTimer = undefined;
        }
        this.selectionDispose.dispose();
        this.toDispose.dispose();
        this.panelDelegate = undefined;
    }

    registerPanelDelegate(delegate: QaapComposerEditorContextPanelDelegate | undefined): void {
        this.panelDelegate = delegate;
        if (delegate && this.pendingEntry) {
            this.applyPin(this.pendingEntry);
            this.pendingEntry = undefined;
        }
    }

    shouldOfferManualEditorContextAttach(): boolean {
        return shouldOfferEditorContextAttach({
            preferDesktopIde: peekPreferDesktopIde(),
            hasActiveEditor: this.hasActiveEditor(),
        });
    }

    hasActiveEditor(): boolean {
        return !!this.resolveActiveMonacoEditor();
    }

    hasActiveEditorSelection(): boolean {
        return !!this.readActiveEditorSnapshot()?.hasSelection;
    }

    resolveActiveEditorContextRequest(): AIVariableResolutionRequest | undefined {
        if (!this.hasActiveEditor()) {
            return undefined;
        }
        return buildEditorContextAttachmentRequest(this.resolveEditorContextVariable());
    }

    pinEditorSelection(options?: { readonly focusComposer?: boolean }): boolean {
        const snapshot = this.readActiveEditorSnapshot();
        if (!snapshot) {
            return false;
        }
        const entry = this.buildEditorContextEntry(snapshot);
        this.userDismissedFingerprint = undefined;
        this.lastAutoPinFingerprint = buildEditorSelectionFingerprint(snapshot);
        const applied = this.applyPin(entry);
        if (applied && options?.focusComposer) {
            this.panelDelegate?.focusComposerInput(this.resolvePinTarget());
        }
        return applied;
    }

    notifyEditorContextRemoved(entry: StickyComposerContextEntry): void {
        if (!isEditorContextEntry(entry)) {
            return;
        }
        const fingerprint = entry.request.arg?.trim();
        if (fingerprint) {
            this.userDismissedFingerprint = fingerprint;
        }
        if (this.lastAutoPinFingerprint === fingerprint) {
            this.lastAutoPinFingerprint = undefined;
        }
    }

    protected attachSelectionListener(editorWidget: EditorWidget): void {
        const editor = editorWidget.editor;
        if (!(editor instanceof MonacoEditor)) {
            return;
        }
        this.selectionDispose.push(editor.getControl().onDidChangeCursorSelection(() => {
            this.scheduleAutoPinFromActiveEditor();
        }));
    }

    protected scheduleAutoPinFromActiveEditor(): void {
        if (this.autoPinTimer !== undefined) {
            window.clearTimeout(this.autoPinTimer);
        }
        this.autoPinTimer = window.setTimeout(() => {
            this.autoPinTimer = undefined;
            this.tryAutoPinFromActiveEditor();
        }, 150);
    }

    protected tryAutoPinFromActiveEditor(): void {
        const snapshot = this.readActiveEditorSnapshot();
        if (!shouldAutoPinEditorContext({
            preferDesktopIde: peekPreferDesktopIde(),
            snapshot,
            userDismissedFingerprint: this.userDismissedFingerprint,
        })) {
            return;
        }
        const fingerprint = buildEditorSelectionFingerprint(snapshot!);
        if (fingerprint === this.lastAutoPinFingerprint) {
            return;
        }
        const entry = this.buildEditorContextEntry(snapshot!);
        if (this.applyPin(entry)) {
            this.lastAutoPinFingerprint = fingerprint;
        }
    }

    protected buildEditorContextEntry(snapshot: EditorSelectionSnapshot): StickyComposerContextEntry {
        const entry = createComposerContextEntry(buildEditorContextAttachmentRequest(this.resolveEditorContextVariable()));
        entry.displayName = formatEditorContextChipTitle(snapshot);
        entry.request = {
            ...entry.request,
            arg: buildEditorSelectionFingerprint(snapshot),
        };
        return entry;
    }

    protected applyPin(entry: StickyComposerContextEntry): boolean {
        const delegate = this.panelDelegate;
        if (!delegate) {
            this.pendingEntry = entry;
            return true;
        }
        const target = delegate.resolveActiveComposerContextTarget();
        const entries = delegate.getComposerContextEntries(target);
        const existingIndex = findEditorContextEntryIndex(entries);
        if (existingIndex >= 0 && entries[existingIndex].request.arg === entry.request.arg) {
            return true;
        }
        delegate.upsertEditorContextEntry(target, entry);
        delegate.refreshComposerAfterContextPin(target);
        return true;
    }

    protected resolvePinTarget(): ComposerEditorContextTarget {
        return this.panelDelegate?.resolveActiveComposerContextTarget() ?? 'sticky';
    }

    protected resolveEditorContextVariable(): AIVariableResolutionRequest['variable'] | undefined {
        return this.variableService.getContextVariables().find(variable => variable.name === QAAP_EDITOR_CONTEXT_VARIABLE_NAME)
            ?? buildEditorContextAttachmentRequest().variable;
    }

    protected resolveActiveMonacoEditor(): MonacoEditor | undefined {
        const current = this.monacoEditorProvider.current;
        if (current) {
            return current;
        }
        const widgetEditor = this.editorManager.currentEditor?.editor;
        return widgetEditor instanceof MonacoEditor ? widgetEditor : undefined;
    }

    protected readActiveEditorSnapshot(): EditorSelectionSnapshot | undefined {
        const editor = this.resolveActiveMonacoEditor();
        if (!editor) {
            return undefined;
        }
        const model = editor.getControl().getModel();
        const selection = editor.getControl().getSelection();
        if (!model || !selection) {
            return undefined;
        }
        const uri = editor.getResourceUri();
        const selectedText = model.getValueInRange(selection);
        const workspaceRelativePath = uri ? this.resolveWorkspaceRelativePath(uri) : '';
        return {
            workspaceRelativePath,
            fileName: uri?.path.base ?? '',
            startLineNumber: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLineNumber: selection.endLineNumber,
            endColumn: selection.endColumn,
            hasSelection: !selection.isEmpty() && !!selectedText.trim(),
        };
    }

    protected resolveWorkspaceRelativePath(uri: URI): string {
        for (const root of this.workspaceService.tryGetRoots()) {
            const relative = root.resource.path.relative(uri.path);
            if (relative && !relative.toString().startsWith('..')) {
                return relative.toString();
            }
        }
        return uri.path.base;
    }
}
