// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { normalizeAgentMessageContentForDisplay, resolveMessagePreviewText, resolveTranscriptUserMessageView, stripQaapControlMarkersForDisplay } from './qaap-agent-message-content';
import { stripQaapPreviewCacheBustParam } from './qaap-preview-feedback-transcript';
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

    it('strips @@QAAP:BLOCKED@@ sentinels and keeps a meaningful need', () => {
        const raw = [
            'I cannot finish without a choice.',
            '@@QAAP:BLOCKED@@ Which database should the export use?',
        ].join('\n');
        expect(normalizeAgentMessageContentForDisplay(raw)).to.equal(
            'I cannot finish without a choice.\nWhich database should the export use?',
        );
    });

    it('drops garbage blocked needs and bare markers', () => {
        expect(normalizeAgentMessageContentForDisplay('@@QAAP:BLOCKED@@ knj')).to.equal('');
        expect(normalizeAgentMessageContentForDisplay('Stuck.\n@@QAAP:BLOCKED@@')).to.equal('Stuck.');
        expect(stripQaapControlMarkersForDisplay('Verdict @@QAAP:VERDICT@@ pass ok')).to.equal('Verdict pass ok');
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
            contextChips: [],
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
            contextChips: [],
        });
    });

    it('surfaces preview-feedback attachments as context chips and strips the agent preamble', () => {
        const feedbackResolved: ResolvedAIContextVariable = {
            variable: {
                id: 'previewFeedback',
                name: 'previewFeedback',
                label: 'PreviewFeedback',
                description: 'Confirmed preview annotations',
            },
            arg: JSON.stringify({
                k: 'previewFeedback|ws|t1|url|/home|a1',
                b: 'Preview feedback annotations\n\nAnnotation 1:\n- Comment: Move button',
                t: 'Preview feedback · 1 annotations · /home · Mobile',
            }),
            value: 'Preview feedback · 1 annotations · /home · Mobile',
            contextValue: 'Preview feedback annotations\n\nAnnotation 1:\n- Comment: Move button',
        };
        const content = applyResolvedAttachmentsToPrompt(
            'Please address the attached preview feedback.',
            [feedbackResolved],
        );
        expect(resolveTranscriptUserMessageView({ content })).to.deep.equal({
            displayText: 'Please address the attached preview feedback.',
            imagePreviews: [],
            contextChips: [{
                title: 'Preview feedback · 1 annotations · /home · Mobile',
                kind: 'previewFeedback',
                iconClasses: 'codicon codicon-comment',
                annotations: [{ index: 1, comment: 'Move button' }],
            }],
        });
    });

    it('parses full annotation details into the preview-feedback context chip', () => {
        const body = [
            'Preview feedback annotations (compact context — not full DOM):',
            '',
            'Annotation 1:',
            '- Comment: Align the icon',
            '- Route: /settings',
            '- Viewport: desktop 1280x800',
            '- Selector: header .icon',
            '- Element: <svg>',
            '- Source: src/header.tsx:10',
        ].join('\n');
        const feedbackResolved: ResolvedAIContextVariable = {
            variable: {
                id: 'previewFeedback',
                name: 'previewFeedback',
                label: 'PreviewFeedback',
                description: 'Confirmed preview annotations',
            },
            value: 'Preview feedback · 1 annotations · /settings · Desktop',
            contextValue: body,
        };
        const content = applyResolvedAttachmentsToPrompt('Fix it.', [feedbackResolved]);
        const view = resolveTranscriptUserMessageView({ content });
        expect(view.contextChips).to.have.length(1);
        const chip = view.contextChips[0]!;
        expect(chip.annotations).to.deep.equal([{
            index: 1,
            comment: 'Align the icon',
            route: '/settings',
            viewport: 'desktop 1280x800',
            selector: 'header .icon',
            elementTag: 'svg',
            source: 'src/header.tsx:10',
        }]);
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
            contextChips: [],
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
            contextChips: [],
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

describe('preview feedback never shows Qaap plumbing to the user', () => {
    /** Verbatim shape of the auto-sent annotation message from the desktop E2E (Nov 18). */
    const AUTO_SENT_FEEDBACK = [
        'The user attached the following context with this message. Use it to answer; do not claim nothing was provided.',
        '',
        '### previewFeedback: Preview feedback · 1 annotations · /?_qaap_cache_bust=1795010821889 · Desktop',
        '```',
        'Preview feedback annotations (compact context — not full DOM):',
        '',
        'Annotation 1:',
        '- Comment: un button icono solo aqui',
        '- Route: /?_qaap_cache_bust=1795010821889',
        '- Viewport: desktop 479x626',
        '- Selector: html > ul#list > li[0] > button',
        '- Position in element: x=0.507, y=0.833',
        '- Document position: x=0.891, y=0.302',
        '- Element: <button>',
        '- Text: Borrar',
        '```',
        '',
        '---',
        '',
        'Please address the attached preview feedback.',
    ].join('\n');

    it('strips the cache-bust marker from routes and chip titles, keeping real query params', () => {
        expect(stripQaapPreviewCacheBustParam('/?_qaap_cache_bust=1795010821889')).to.equal('/');
        expect(stripQaapPreviewCacheBustParam('/a?x=1&_qaap_cache_bust=2')).to.equal('/a?x=1');
        expect(stripQaapPreviewCacheBustParam('/a?_qaap_cache_bust=2&x=1')).to.equal('/a?x=1');
        expect(stripQaapPreviewCacheBustParam('/a?x=1&_qaap_cache_bust=2&y=3#h')).to.equal('/a?x=1&y=3#h');
        expect(stripQaapPreviewCacheBustParam('Preview feedback · 1 annotations · /?_qaap_cache_bust=9 · Desktop'))
            .to.equal('Preview feedback · 1 annotations · / · Desktop');
    });

    it('renders the auto-sent message as a readable chip and prompt without the raw payload', () => {
        const view = resolveTranscriptUserMessageView({ role: 'user', content: AUTO_SENT_FEEDBACK });
        expect(view.displayText).to.equal('Please address the attached preview feedback.');
        expect(view.contextChips).to.have.length(1);
        const chip = view.contextChips[0]!;
        expect(chip.title).to.equal('Preview feedback · 1 annotations · / · Desktop');
        expect(chip.annotations?.[0]?.comment).to.equal('un button icono solo aqui');
        expect(chip.annotations?.[0]?.route).to.equal('/');
        expect(JSON.stringify(view)).not.to.contain('_qaap_cache_bust');
    });
});
