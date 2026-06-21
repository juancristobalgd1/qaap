// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AIVariableResolutionRequest, ResolvedAIContextVariable } from '@theia/ai-core';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    buildPinnedEditorContextResolvedVariable,
    extractSelectedTextFromDocument,
    isEditorSelectionFingerprint,
    parseEditorSelectionFingerprint,
    QAAP_EDITOR_CONTEXT_VARIABLE_NAME,
} from '../common/qaap-composer-editor-context-bridge-core';
import { resolveTranscriptWorkspaceFileUri } from './qaap-transcript-file-open';

export async function resolvePinnedEditorContextVariable(
    request: AIVariableResolutionRequest,
    workspaceService: WorkspaceService,
    fileService: FileService,
): Promise<ResolvedAIContextVariable | undefined> {
    if (request.variable.name !== QAAP_EDITOR_CONTEXT_VARIABLE_NAME || !isEditorSelectionFingerprint(request.arg)) {
        return undefined;
    }
    const snapshot = parseEditorSelectionFingerprint(request.arg);
    if (!snapshot) {
        return undefined;
    }
    try {
        const uri = resolveTranscriptWorkspaceFileUri(snapshot.workspaceRelativePath, workspaceService);
        const file = await fileService.readFile(uri);
        const content = file.value.toString();
        const selectedText = extractSelectedTextFromDocument(content, snapshot);
        if (!selectedText.trim()) {
            return undefined;
        }
        return buildPinnedEditorContextResolvedVariable(request, snapshot, selectedText);
    } catch {
        return undefined;
    }
}