// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { parseCopilotFormattedLog } from './qaap-copilot-stream';
import { parseAgentLogForTranscript, resolveAgentLogDisplayText } from './qaap-cli-transcript-stream';

describe('qaap-copilot-stream', () => {
    it('extracts MCP tool calls, raw JSON payloads, image echoes and footer out of Copilot CLI logs', () => {
        const log = [
            '/ Search "*" 33 files found',
            '',
            ' ● preview_start (MC… {"status":"ready","previewId":"u-dev-w-file-use-p-file-use-x-agent-de-1lx4r...',
            '',
            ' ● preview_snapshot … {"url":"http://127.0.0.1:3001/","httpStatus":200,"title":"Kalea · Elgoibar"...',
            '',
            '   [Image: [image/png] 1280x900]',
            '',
            'La app está abierta en la pestaña **Preview**.',
            '',
            'Iniciada la vista previa en el puerto activo y comprobada visualmente la página raíz; la app',
            'respondió HTTP 200.',
            '',
            '',
            'Changes    +0 -0',
            'AI Credits 0.35 (16s)',
            'Tokens     ↑ 106.8k (80.9k cached) • ↓ 208 (37 reasoning)',
            'Resume     copilot --resume=197e955b-8d1d-4ae8-81f2-520b503f59e9',
        ].join('\n');

        const parsed = parseCopilotFormattedLog(log);
        expect(parsed.content).to.equal(
            'La app está abierta en la pestaña **Preview**.\n\n'
            + 'Iniciada la vista previa en el puerto activo y comprobada visualmente la página raíz; la app\n'
            + 'respondió HTTP 200.',
        );
        expect(parsed.content).to.not.include('{"status"');
        expect(parsed.content).to.not.include('127.0.0.1');
        expect(parsed.content).to.not.include('[Image:');
        expect(parsed.content).to.not.include('AI Credits');
        expect(parsed.content).to.not.include('copilot --resume');

        const tools = parsed.segments.filter(s => s.type === 'tool');
        expect(tools.map(t => t.name)).to.deep.equal(['Grep', 'preview_start', 'preview_snapshot']);
        expect(tools[1].result).to.include('"status":"ready"');
        expect(tools[2].result).to.include('"httpStatus":200');
        expect(tools[2].result).to.include('[Image: [image/png] 1280x900]');

        const viaDispatcher = parseAgentLogForTranscript('copilot', log);
        expect(viaDispatcher.content).to.equal(parsed.content);
        expect(viaDispatcher.segments).to.have.lengthOf(4);
        expect(viaDispatcher.traceEvents.length).to.be.greaterThan(0);
        expect(resolveAgentLogDisplayText('copilot', log)).to.equal(parsed.content);
    });

    it('leaves plain Copilot prose untouched with no synthetic segments', () => {
        const plain = 'hello world\nsecond line\n';
        expect(parseCopilotFormattedLog(plain)).to.deep.equal({ content: 'hello world\nsecond line', segments: [] });
        expect(parseAgentLogForTranscript('copilot', plain)).to.deep.equal({
            content: 'hello world\nsecond line',
            segments: [],
            traceEvents: [],
        });
    });

    it('strips a trailing Copilot telemetry footer even when no tool calls occurred', () => {
        const log = [
            'All set.',
            '',
            'Changes    +0 -0',
            'AI Credits 0.05 (2s)',
            'Resume     copilot --resume=abc-123',
        ].join('\n');
        const parsed = parseCopilotFormattedLog(log);
        expect(parsed.content).to.equal('All set.');
        expect(parsed.segments).to.deep.equal([]);
    });
});
