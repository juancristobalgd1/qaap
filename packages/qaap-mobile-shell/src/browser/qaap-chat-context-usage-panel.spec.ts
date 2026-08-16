// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { ChatModel } from '@theia/ai-chat';
import type { QaapAgentConversationDTO } from '../common/qaap-agent-conversation-client';
import {
    formatContextTokenCount,
    renderContextUsageSheet,
    resolveChatModelContextUsageBreakdown,
    resolveVpsContextUsageBreakdown,
} from './qaap-chat-context-usage-panel';

describe('qaap-chat-context-usage-panel', () => {
    it('uses flat transparent rows and a violet Prompt context swatch', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-conversation.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).to.include('.qaap-chat-context-usage-panel-row {');
        expect(css).to.include('border: none');
        expect(css).to.match(/\.qaap-chat-context-usage-panel-row\s*\{[^}]*background:\s*transparent;/s);
        expect(css).to.include('.qaap-chat-context-usage-panel-swatch.theia-mod-prompt-context');
        expect(css).to.include('background: #a78bfa');
        expect(css).not.to.include('.qaap-chat-context-usage-panel-row.theia-mod-prompt-context');
    });

    describe('formatContextTokenCount', () => {
        it('formats zero with an explicit token unit', () => {
            expect(formatContextTokenCount(0, 'reported')).to.equal('0 Tokens');
            expect(formatContextTokenCount(0, 'estimated')).to.equal('0 Tokens');
        });

        it('uses compact K values below and at one thousand', () => {
            expect(formatContextTokenCount(398, 'reported')).to.equal('0.4K');
            expect(formatContextTokenCount(398, 'estimated')).to.equal('~0.4K');
            expect(formatContextTokenCount(999, 'reported')).to.equal('1.0K');
            expect(formatContextTokenCount(1_000, 'reported')).to.equal('1.0K');
        });

        it('formats model limits and millions consistently', () => {
            expect(formatContextTokenCount(128_000, 'reported')).to.equal('128.0K');
            expect(formatContextTokenCount(128_000, 'estimated')).to.equal('~128.0K');
            expect(formatContextTokenCount(1_000_000, 'reported')).to.equal('1.0M');
            expect(formatContextTokenCount(1_000_000, 'estimated')).to.equal('~1.0M');
        });
    });

    it('marks provider usage categories as reported', () => {
        const full = {
            messages: [],
            contextUsage: {
                inputTokens: 100,
                outputTokens: 25,
                cacheReadInputTokens: 50,
            },
            contextWindowSize: 128_000,
        } as unknown as QaapAgentConversationDTO;
        const view = resolveVpsContextUsageBreakdown(undefined, full);
        expect(view.totalTokens).to.equal(175);
        expect(view.totalProvenance).to.equal('reported');
        expect(view.contextWindowProvenance).to.equal('estimated');
        expect(view.categories.map(category => [category.id, category.provenance])).to.deep.equal([
            ['input', 'reported'],
            ['output', 'reported'],
            ['cache-read', 'reported'],
        ]);
    });

    it('renders only defensible estimated prompt categories after compaction', () => {
        const full = {
            messages: [
                { content: 'old message' },
                { content: '12345678' },
            ],
            contextPreamble: '1234',
            contextUsageEstimated: true,
            contextWindowSize: 128_000,
            contextCompaction: {
                status: 'complete',
                summary: '12345678',
                compactedMessageCount: 1,
            },
        } as unknown as QaapAgentConversationDTO;
        const view = resolveVpsContextUsageBreakdown(undefined, full);
        expect(view.totalProvenance).to.equal('estimated');
        expect(view.categories.map(category => category.id)).to.deep.equal([
            'prompt-context',
            'summarized-conversation',
            'conversation',
        ]);
        expect(view.categories.every(category => category.provenance === 'estimated')).to.equal(true);
    });

    it('does not calculate fullness when the Theia model limit is unknown', () => {
        const chatModel = {
            getRequests: () => [{
                response: {
                    tokenUsage: { inputTokens: 1000, outputTokens: 50 },
                },
            }],
        } as unknown as ChatModel;
        const view = resolveChatModelContextUsageBreakdown(chatModel);
        expect(view.totalTokens).to.equal(1050);
        expect(view.percent).to.equal(undefined);
        expect(view.contextWindowProvenance).to.equal('unavailable');
    });

    describe('rendering', () => {
        let disableJSDOM: () => void;

        before(() => {
            disableJSDOM = enableJSDOM();
        });

        after(() => {
            disableJSDOM();
        });

        it('renders segmented rows with visible provenance and unknown-limit copy', () => {
            const sheet = renderContextUsageSheet({
                totalTokens: 1050,
                totalProvenance: 'reported',
                contextWindowProvenance: 'unavailable',
                empty: false,
                categories: [{
                    id: 'input',
                    label: 'Input',
                    tokens: 1050,
                    toneClass: 'theia-mod-input',
                    provenance: 'reported',
                }],
            }, { onClose: () => undefined });
            expect(sheet.querySelectorAll('.qaap-chat-context-usage-panel-row')).to.have.lengthOf(1);
            expect(sheet.querySelector('.qaap-chat-context-usage-panel-provenance')?.textContent).to.equal('reported');
            expect(sheet.querySelector('.qaap-chat-context-usage-panel-total')?.textContent).to.contain('Limit unavailable');
            expect(sheet.querySelector('.qaap-chat-context-usage-panel-percent')?.textContent)
                .to.equal('Fullness unavailable');
            expect(sheet.querySelector('.qaap-chat-context-usage-report')).to.equal(null);
        });

        it('renders K units and only prefixes estimated values', () => {
            const sheet = renderContextUsageSheet({
                totalTokens: 809,
                contextWindowSize: 128_000,
                percent: 1,
                totalProvenance: 'estimated',
                contextWindowProvenance: 'estimated',
                empty: false,
                categories: [
                    {
                        id: 'reported',
                        label: 'Reported',
                        tokens: 398,
                        toneClass: 'theia-mod-input',
                        provenance: 'reported',
                    },
                    {
                        id: 'estimated',
                        label: 'Estimated',
                        tokens: 411,
                        toneClass: 'theia-mod-estimated',
                        provenance: 'estimated',
                    },
                ],
            }, { onClose: () => undefined });
            expect(sheet.querySelector('.qaap-chat-context-usage-panel-total')?.textContent)
                .to.equal('~0.8K / ~128.0K Tokens');
            expect([...sheet.querySelectorAll('.qaap-chat-context-usage-panel-count')].map(node => node.textContent))
                .to.deep.equal(['0.4K', '~0.4K']);
        });
    });
});
