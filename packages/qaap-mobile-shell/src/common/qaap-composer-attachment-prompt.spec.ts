// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    AIVariable,
    AIVariableResolutionRequest,
    ResolvedAIContextVariable,
} from '@theia/ai-core';
import { ImageContextVariable } from '@theia/ai-chat/lib/common/image-context-variable';
import {
    applyResolvedAttachmentsToPrompt,
    buildResolvedComposerAttachmentBlock,
    extractComposerAttachmentImagePaths,
    extractComposerAttachmentPreviewFeedbackTitles,
    resolveComposerContextAttachments,
    stripComposerAttachmentPreamble,
} from './qaap-composer-attachment-prompt';
import {
    buildEditorContextAttachmentRequest,
    buildEditorSelectionFingerprint,
    buildPinnedEditorContextResolvedVariable,
    type EditorSelectionSnapshot,
} from './qaap-composer-editor-context-bridge-core';

const FILE_VARIABLE_STUB: AIVariable = {
    id: 'file-provider',
    name: 'file',
    label: 'File',
    description: 'File',
};

const FILE_REQUEST: AIVariableResolutionRequest = {
    variable: FILE_VARIABLE_STUB,
    arg: 'src/index.ts',
};

const FILE_RESOLVED: ResolvedAIContextVariable = {
    ...FILE_REQUEST,
    value: 'src/index.ts',
    contextValue: 'export const answer = 42;',
};

const IMAGE_REQUEST = ImageContextVariable.createRequest({
    wsRelativePath: 'assets/logo.png',
    name: 'logo.png',
    data: 'aGVsbG8=',
    mimeType: 'image/png',
});

const IMAGE_RESOLVED: ResolvedAIContextVariable = {
    ...IMAGE_REQUEST,
    value: 'assets/logo.png',
    contextValue: 'assets/logo.png',
};

describe('qaap-composer-attachment-prompt', () => {

    it('resolveComposerContextAttachments prefers a pinned resolver over variableService', async () => {
        const snapshot: EditorSelectionSnapshot = {
            workspaceRelativePath: 'package.json',
            fileName: 'package.json',
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 3,
            endColumn: 22,
            hasSelection: true,
        };
        const request = {
            ...buildEditorContextAttachmentRequest(),
            arg: buildEditorSelectionFingerprint(snapshot),
        };
        const pinned = buildPinnedEditorContextResolvedVariable(request, snapshot, '{"name":"qaap"}');
        const variableService = {
            resolveVariable: async () => undefined,
        } as unknown as import('@theia/ai-core').AIVariableService;
        const resolved = await resolveComposerContextAttachments(
            [request],
            variableService,
            {},
            {
                resolvePinnedRequest: async () => pinned,
            },
        );
        expect(resolved).to.deep.equal([pinned]);
    });

    it('buildResolvedComposerAttachmentBlock formats file context with fenced content', () => {
        const block = buildResolvedComposerAttachmentBlock([FILE_RESOLVED]);
        expect(block).to.include('file: src/index.ts');
        expect(block).to.include('export const answer = 42;');
        expect(block).to.include('do not claim nothing was provided');
    });

    it('buildResolvedComposerAttachmentBlock describes workspace images by path', () => {
        const block = buildResolvedComposerAttachmentBlock([IMAGE_RESOLVED]);
        expect(block).to.include('imageContext: assets/logo.png');
        expect(block).to.include('Workspace image attached: assets/logo.png (image/png)');
    });

    it('applyResolvedAttachmentsToPrompt prepends attachments before the user draft', () => {
        const outbound = applyResolvedAttachmentsToPrompt('Fix the bug', [FILE_RESOLVED]);
        expect(outbound).to.match(/^The user attached the following context/);
        expect(outbound.endsWith('Fix the bug')).to.equal(true);
        expect(outbound).to.include('---');
    });

    it('extractComposerAttachmentImagePaths reads imageContext headers and workspace paths', () => {
        const outbound = applyResolvedAttachmentsToPrompt('Only svg', [IMAGE_RESOLVED]);
        expect(extractComposerAttachmentImagePaths(outbound)).to.deep.equal(['assets/logo.png']);
    });

    it('stripComposerAttachmentPreamble keeps only the typed draft', () => {
        const outbound = applyResolvedAttachmentsToPrompt('qwqq', [IMAGE_RESOLVED]);
        expect(stripComposerAttachmentPreamble(outbound)).to.equal('qwqq');
    });

    it('extractComposerAttachmentPreviewFeedbackTitles reads previewFeedback headers', () => {
        const feedback: ResolvedAIContextVariable = {
            variable: {
                id: 'previewFeedback',
                name: 'previewFeedback',
                label: 'PreviewFeedback',
                description: 'Confirmed preview annotations',
            },
            value: 'Preview feedback · 1 annotations · / · Desktop',
            contextValue: 'Annotation 1:\n- Comment: Darker',
        };
        const outbound = applyResolvedAttachmentsToPrompt('Please address the attached preview feedback.', [feedback]);
        expect(extractComposerAttachmentPreviewFeedbackTitles(outbound)).to.deep.equal([
            'Preview feedback · 1 annotations · / · Desktop',
        ]);
        expect(stripComposerAttachmentPreamble(outbound)).to.equal(
            'Please address the attached preview feedback.',
        );
    });

    it('applyResolvedAttachmentsToPrompt returns the draft unchanged when there is no attachment block', () => {
        const metaVariable: AIVariable = {
            id: 'contextDetails',
            name: 'contextDetails',
            description: 'meta',
        };
        const outbound = applyResolvedAttachmentsToPrompt('Only text', [{
            variable: metaVariable,
            value: '{}',
            contextValue: '{}',
        }]);
        expect(outbound).to.equal('Only text');
    });
});
