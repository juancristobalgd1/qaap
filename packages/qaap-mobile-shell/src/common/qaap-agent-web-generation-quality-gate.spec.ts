// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import {
    agentWebGenerationPassesQualityGate,
    evaluateWebGenerationQuality,
    messageExplicitlyRequestsWebPage,
    messageRequestsWebGeneration,
} from './qaap-agent-web-generation-quality-gate';

const RIOJA_PROMPT = 'Create a landing page for Rioja wines using Vite and React with hero, products, and contact sections.';
const RIOJA_COMPOSER_PROMPT = 'Crea una landing page para vinos Rioja con productos, historia y contacto.';

describe('qaap-agent-web-generation-quality-gate', () => {

    it('messageRequestsWebGeneration matches landing page prompts', () => {
        expect(messageRequestsWebGeneration(RIOJA_PROMPT)).to.equal(true);
        expect(messageRequestsWebGeneration('Crea una página web con Vite')).to.equal(true);
        expect(messageRequestsWebGeneration('refactor auth module')).to.equal(false);
    });

    it('does not treat a title change on an existing page as a landing-page rewrite', () => {
        const prompt = 'Analiza este proyecto y explícame brevemente su arquitectura. '
            + 'Luego cambia el título principal visible de la página a PROJECT-A-TEST.';
        expect(messageRequestsWebGeneration(prompt)).to.equal(false);
        expect(messageExplicitlyRequestsWebPage(prompt)).to.equal(false);
        expect(messageExplicitlyRequestsWebPage('Crea una página web para vinos Rioja')).to.equal(true);
        expect(messageExplicitlyRequestsWebPage('Crea una página de aterrizaje para vinos')).to.equal(true);
    });

    it('rejects scaffold-only turns without UI customization', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a1',
            role: 'agent',
            content: 'Scaffolded the Vite app.',
            createdAt: 1,
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Bash',
                args: JSON.stringify({ command: 'npm create vite@latest rioja-wines-landing-page -- --template react-ts' }),
                finished: true,
            }],
        };
        const verdict = evaluateWebGenerationQuality(RIOJA_PROMPT, agent);
        expect(verdict.ok).to.equal(false);
        expect(verdict.reason).to.include('scaffolded');
        expect(agentWebGenerationPassesQualityGate(RIOJA_PROMPT, agent)).to.equal(false);
    });

    it('rejects default Vite starter content after a write', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a2',
            role: 'agent',
            content: 'Done.',
            createdAt: 1,
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Write',
                args: JSON.stringify({
                    path: 'src/App.tsx',
                    content: [
                        'import { useState } from "react";',
                        'import reactLogo from "./assets/react.svg";',
                        'import viteLogo from "/vite.svg";',
                        'export default function App() {',
                        '  const [count, setCount] = useState(0);',
                        '  return <div><img src={viteLogo} /><img src={reactLogo} /><p>count is {count}</p></div>;',
                        '}',
                    ].join('\n'),
                }),
                finished: true,
            }, {
                type: 'tool',
                toolUseId: 't2',
                name: 'Bash',
                args: JSON.stringify({ command: 'npm create vite@latest app -- --template react-ts' }),
                finished: true,
            }],
        };
        const verdict = evaluateWebGenerationQuality(RIOJA_PROMPT, agent);
        expect(verdict.ok).to.equal(false);
        expect(verdict.reason).to.include('starter');
    });

    it('accepts customized Rioja landing content with run path', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a3',
            role: 'agent',
            content: 'Landing ready. Run npm run dev on port 5173.',
            createdAt: 1,
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Write',
                args: JSON.stringify({
                    path: 'src/App.tsx',
                    content: [
                        'export default function App() {',
                        '  return (',
                        '    <main>',
                        '      <section className="hero"><h1>Rioja Wines</h1></section>',
                        '      <section className="products"><h2>Featured bottles</h2></section>',
                        '      <section className="contact"><h2>Contact our bodega</h2></section>',
                        '    </main>',
                        '  );',
                        '}',
                    ].join('\n'),
                }),
                finished: true,
            }],
        };
        expect(evaluateWebGenerationQuality(RIOJA_PROMPT, agent).ok).to.equal(true);
    });

    it('accepts the Spanish Rioja composer Write contract with file_path and content', () => {
        const html = [
            '<main>',
            '  <h1>Vinos Rioja</h1>',
            '  <section id="productos"><h2>Productos destacados</h2><p>Selección de bodegas.</p></section>',
            '  <section id="historia"><h2>Historia</h2><p>Tradición vitivinícola.</p></section>',
            '  <section id="contacto"><h2>Contacto</h2><p>Reserva tu visita.</p></section>',
            '</main>',
        ].join('\n');
        const packageJson = JSON.stringify({ scripts: { dev: 'vite --host 127.0.0.1 --port 5173' } });
        const agent: QaapAgentMessageDTO = {
            id: 'a5',
            role: 'agent',
            content: 'Landing de Rioja lista. Ejecuta npm run dev para abrir la preview.',
            createdAt: 1,
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Write',
                args: JSON.stringify({ file_path: 'index.html', content: html }),
                finished: true,
                result: html,
            }, {
                type: 'tool',
                toolUseId: 't2',
                name: 'Write',
                args: JSON.stringify({ file_path: 'package.json', content: packageJson }),
                finished: true,
                result: packageJson,
            }],
        };
        expect(evaluateWebGenerationQuality(RIOJA_COMPOSER_PROMPT, agent).ok).to.equal(true);
    });

    it('rejects topic mismatch when branding never mentions the requested subject', () => {
        const agent: QaapAgentMessageDTO = {
            id: 'a4',
            role: 'agent',
            content: 'Run npm run dev after install.',
            createdAt: 1,
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Write',
                args: JSON.stringify({
                    path: 'src/App.tsx',
                    content: '<main><section className="hero"><h1>Welcome</h1></section></main>',
                }),
                finished: true,
            }],
        };
        const verdict = evaluateWebGenerationQuality(RIOJA_PROMPT, agent);
        expect(verdict.ok).to.equal(false);
        expect(verdict.reason).to.include('topic');
    });

});
