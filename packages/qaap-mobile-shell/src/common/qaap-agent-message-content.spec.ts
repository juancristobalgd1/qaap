// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    normalizeAgentMessageContentForDisplay,
    resolveMessagePreviewText,
    resolveOptimisticPendingUserDisplayText,
    resolveTranscriptUserMessageView,
} from './qaap-agent-message-content';
import { applyResolvedAttachmentsToPrompt } from './qaap-composer-attachment-prompt';
import { createComposerSkillDisplayMarker } from './qaap-composer-skill-display';
import { createComposerGitActionDisplayMarker } from './qaap-composer-git-action-display';
import { ImageContextVariable } from '@theia/ai-chat/lib/common/image-context-variable';
import type { ResolvedAIContextVariable } from '@theia/ai-core';

describe('normalizeAgentMessageContentForDisplay', () => {
    it('extracts text from Responses-style user messages', () => {
        const raw = JSON.stringify({
            role: 'user',
            content: [
                { type: 'input_text', text: 'Fix the mobile chat rendering.' },
            ],
        });

        expect(normalizeAgentMessageContentForDisplay(raw)).to.equal('Fix the mobile chat rendering.');
    });

    it('extracts output text from assistant message envelopes', () => {
        const raw = JSON.stringify({
            type: 'message',
            role: 'assistant',
            content: [
                { type: 'output_text', text: 'Done.\n\n- Updated chat display' },
            ],
        });

        expect(normalizeAgentMessageContentForDisplay(raw)).to.equal('Done.\n\n- Updated chat display');
    });

    it('joins multiple text blocks without exposing JSON syntax', () => {
        const raw = JSON.stringify({
            role: 'assistant',
            content: [
                { type: 'text', text: 'First' },
                { type: 'output_text', text: 'Second' },
            ],
        });

        expect(normalizeAgentMessageContentForDisplay(raw)).to.equal('First\n\nSecond');
    });

    it('leaves ordinary text and arbitrary JSON unchanged', () => {
        expect(normalizeAgentMessageContentForDisplay('plain **markdown**')).to.equal('plain **markdown**');
        expect(normalizeAgentMessageContentForDisplay('{"command":"npm test"}')).to.equal('{"command":"npm test"}');
    });

    it('hides QAIQ system init metadata envelopes', () => {
        const raw = JSON.stringify({
            type: 'system',
            subtype: 'init',
            cwd: '/tmp',
            session_id: 'abc',
            model: 'moonshotai/kimi-k2.6:free',
            tools: ['Bash', 'Read'],
        });
        expect(normalizeAgentMessageContentForDisplay(raw)).to.equal('');
    });

    it('hides QAIQ stream_event process logs with no assistant text', () => {
        const raw = [
            '{"type":"stream_event","event":{"type":"message_start","message":{"role":"assistant","content":[]}}}',
            '{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"}}}',
            '{"type":"result","subtype":"success","is_error":false,"result":""}',
        ].join(' ');
        expect(normalizeAgentMessageContentForDisplay(raw)).to.equal('');
    });

    it('treats missing content as empty text', () => {
        expect(normalizeAgentMessageContentForDisplay(undefined)).to.equal('');
        expect(normalizeAgentMessageContentForDisplay(null)).to.equal('');
    });
});

describe('resolveMessagePreviewText', () => {
    it('falls back to the last text segment when content is a placeholder', () => {
        expect(resolveMessagePreviewText({
            content: '…',
            segments: [{ type: 'text', content: 'Streaming answer' }],
        })).to.equal('Streaming answer');
    });

    it('does not throw when content is undefined', () => {
        expect(resolveMessagePreviewText({
            segments: [{ type: 'thinking', content: 'plan' }],
        })).to.equal('');
    });
});

describe('resolveOptimisticPendingUserDisplayText', () => {
    const imageResolved: ResolvedAIContextVariable = {
        ...ImageContextVariable.createRequest({
            wsRelativePath: 'assets/logo.png',
            name: 'logo.png',
            data: 'aGVsbG8=',
            mimeType: 'image/png',
        }),
        value: 'assets/logo.png',
        contextValue: 'assets/logo.png',
    };

    it('shows only the typed draft when attachment preamble is present', () => {
        const content = applyResolvedAttachmentsToPrompt('Describe this screenshot', [imageResolved]);
        expect(resolveOptimisticPendingUserDisplayText({
            id: 'pending-user-1',
            optimisticImagePreviews: [{ src: 'data:image/png;base64,eA==', fileName: 'logo.png' }],
            content,
        })).to.equal('Describe this screenshot');
    });

    it('returns empty text for image-only optimistic submits', () => {
        const content = applyResolvedAttachmentsToPrompt('', [imageResolved]);
        expect(resolveOptimisticPendingUserDisplayText({
            id: 'pending-user-1',
            optimisticImagePreviews: [{ src: 'data:image/png;base64,eA==', fileName: 'logo.png' }],
            content,
        })).to.equal('');
    });
});

describe('resolveTranscriptUserMessageView', () => {
    const imageResolved: ResolvedAIContextVariable = {
        ...ImageContextVariable.createRequest({
            wsRelativePath: 'huggingface-color.svg',
            name: 'huggingface-color.svg',
            data: 'aGVsbG8=',
            mimeType: 'image/svg+xml',
        }),
        value: 'huggingface-color.svg',
        contextValue: 'huggingface-color.svg',
    };

    it('parses persisted attachment preamble into preview cards and typed draft', () => {
        const content = applyResolvedAttachmentsToPrompt('qwqq', [imageResolved]);
        expect(resolveTranscriptUserMessageView({ content })).to.deep.equal({
            displayText: 'qwqq',
            imagePreviews: [{
                src: '',
                fileName: 'huggingface-color.svg',
                wsRelativePath: 'huggingface-color.svg',
            }],
        });
    });

    it('returns image-only view when the persisted row has no typed draft', () => {
        const content = applyResolvedAttachmentsToPrompt('', [imageResolved]);
        expect(resolveTranscriptUserMessageView({ content })).to.deep.equal({
            displayText: '',
            imagePreviews: [{
                src: '',
                fileName: 'huggingface-color.svg',
                wsRelativePath: 'huggingface-color.svg',
            }],
        });
    });

    it('compacts expanded skill prompts to a slash pill display text', () => {
        const content = [
            createComposerSkillDisplayMarker({
                skillName: 'loop',
                userText: 'mejora de rendimiento',
            }),
            'Follow the "loop" skill. Skill instructions:',
            '',
            '# Long skill markdown',
            '',
            'Do many internal things.',
            '',
            'mejora de rendimiento',
        ].join('\n');
        expect(resolveTranscriptUserMessageView({ content })).to.deep.equal({
            displayText: '/loop mejora de rendimiento',
            imagePreviews: [],
            skillInvocation: {
                skillName: 'loop',
                prefix: undefined,
                userText: 'mejora de rendimiento',
            },
        });
    });

    it('renders git workflow markers as transcript git-action pills', () => {
        const content = createComposerGitActionDisplayMarker({
            action: 'commit-push',
            label: 'Commit & Push',
            branch: 'main',
            status: 'completed',
            insertions: 3,
            deletions: 1,
        });
        expect(resolveTranscriptUserMessageView({ content })).to.deep.equal({
            displayText: 'Commit & Push',
            imagePreviews: [],
            gitActionInvocation: {
                action: 'commit-push',
                label: 'Commit & Push',
                branch: 'main',
                status: 'completed',
                insertions: 3,
                deletions: 1,
            },
        });
    });
});
