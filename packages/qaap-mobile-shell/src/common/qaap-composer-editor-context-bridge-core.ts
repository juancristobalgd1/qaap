// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { AIVariable, AIVariableResolutionRequest, ResolvedAIContextVariable } from '@theia/ai-core';
import type { StickyComposerContextEntry } from './qaap-composer-context-entry';

/** Keep in sync with `@theia/ai-editor` `EDITOR_CONTEXT_VARIABLE.name`. */
export const QAAP_EDITOR_CONTEXT_VARIABLE_NAME = 'editorContext';

export interface EditorSelectionSnapshot {
    readonly workspaceRelativePath: string;
    readonly fileName: string;
    readonly startLineNumber: number;
    readonly startColumn: number;
    readonly endLineNumber: number;
    readonly endColumn: number;
    readonly hasSelection: boolean;
}

export function buildEditorSelectionFingerprint(snapshot: EditorSelectionSnapshot): string {
    return [
        snapshot.workspaceRelativePath || snapshot.fileName,
        snapshot.startLineNumber,
        snapshot.startColumn,
        snapshot.endLineNumber,
        snapshot.endColumn,
    ].join(':');
}

export function buildEditorContextAttachmentRequest(
    variable?: Pick<AIVariable, 'id' | 'name' | 'label' | 'description' | 'iconClasses'>,
): AIVariableResolutionRequest {
    return {
        variable: variable ?? {
            id: QAAP_EDITOR_CONTEXT_VARIABLE_NAME,
            name: QAAP_EDITOR_CONTEXT_VARIABLE_NAME,
            label: 'EditorContext',
            description: 'Editor selection and file context',
        },
    };
}

export function formatEditorContextChipTitle(snapshot: EditorSelectionSnapshot): string {
    const fileLabel = snapshot.fileName || snapshot.workspaceRelativePath || 'Editor';
    if (!snapshot.hasSelection) {
        return fileLabel;
    }
    if (snapshot.startLineNumber === snapshot.endLineNumber) {
        return `${fileLabel}:L${snapshot.startLineNumber}`;
    }
    return `${fileLabel}:L${snapshot.startLineNumber}-L${snapshot.endLineNumber}`;
}

export function shouldAutoPinEditorContext(options: {
    readonly preferDesktopIde: boolean;
    readonly snapshot: EditorSelectionSnapshot | undefined;
    readonly userDismissedFingerprint: string | undefined;
}): boolean {
    if (!options.preferDesktopIde || !options.snapshot?.hasSelection) {
        return false;
    }
    const fingerprint = buildEditorSelectionFingerprint(options.snapshot);
    return fingerprint !== options.userDismissedFingerprint;
}

export function shouldOfferEditorContextAttach(options: {
    readonly preferDesktopIde: boolean;
    readonly hasActiveEditor: boolean;
}): boolean {
    return options.preferDesktopIde && options.hasActiveEditor;
}

export function isEditorContextEntry(entry: StickyComposerContextEntry): boolean {
    return entry.request.variable.name === QAAP_EDITOR_CONTEXT_VARIABLE_NAME;
}

export function findEditorContextEntryIndex(entries: readonly StickyComposerContextEntry[]): number {
    return entries.findIndex(isEditorContextEntry);
}

/** True when `arg` encodes a pinned editor selection (`path:startLine:startCol:endLine:endCol`). */
export function isEditorSelectionFingerprint(arg: string | undefined): boolean {
    return !!parseEditorSelectionFingerprint(arg);
}

/** Parses a pinned editor selection fingerprint produced by {@link buildEditorSelectionFingerprint}. */
export function parseEditorSelectionFingerprint(arg: string | undefined): EditorSelectionSnapshot | undefined {
    const raw = arg?.trim();
    if (!raw) {
        return undefined;
    }
    const parts = raw.split(':');
    if (parts.length < 5) {
        return undefined;
    }
    const endColumn = Number(parts[parts.length - 1]);
    const endLineNumber = Number(parts[parts.length - 2]);
    const startColumn = Number(parts[parts.length - 3]);
    const startLineNumber = Number(parts[parts.length - 4]);
    if (![startLineNumber, startColumn, endLineNumber, endColumn].every(n => Number.isInteger(n) && n > 0)) {
        return undefined;
    }
    const workspaceRelativePath = parts.slice(0, parts.length - 4).join(':');
    if (!workspaceRelativePath) {
        return undefined;
    }
    const fileName = workspaceRelativePath.split('/').pop() ?? workspaceRelativePath;
    return {
        workspaceRelativePath,
        fileName,
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn,
        hasSelection: true,
    };
}

/** Extracts the pinned line range from a workspace file snapshot (1-based Monaco coordinates). */
export function extractSelectedTextFromDocument(
    content: string,
    snapshot: Pick<EditorSelectionSnapshot, 'startLineNumber' | 'startColumn' | 'endLineNumber' | 'endColumn'>,
): string {
    const lines = content.split(/\r?\n/);
    const { startLineNumber, startColumn, endLineNumber, endColumn } = snapshot;
    if (startLineNumber === endLineNumber) {
        const line = lines[startLineNumber - 1] ?? '';
        return line.slice(startColumn - 1, endColumn - 1);
    }
    const parts: string[] = [];
    for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
        const line = lines[lineNumber - 1] ?? '';
        if (lineNumber === startLineNumber) {
            parts.push(line.slice(startColumn - 1));
        } else if (lineNumber === endLineNumber) {
            parts.push(line.slice(0, endColumn - 1));
        } else {
            parts.push(line);
        }
    }
    return parts.join('\n');
}

export function inferEditorContextLanguageId(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'ts':
        case 'tsx':
            return 'typescript';
        case 'js':
        case 'jsx':
            return 'javascript';
        case 'json':
            return 'json';
        case 'md':
            return 'markdown';
        case 'css':
            return 'css';
        case 'html':
            return 'html';
        default:
            return 'plaintext';
    }
}

/** Builds the same JSON payload shape as `@theia/ai-editor` `EditorContextVariableContribution`. */
export function buildPinnedEditorContextPayload(
    snapshot: EditorSelectionSnapshot,
    selectedText: string,
    languageId?: string,
): Record<string, unknown> {
    const lang = languageId ?? inferEditorContextLanguageId(snapshot.fileName || snapshot.workspaceRelativePath);
    const lineContent = selectedText.split('\n')[0] ?? '';
    return {
        file: {
            uri: snapshot.workspaceRelativePath,
            languageId: lang,
            fileName: snapshot.fileName || snapshot.workspaceRelativePath,
        },
        selection: {
            text: selectedText,
            isEmpty: !selectedText.trim(),
            startLineNumber: snapshot.startLineNumber,
            startColumn: snapshot.startColumn,
            endLineNumber: snapshot.endLineNumber,
            endColumn: snapshot.endColumn,
        },
        position: {
            lineNumber: snapshot.startLineNumber,
            column: snapshot.startColumn,
            lineContent,
        },
        diagnostics: {
            errorCount: 0,
            warningCount: 0,
            infoCount: 0,
            hintCount: 0,
            totalIssues: 0,
        },
    };
}

export function buildPinnedEditorContextResolvedVariable(
    request: AIVariableResolutionRequest,
    snapshot: EditorSelectionSnapshot,
    selectedText: string,
    languageId?: string,
): ResolvedAIContextVariable {
    const contextValue = JSON.stringify(
        buildPinnedEditorContextPayload(snapshot, selectedText, languageId),
        undefined,
        2,
    );
    const label = formatEditorContextChipTitle(snapshot);
    return {
        variable: request.variable,
        arg: request.arg,
        value: label,
        contextValue,
    };
}
