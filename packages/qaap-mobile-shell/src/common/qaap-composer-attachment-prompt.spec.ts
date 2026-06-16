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
} from './qaap-composer-attachment-prompt';

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
