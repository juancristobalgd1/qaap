// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QaapOpencodeStreamAccumulator,
    parseOpencodeFormattedLog,
    parseOpencodeLog,
} from './qaap-opencode-stream';

describe('QaapOpencodeStreamAccumulator', () => {

    it('parses tool_use and text JSON events', () => {
        const acc = new QaapOpencodeStreamAccumulator();
        acc.push([
            '{"type":"tool_use","timestamp":1,"sessionID":"s1","part":{"id":"p1","type":"tool","tool":"read","input":{"filePath":"a.ts"},"state":{"status":"completed","output":"ok"}}}',
            '{"type":"text","timestamp":2,"sessionID":"s1","part":{"type":"text","text":"Done."}}',
        ].join('\n') + '\n');
        expect(acc.getSegments()).to.deep.equal([
            {
                type: 'tool',
                toolUseId: 'p1',
                name: 'Read',
                args: '{"filePath":"a.ts"}',
                finished: true,
                result: 'ok',
            },
            { type: 'text', content: 'Done.' },
        ]);
    });

    it('maps reasoning events to thinking segments', () => {
        const acc = new QaapOpencodeStreamAccumulator();
        acc.push('{"type":"reasoning","part":{"type":"reasoning","text":"plan step"}}\n');
        expect(acc.getSegments()).to.deep.equal([{ type: 'thinking', content: 'plan step' }]);
    });

    it('captures token metadata from step_finish when OpenCode reports it', () => {
        const acc = new QaapOpencodeStreamAccumulator();
        acc.push('{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":900,"output":80,"reasoning":20,"cache":{"read":300,"write":40}}}}\n');
        expect(acc.getTurnUsage()).to.deep.equal({
            inputTokens: 900,
            outputTokens: 80,
            reasoningTokens: 20,
            cacheReadInputTokens: 300,
            cacheCreationInputTokens: 40,
        });
    });

    it('maps state.input from newer OpenCode tool_use envelopes', () => {
        const acc = new QaapOpencodeStreamAccumulator();
        acc.push('{"type":"tool_use","part":{"id":"p2","type":"tool","tool":"read","state":{"status":"completed","input":{"filePath":"pkg.json"},"output":"{}"}}}\n');
        expect(acc.getSegments()).to.deep.equal([
            {
                type: 'tool',
                toolUseId: 'p2',
                name: 'Read',
                args: '{"filePath":"pkg.json"}',
                finished: true,
                result: '{}',
            },
        ]);
    });

    it('nests child tools under an active task subagent', () => {
        const acc = new QaapOpencodeStreamAccumulator();
        acc.push([
            '{"type":"tool_use","part":{"id":"task-1","type":"tool","tool":"task","input":{"description":"Review auth"},"state":{"status":"completed"}}}',
            '{"type":"tool_use","part":{"id":"read-1","type":"tool","tool":"read","input":{"filePath":"auth.ts"},"parentID":"task-1","state":{"status":"completed","output":"ok"}}}',
        ].join('\n') + '\n');
        expect(acc.getSegments()).to.deep.equal([
            {
                type: 'tool',
                toolUseId: 'task-1',
                name: 'task',
                args: '{"description":"Review auth"}',
                finished: true,
            },
            {
                type: 'tool',
                toolUseId: 'read-1',
                name: 'Read',
                args: '{"filePath":"auth.ts"}',
                finished: true,
                result: 'ok',
                parentToolUseId: 'task-1',
            },
        ]);
    });
});

describe('parseOpencodeFormattedLog', () => {

    it('splits formatted tool lines from the assistant answer', () => {
        const log = [
            '> build · minimax-m3-free',
            '',
            '→ Read artifacts/demo-studio/package.json',
            '→ Read artifacts/demo-studio/src/App.tsx',
            '',
            '$ ls artifacts/demo-studio/src',
            'Canvas.tsx',
            'LeftPanel.tsx',
            '',
            'Está muy sólida. Resumen breve.',
        ].join('\n');
        const { content, segments } = parseOpencodeFormattedLog(log);
        expect(content).to.equal('Está muy sólida. Resumen breve.');
        expect(segments.filter(segment => segment.type === 'tool')).to.have.length(3);
        const bash = segments.find(segment => segment.type === 'tool' && segment.name === 'Bash');
        expect(bash && bash.type === 'tool' && bash.result).to.include('Canvas.tsx');
    });
});

describe('parseOpencodeLog', () => {

    it('prefers JSON when the log contains OpenCode events', () => {
        const log = '{"type":"text","part":{"type":"text","text":"Hola"}}\n';
        const parsed = parseOpencodeLog(log);
        expect(parsed.segments).to.deep.equal([{ type: 'text', content: 'Hola' }]);
    });

    it('falls back to formatted parsing when JSON is absent', () => {
        const log = '→ Read src/index.ts\n\nHello.';
        const parsed = parseOpencodeLog(log);
        expect(parsed.segments.some(segment => segment.type === 'tool')).to.be.true;
        expect(parsed.content).to.equal('Hello.');
    });

    it('does not invent tool segments from plain prose', () => {
        const log = 'Here is a summary:\n\n**Lo bueno**\n- React 19 + Vite 7';
        const parsed = parseOpencodeLog(log);
        expect(parsed.segments.filter(segment => segment.type === 'tool')).to.have.length(0);
        expect(parsed.content).to.include('Here is a summary');
    });
});
