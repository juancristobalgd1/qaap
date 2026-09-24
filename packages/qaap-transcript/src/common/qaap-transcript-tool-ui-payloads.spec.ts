// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveTranscriptToolUiPayloadFromSegment,
    tryParseAskUserQuestionArgs,
    tryParseTranscriptToolUiPayloadFromText,
} from './qaap-transcript-tool-ui-payloads';

describe('qaap-transcript-tool-ui-payloads', () => {
    it('parses code block payloads', () => {
        const payload = tryParseTranscriptToolUiPayloadFromText(JSON.stringify({
            id: 'code-1',
            code: 'console.log("hi")',
            language: 'javascript',
        }));
        expect(payload?.kind).to.equal('code_block');
        expect(payload && payload.kind === 'code_block' ? payload.language : undefined).to.equal('javascript');
    });

    it('parses link preview payloads', () => {
        const payload = tryParseTranscriptToolUiPayloadFromText(JSON.stringify({
            id: 'link-1',
            href: 'https://example.com/docs',
            title: 'Docs',
            description: 'Product docs',
        }));
        expect(payload?.kind).to.equal('link_preview');
    });

    it('parses citation payloads', () => {
        const payload = tryParseTranscriptToolUiPayloadFromText(JSON.stringify({
            id: 'cite-1',
            href: 'https://example.com/post',
            title: 'Blog post',
            snippet: 'A short excerpt.',
            type: 'article',
        }));
        expect(payload?.kind).to.equal('citation');
    });

    it('parses option list payloads', () => {
        const payload = tryParseTranscriptToolUiPayloadFromText(JSON.stringify({
            id: 'opts-1',
            options: [{ id: 'a', label: 'Alpha', description: 'First' }],
            choice: 'a',
        }));
        expect(payload?.kind).to.equal('option_list');
    });

    it('parses AskUserQuestion args as question flow', () => {
        const payload = tryParseAskUserQuestionArgs(JSON.stringify({
            questions: [{
                question: 'Which database?',
                header: 'Database',
                options: [{ label: 'Postgres', description: 'Default' }],
                multiSelect: false,
            }],
        }));
        expect(payload?.kind).to.equal('question_flow');
        expect(payload && payload.kind === 'question_flow' ? payload.questions.length : 0).to.equal(1);
    });

    it('resolves payloads from tool segment name + args/result', () => {
        const payload = resolveTranscriptToolUiPayloadFromSegment(
            'AskUserQuestion',
            JSON.stringify({
                questions: [{
                    question: 'Deploy target?',
                    header: 'Deploy',
                    options: [{ label: 'Staging' }, { label: 'Production' }],
                }],
            }),
            undefined,
        );
        expect(payload?.kind).to.equal('question_flow');
    });

    it('parses AskUserQuestion parameters envelope with stringified questions', () => {
        const questions = [{
            question: 'What is the most important untested behavior in this codebase?',
            header: 'Identify gaps',
            multiSelect: false,
            options: [
                { label: 'Missing tests', description: 'Missing tests' },
                { label: 'Other', description: 'Other' },
            ],
        }];
        const payload = tryParseAskUserQuestionArgs(JSON.stringify({
            name: 'AskUserQuestion',
            parameters: {
                questions: JSON.stringify(questions),
            },
        }));
        expect(payload?.kind).to.equal('question_flow');
        expect(payload && payload.kind === 'question_flow' ? payload.questions[0]?.header : undefined)
            .to.equal('Identify gaps');
    });

    it('strips checkpoint tails glued to AskUserQuestion JSON', () => {
        const args = `${JSON.stringify({
            name: 'AskUserQuestion',
            parameters: {
                questions: [{
                    question: 'Which area?',
                    header: 'Scope',
                    options: [{ label: 'Tests' }],
                }],
            },
        })}Checkpoint: Add tests (+638/-250)`;
        const payload = tryParseAskUserQuestionArgs(args);
        expect(payload?.kind).to.equal('question_flow');
    });
});
