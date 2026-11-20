// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessage } from './qaap-agent-conversation';
import {
    isBareContinueRequest,
    buildConversationAgentPrompt,
    partitionConversationHistory,
    shouldCompressConversationPrompt,
    VPS_PROMPT_COMPRESSED_MESSAGE_MAX_CHARS,
} from './qaap-agent-conversation-prompt';

function message(partial: Partial<QaapAgentMessage> & Pick<QaapAgentMessage, 'role' | 'content'>): QaapAgentMessage {
    return {
        id: partial.id ?? `${partial.role}-${Math.random()}`,
        createdAt: partial.createdAt ?? 1,
        ...partial,
    };
}

describe('partitionConversationHistory', () => {
    it('keeps the last two user turns verbatim', () => {
        const history = [
            message({ role: 'user', content: 'u1' }),
            message({ role: 'agent', content: 'a1' }),
            message({ role: 'user', content: 'u2' }),
            message({ role: 'agent', content: 'a2' }),
            message({ role: 'user', content: 'u3' }),
            message({ role: 'agent', content: 'a3' }),
        ];
        const { compressed, recent } = partitionConversationHistory(history, 2);
        expect(compressed.map(m => m.content)).to.deep.equal(['u1', 'a1']);
        expect(recent.map(m => m.content)).to.deep.equal(['u2', 'a2', 'u3', 'a3']);
    });
});

describe('buildConversationAgentPrompt', () => {
    it('uses the full transcript when under the compression threshold', () => {
        const prompt = buildConversationAgentPrompt({
            history: [
                message({ role: 'user', content: 'Hello' }),
                message({ role: 'agent', content: 'Hi there' }),
            ],
            latestUserContent: 'Next question',
            contextWindowSize: 128_000,
        });
        expect(prompt).to.include('The transcript so far:');
        expect(prompt).to.include('USER: Hello');
        expect(prompt).to.include('ASSISTANT: Hi there');
        expect(prompt).to.include('USER: Next question');
        expect(prompt).not.to.include('Earlier context (compressed)');
    });

    it('adds incremental-edit rules for multi-turn prompts', () => {
        const prompt = buildConversationAgentPrompt({
            history: [
                message({ role: 'user', content: 'Create landing page' }),
                message({ role: 'agent', content: 'Done' }),
            ],
            latestUserContent: 'Add FAQ section',
            contextWindowSize: 128_000,
        });
        expect(prompt).to.include('minimal, targeted edits');
        expect(prompt).to.include('vanilla HTML');
    });

    it('compresses older turns when the estimated prompt exceeds the threshold', () => {
        const longBody = 'x'.repeat(VPS_PROMPT_COMPRESSED_MESSAGE_MAX_CHARS + 200);
        const history: QaapAgentMessage[] = [];
        for (let turn = 0; turn < 8; turn++) {
            history.push(message({ role: 'user', content: `${longBody} user-${turn}` }));
            history.push(message({ role: 'agent', content: `${longBody} agent-${turn}` }));
        }
        expect(shouldCompressConversationPrompt(
            history.concat(message({ role: 'user', content: 'latest' })),
            undefined,
            4_000,
        )).to.equal(true);

        const prompt = buildConversationAgentPrompt({
            history,
            latestUserContent: 'latest',
            contextWindowSize: 4_000,
        });
        expect(prompt).to.include('Earlier context (compressed):');
        expect(prompt).to.include('Recent transcript:');
        expect(prompt).to.include('USER: latest');
        expect(prompt).not.to.include(`${longBody} user-0`);
    });

    it('compresses via the absolute token cap even on a large context window', () => {
        // ~30k tokens of history: under 55% (and under 35%) of a 128k window, but over the 25k
        // absolute cap — so it must still compress instead of re-sending everything verbatim.
        const bigBody = 'palabra '.repeat(2_500); // ~2.5k tokens per message
        const history: QaapAgentMessage[] = [];
        for (let turn = 0; turn < 6; turn++) {
            history.push(message({ role: 'user', content: `${bigBody} user-${turn}` }));
            history.push(message({ role: 'agent', content: `${bigBody} agent-${turn}` }));
        }
        expect(shouldCompressConversationPrompt(
            history.concat(message({ role: 'user', content: 'latest' })),
            undefined,
            128_000,
        )).to.equal(true);
        const prompt = buildConversationAgentPrompt({
            history,
            latestUserContent: 'latest',
            contextWindowSize: 128_000,
        });
        expect(prompt).to.include('Earlier context (compressed):');
        expect(prompt).not.to.include(`${bigBody} user-0`);
    });
});

describe('bare continue requests', () => {
    const history: QaapAgentMessage[] = [
        { id: 'u1', role: 'user', content: 'levantara la app', createdAt: 1 },
        { id: 'a1', role: 'agent', content: 'Dependencias instaladas; Qaap arranca la preview.', createdAt: 2 },
    ];

    it('recognises a bare continue in Spanish and English, and nothing longer', () => {
        for (const text of ['Continúa', 'continua', 'sigue', 'Sigue por favor', 'dale', '¡Adelante!', 'continue', 'Go on.', 'keep going', 'resume']) {
            expect(isBareContinueRequest(text), text).to.equal(true);
        }
        for (const text of ['', 'continúa con el login y añade tests', 'sigue sin funcionar', 'why did it stop?', 'continuous integration']) {
            expect(isBareContinueRequest(text), text).to.equal(false);
        }
    });

    it('tells the agent to resume the last real request instead of asking what to continue', () => {
        const prompt = buildConversationAgentPrompt({ history, latestUserContent: 'Continúa', contextPreamble: undefined, contextWindowSize: undefined });
        expect(prompt).to.contain('USER: Continúa');
        expect(prompt).to.contain('Their last request was: "levantara la app"');
        expect(prompt).to.contain('Do not ask what to continue.');
    });

    it('skips earlier bare continues when naming the last request, and adds nothing to an ordinary message', () => {
        const withContinue: QaapAgentMessage[] = [...history, { id: 'u2', role: 'user', content: 'sigue', createdAt: 3 }, { id: 'a2', role: 'agent', content: '¿Qué?', createdAt: 4 }];
        expect(buildConversationAgentPrompt({ history: withContinue, latestUserContent: 'continue', contextPreamble: undefined, contextWindowSize: undefined }))
            .to.contain('Their last request was: "levantara la app"');
        expect(buildConversationAgentPrompt({ history, latestUserContent: 'Ahora añade un botón', contextPreamble: undefined, contextWindowSize: undefined }))
            .to.not.contain('Do not ask what to continue');
    });
});
