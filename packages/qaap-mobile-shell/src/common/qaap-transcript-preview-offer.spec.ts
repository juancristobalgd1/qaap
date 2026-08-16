// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    conversationAwaitingDevPreview,
    conversationEverRequestedDevPreview,
    conversationHasActiveDevServerRun,
    conversationHasActiveShellRun,
    conversationMayAutoOpenTranscriptPreview,
    conversationRequestsDevPreview,
    extractDevPreviewUrlFromAgentText,
    findTranscriptPreviewPortHint,
    isLikelyDevServerShellCommand,
    messageRequestsDevPreview,
    previewPageTitleMatchesProjectName,
    transcriptPreviewProbePorts,
} from './qaap-transcript-preview-offer';

describe('qaap-transcript-preview-offer', () => {

    it('previewPageTitleMatchesProjectName rejects empty titles and requires project name overlap', () => {
        expect(previewPageTitleMatchesProjectName(undefined, 'Todo')).to.equal(false);
        expect(previewPageTitleMatchesProjectName('', 'Todo')).to.equal(false);
        expect(previewPageTitleMatchesProjectName('Todo App', 'Todo')).to.equal(true);
        expect(previewPageTitleMatchesProjectName('LadinPage', 'Todo')).to.equal(false);
        expect(previewPageTitleMatchesProjectName('Anything', '')).to.equal(true);
    });

    it('extractDevPreviewUrlFromAgentText accepts localhost URLs and port hints', () => {
        expect(extractDevPreviewUrlFromAgentText('Local: http://localhost:5173/', 'http://localhost:3000'))
            .to.equal('http://localhost:3000/qaap-dev/5173/');
        expect(extractDevPreviewUrlFromAgentText('Use port 4321', 'http://localhost:3000'))
            .to.equal('http://localhost:3000/qaap-dev/4321/');
    });

    it('extractDevPreviewUrlFromAgentText tolerates punctuated port hints agents actually emit', () => {
        // Live VPS failure: the agent replied "serving on the live preview port (5173)" and the
        // old `port\s+N` regex missed it, leaving the chat with nothing clickable.
        expect(extractDevPreviewUrlFromAgentText('serving on the live preview port (5173).', 'http://localhost:3000'))
            .to.equal('http://localhost:3000/qaap-dev/5173/');
        expect(extractDevPreviewUrlFromAgentText('Puerto: 8080', 'http://localhost:3000'))
            .to.equal('http://localhost:3000/qaap-dev/8080/');
        expect(extractDevPreviewUrlFromAgentText('port #3001 listo', 'http://localhost:3000'))
            .to.equal('http://localhost:3000/qaap-dev/3001/');
        expect(extractDevPreviewUrlFromAgentText('exported 3 files', 'http://localhost:3000'))
            .to.equal(undefined);
    });

    it('isLikelyDevServerShellCommand matches common dev commands', () => {
        expect(isLikelyDevServerShellCommand('pnpm dev')).to.equal(true);
        expect(isLikelyDevServerShellCommand('npm run start')).to.equal(true);
        expect(isLikelyDevServerShellCommand('pnpm install')).to.equal(false);
    });

    it('messageRequestsDevPreview matches run-app landing prompt', () => {
        expect(messageRequestsDevPreview(
            'Figure out how to build and run this project locally. Start the dev server, confirm it boots cleanly, and report the URL plus any setup steps I should know.',
        )).to.equal(true);
    });

    it('messageRequestsDevPreview matches Spanish and launch-style prompts', () => {
        expect(messageRequestsDevPreview('levanta la app')).to.equal(true);
        expect(messageRequestsDevPreview('Inicia el servidor de desarrollo y dime el puerto')).to.equal(true);
        expect(messageRequestsDevPreview('Launch the app so I can preview it')).to.equal(true);
        expect(messageRequestsDevPreview('Lanza automáticamente el servidor y abre la preview')).to.equal(true);
        expect(messageRequestsDevPreview('Muéstrame la preview cuando esté lista')).to.equal(true);
        expect(messageRequestsDevPreview('refactor the auth module')).to.equal(false);
    });

    it('conversationEverRequestedDevPreview scans all user turns', () => {
        const conv: QaapAgentConversationDTO = {
            id: 'c5',
            cwd: '/repo',
            agentId: 'qaiq',
            title: 'Landing',
            status: 'idle',
            createdAt: 1,
            updatedAt: 3,
            messages: [{
                id: 'u1',
                role: 'user',
                content: 'Crea una landing y lanza el servidor. Abre la preview.',
                createdAt: 1,
            }, {
                id: 'a1',
                role: 'agent',
                content: 'Done.',
                createdAt: 2,
            }, {
                id: 'u2',
                role: 'user',
                content: 'Añade una sección FAQ.',
                createdAt: 3,
            }],
        };
        expect(conversationEverRequestedDevPreview(conv)).to.equal(true);
    });

    it('conversationRequestsDevPreview reads the latest user turn', () => {
        const conv: QaapAgentConversationDTO = {
            id: 'c3',
            cwd: '/repo',
            agentId: 'qaiq',
            title: 'Run',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [{
                id: 'u1',
                role: 'user',
                content: 'Start the dev server and report the URL',
                createdAt: 1,
            }, {
                id: 'a1',
                role: 'agent',
                content: 'Exploring project…',
                createdAt: 2,
            }],
        };
        expect(conversationRequestsDevPreview(conv)).to.equal(true);
    });

    it('conversationHasActiveDevServerRun detects unfinished bash dev tools', () => {
        const conv: QaapAgentConversationDTO = {
            id: 'c1',
            cwd: '/repo',
            agentId: 'qaiq',
            title: 'Run',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [{
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 2,
                segments: [{
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'Bash',
                    args: '{"command":"pnpm dev"}',
                    finished: false,
                }],
            }],
        };
        expect(conversationHasActiveDevServerRun(conv)).to.equal(true);
        expect(findTranscriptPreviewPortHint(conv)).to.equal(undefined);
        expect(transcriptPreviewProbePorts(conv)[0]).to.equal(5173);
    });

    it('transcriptPreviewProbePorts includes default ports when user requested preview', () => {
        const conv: QaapAgentConversationDTO = {
            id: 'c4',
            cwd: '/repo',
            agentId: 'qaiq',
            title: 'Run',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [{
                id: 'u1',
                role: 'user',
                content: 'levanta la app',
                createdAt: 1,
            }, {
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 2,
                segments: [{
                    type: 'thinking',
                    content: 'Revisando el proyecto…',
                }],
            }],
        };
        expect(transcriptPreviewProbePorts(conv)[0]).to.equal(5173);
    });

    it('transcriptPreviewProbePorts skips default ports mid-turn without preview intent', () => {
        const conv: QaapAgentConversationDTO = {
            id: 'c4b',
            cwd: '/repo',
            agentId: 'qaiq',
            title: 'Run',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [{
                id: 'u1',
                role: 'user',
                content: 'Añade una sección FAQ al footer',
                createdAt: 1,
            }, {
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 2,
                segments: [{
                    type: 'thinking',
                    content: 'Revisando el proyecto…',
                }],
            }],
        };
        expect(transcriptPreviewProbePorts(conv)).to.deep.equal([]);
    });

    it('conversationHasActiveShellRun detects unfinished shell tools', () => {
        const conv: QaapAgentConversationDTO = {
            id: 'c2',
            cwd: '/repo',
            agentId: 'qaiq',
            title: 'Run',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [{
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 2,
                segments: [{
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'Bash',
                    args: '{"command":"pnpm"}',
                    finished: false,
                }],
            }],
        };
        expect(conversationHasActiveShellRun(conv)).to.equal(true);
        expect(conversationHasActiveDevServerRun(conv)).to.equal(false);
        expect(conversationAwaitingDevPreview(conv)).to.equal(true);
    });

    it('conversationMayAutoOpenTranscriptPreview stays off unless a user turn asked to run or preview', () => {
        const base: QaapAgentConversationDTO = {
            id: 'c4',
            cwd: '/repo',
            agentId: 'qaiq',
            title: 'Run',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [{
                id: 'a1',
                role: 'agent',
                // A printed URL must stage the offer when the user never asked for preview.
                content: 'Dev server running at http://localhost:5175/',
                createdAt: 2,
                segments: [{
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'Bash',
                    args: '{"command":"pnpm install"}',
                    finished: true,
                }],
            }],
        };
        expect(conversationMayAutoOpenTranscriptPreview(base)).to.equal(false);
        expect(conversationMayAutoOpenTranscriptPreview({ ...base, status: 'idle' })).to.equal(false);
        expect(conversationMayAutoOpenTranscriptPreview(undefined)).to.equal(false);
        const requested: QaapAgentConversationDTO = {
            ...base,
            messages: [{
                id: 'u1',
                role: 'user',
                content: 'Levanta la app y abre la preview.',
                createdAt: 1,
            }, ...base.messages],
        };
        expect(conversationMayAutoOpenTranscriptPreview(requested)).to.equal(true);
        expect(conversationMayAutoOpenTranscriptPreview({ ...requested, status: 'idle' })).to.equal(true);
    });
});
