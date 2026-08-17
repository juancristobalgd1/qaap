// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import {
    agentMessageDeliversTaskOutcome,
    agentMessageHasOpenTodos,
    autoContinueAllowedForInteraction,
    buildAgentAutoContinuePrompt,
    isActionableAgentTaskMessage,
    isIncompleteAgentTurn,
} from './qaap-agent-turn-completion';

const RUN_APP_PROMPT = 'Figure out how to build and run this project locally. Start the dev server, confirm it boots cleanly, and report the URL plus any setup steps I should know.';

describe('qaap-agent-turn-completion', () => {

    it('isActionableAgentTaskMessage matches run-app style prompts', () => {
        expect(isActionableAgentTaskMessage(
            'Figure out how to build and run this project locally. Start the dev server.',
        )).to.equal(true);
        expect(isActionableAgentTaskMessage('levanta la app')).to.equal(true);
        expect(isActionableAgentTaskMessage('thanks')).to.equal(false);
    });

    it('isActionableAgentTaskMessage matches Spanish task prompts', () => {
        expect(isActionableAgentTaskMessage('Arregla el bug del login')).to.equal(true);
        expect(isActionableAgentTaskMessage('Implementa la vista de perfil')).to.equal(true);
        expect(isActionableAgentTaskMessage('AÑADE UN BOTÓN DE GUARDAR')).to.equal(true);
        expect(isActionableAgentTaskMessage('crea una landing page para mi negocio')).to.equal(true);
        expect(isActionableAgentTaskMessage('instala las dependencias y corrige los tests')).to.equal(true);
        expect(isActionableAgentTaskMessage('gracias')).to.equal(false);
        expect(isActionableAgentTaskMessage('hola, ¿qué tal?')).to.equal(false);
    });

    it('detects Spanish planning-only agent stops as incomplete', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a-es',
            role: 'agent',
            content: '',
            createdAt: 2,
            segments: [{
                type: 'text',
                content: 'Voy a explorar el repositorio y primero necesito revisar la configuración.',
            }],
        };
        expect(isIncompleteAgentTurn('Arregla el bug del login', agent)).to.equal(true);
    });

    it('accepts Spanish outcome text as a delivered result', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a-es-2',
            role: 'agent',
            content: '',
            createdAt: 2,
            segments: [{
                type: 'text',
                content: 'Listo: dependencias instaladas y el servidor de desarrollo está corriendo en el puerto 5173.',
            }],
        };
        expect(isIncompleteAgentTurn('levanta la app', agent)).to.equal(false);
    });

    it('treats a Spanish written analysis after reads as complete (analytical task)', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a-es-3',
            role: 'agent',
            content: '',
            createdAt: 2,
            segments: [
                { type: 'tool', toolUseId: 't-es-1', name: 'Read', args: '{"file":"auth.ts"}', finished: true },
                { type: 'text', content: 'El módulo de auth tiene dos problemas: el token no expira y falta validación del lado servidor.' },
            ],
        };
        expect(isIncompleteAgentTurn('analiza el módulo de auth y explícame los problemas', agent)).to.equal(false);
    });

    it('isIncompleteAgentTurn detects thinking-only agent stops', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a1',
            role: 'agent',
            content: '',
            createdAt: 2,
            segments: [{
                type: 'thinking',
                content: 'I will explore the repo.',
            }],
        };
        expect(isIncompleteAgentTurn('Start the dev server and report the URL', agent)).to.equal(true);
        expect(isIncompleteAgentTurn('Start the dev server', {
            ...agent,
            segments: [{
                type: 'text',
                content: 'Dev server is on port 5173.',
            }],
        })).to.equal(false);
    });

    it('isIncompleteAgentTurn detects search-only exploration stops', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a1',
            role: 'agent',
            content: '',
            createdAt: 2,
            segments: [
                {
                    type: 'thinking',
                    content: 'Need to inspect the repo.',
                },
                {
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'Search',
                    args: '{"query":"package.json"}',
                    finished: true,
                },
                {
                    type: 'tool',
                    toolUseId: 't2',
                    name: 'Grep',
                    args: '{"pattern":"scripts"}',
                    finished: true,
                },
                {
                    type: 'text',
                    content: 'The user wants me to figure out how to build and run this project locally. Let me start by exploring the project structure.',
                },
            ],
        };
        expect(isIncompleteAgentTurn(RUN_APP_PROMPT, agent)).to.equal(true);
        expect(agentMessageDeliversTaskOutcome(RUN_APP_PROMPT, agent)).to.equal(false);
    });

    it('agentMessageDeliversTaskOutcome accepts shell work and preview ports', () => {
        const withShell: QaapAgentMessageDTO = {
            id: 'a2',
            role: 'agent',
            content: '',
            createdAt: 2,
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Bash',
                args: '{"command":"pnpm install"}',
                finished: true,
                result: 'done',
            }],
        };
        expect(agentMessageDeliversTaskOutcome(RUN_APP_PROMPT, withShell)).to.equal(true);

        const withPort: QaapAgentMessageDTO = {
            id: 'a3',
            role: 'agent',
            content: 'Dev server is ready on http://localhost:5173/',
            createdAt: 2,
        };
        expect(agentMessageDeliversTaskOutcome(RUN_APP_PROMPT, withPort)).to.equal(true);
    });

    it('buildAgentAutoContinuePrompt nudges tool use', () => {
        expect(buildAgentAutoContinuePrompt()).to.include('Read');
        expect(buildAgentAutoContinuePrompt()).to.include('remaining todo');
        expect(buildAgentAutoContinuePrompt(RUN_APP_PROMPT)).to.include('package.json');
    });

    it('agentMessageHasOpenTodos reads the latest TodoWrite checklist', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a1',
            role: 'agent',
            content: '',
            createdAt: 2,
            segments: [
                {
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'TodoWrite',
                    args: JSON.stringify({
                        todos: [
                            { content: 'Find component', status: 'completed' },
                            { content: 'Add tests', status: 'pending' },
                        ],
                    }),
                    finished: true,
                },
            ],
        };
        expect(agentMessageHasOpenTodos(agent)).to.equal(true);
        expect(agentMessageHasOpenTodos({
            ...agent,
            segments: [{
                type: 'tool',
                toolUseId: 't2',
                name: 'TodoWrite',
                args: JSON.stringify({
                    todos: [
                        { content: 'Find component', status: 'completed' },
                        { content: 'Add tests', status: 'completed' },
                    ],
                }),
                finished: true,
            }],
        })).to.equal(false);
    });

    it('isIncompleteAgentTurn detects partial todo progress with edits', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a1',
            role: 'agent',
            content: 'Created one test file.',
            createdAt: 2,
            segments: [
                {
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'TodoWrite',
                    args: JSON.stringify({
                        todos: [
                            { content: 'Locate MovieTimeline.tsx', status: 'completed' },
                            { content: 'Add unit tests', status: 'completed' },
                            { content: 'Add integration tests', status: 'pending' },
                            { content: 'Run test suite', status: 'pending' },
                        ],
                    }),
                    finished: true,
                },
                {
                    type: 'tool',
                    toolUseId: 't2',
                    name: 'Grep',
                    args: '{"pattern":"MovieTimeline"}',
                    finished: true,
                },
                {
                    type: 'tool',
                    toolUseId: 't3',
                    name: 'Write',
                    args: '{"path":"MovieTimeline.spec.ts"}',
                    finished: true,
                },
                {
                    type: 'text',
                    content: 'Created one test file.',
                },
            ],
        };
        const prompt = 'Implement tests for MovieTimeline and run the suite.';
        expect(agentMessageDeliversTaskOutcome(prompt, agent)).to.equal(false);
        expect(isIncompleteAgentTurn(prompt, agent)).to.equal(true);
    });

    it('isIncompleteAgentTurn rejects scaffold-only landing page work', () => {
        const prompt = 'Create a landing page for Rioja wines using Vite and React.';
        const agent: QaapAgentMessageDTO = {
            id: 'a5',
            role: 'agent',
            content: 'Created the Vite project.',
            createdAt: 2,
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Bash',
                args: JSON.stringify({ command: 'npm create vite@latest rioja-wines-landing-page -- --template react-ts' }),
                finished: true,
            }],
        };
        expect(agentMessageDeliversTaskOutcome(prompt, agent)).to.equal(false);
        expect(isIncompleteAgentTurn(prompt, agent)).to.equal(true);
        expect(buildAgentAutoContinuePrompt(prompt)).to.include('starter');
    });

    it('continues an actionable turn that ended with planning text but no tool segments', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a5-planning-only',
            role: 'agent',
            content: 'I will explore the project and figure out how to run it.',
            createdAt: 2,
        };
        const prompt = 'Figure out how to build and run this app.';
        expect(agentMessageDeliversTaskOutcome(prompt, agent)).to.equal(false);
        expect(isIncompleteAgentTurn(prompt, agent)).to.equal(true);
    });

    it('does not derail a build-error report or a plain task into a landing-page rewrite', () => {
        // The auto-verify UI feeds a build-failure report back into the conversation. Its text
        // contains the command `vite build`, which used to trip the loose web-generation regex and
        // inject "Replace the Vite/React starter…". A build-error report is not a web-page request.
        const verifyReport = 'Verification failed. Please fix these checks:\n\n'
            + '### Build — `pnpm run build` (exit 1)\n'
            + '@workspace/mockup-studio build: vite build --config vite.config.ts';
        expect(buildAgentAutoContinuePrompt(verifyReport)).to.not.include('starter');
        expect(buildAgentAutoContinuePrompt('add a formatDate function in a new file')).to.not.include('starter');
        expect(buildAgentAutoContinuePrompt(
            'Analiza este proyecto y explícame brevemente su arquitectura. Luego cambia el título principal visible de la página a PROJECT-A-TEST.',
        )).to.not.include('starter');
    });

    it('treats a normal file-editing task as complete — no auto-continue', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a6',
            role: 'agent',
            content: 'Created src/date.js with formatDate.',
            createdAt: 2,
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Write',
                args: '{"path":"src/date.js"}',
                finished: true,
            }],
        };
        const prompt = 'add a formatDate function in a new file';
        expect(agentMessageDeliversTaskOutcome(prompt, agent)).to.equal(true);
        expect(isIncompleteAgentTurn(prompt, agent)).to.equal(false);
    });

    it('autoContinueAllowedForInteraction only allows the autonomous agent contract', () => {
        // agent mode (explicit or missing) with autonomous approval → allowed
        expect(autoContinueAllowedForInteraction({ interactionModeId: 'agent' })).to.equal(true);
        expect(autoContinueAllowedForInteraction({})).to.equal(true);
        expect(autoContinueAllowedForInteraction({ interactionModeId: 'agent', approvalPolicyId: 'approve-for-me' })).to.equal(true);
        // plan is a deliberate non-executing stop → never auto-continue
        expect(autoContinueAllowedForInteraction({ interactionModeId: 'plan' })).to.equal(false);
        // user opted to stay in the loop → do not auto-continue
        expect(autoContinueAllowedForInteraction({ interactionModeId: 'agent', approvalPolicyId: 'request-approval' })).to.equal(false);
        expect(autoContinueAllowedForInteraction({ interactionModeId: 'agent', autoApprove: false })).to.equal(false);
    });

    it('treats a written review after reads as complete (analytical task), not an exploration stop', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a7',
            role: 'agent',
            content: '',
            createdAt: 2,
            segments: [
                { type: 'tool', toolUseId: 't1', name: 'Read', args: '{"path":"src/app.ts"}', finished: true },
                { type: 'tool', toolUseId: 't2', name: 'Grep', args: '{"pattern":"export"}', finished: true },
                {
                    type: 'text',
                    content: 'The code is well structured. Two issues: the fetch lacks error handling, '
                        + 'and the date parser assumes ISO input. I would add a try/catch and validate the format.',
                },
            ],
        };
        const prompt = 'review this code and tell me what could be improved';
        expect(agentMessageDeliversTaskOutcome(prompt, agent)).to.equal(true);
        expect(isIncompleteAgentTurn(prompt, agent)).to.equal(false);
    });

    it('still requires edits when a review also asks to fix (execution verb present)', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a8',
            role: 'agent',
            content: '',
            createdAt: 2,
            segments: [
                { type: 'tool', toolUseId: 't1', name: 'Read', args: '{"path":"src/app.ts"}', finished: true },
                { type: 'text', content: 'I found a null-deref on line 20 and a missing await on line 33.' },
            ],
        };
        const prompt = 'review this code and fix the bugs';
        expect(agentMessageDeliversTaskOutcome(prompt, agent)).to.equal(false);
        expect(isIncompleteAgentTurn(prompt, agent)).to.equal(true);
    });
});
