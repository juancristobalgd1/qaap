// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { createAgentStreamAccumulator } from './qaap-cli-transcript-stream';
import {
    isPiJsonSessionHeaderLine,
    QaapPiStreamAccumulator,
    resolvePiJsonStreamAccumulator,
} from './qaap-pi-json-stream';
import type { QaapAgentMessageSegment } from './qaap-qaiq-stream';

function loadFixture(): string {
    return fs.readFileSync(path.resolve(__dirname, '../../test-resources/qaap-pi-json-stream.jsonl'), 'utf8');
}

function feedInChunks(accumulator: QaapPiStreamAccumulator, text: string, size: number): void {
    for (let offset = 0; offset < text.length; offset += size) {
        accumulator.push(text.slice(offset, offset + size));
    }
}

function parseFixture(): QaapPiStreamAccumulator {
    const accumulator = new QaapPiStreamAccumulator();
    accumulator.push(loadFixture());
    return accumulator;
}

describe('qaap-pi-json-stream', () => {

    describe('segments', () => {
        it('builds thinking, text, successful and failing tool segments in order', () => {
            const segments = parseFixture().getSegments();
            expect(segments).to.deep.equal([
                { type: 'thinking', content: 'The user wants a listing. I will run ls first.' },
                { type: 'text', content: 'I will list the files.' },
                {
                    type: 'tool',
                    toolUseId: 'call_bash_1',
                    name: 'Bash',
                    args: '{"command":"ls -la"}',
                    finished: true,
                    result: 'README.md\nsrc',
                },
                {
                    type: 'tool',
                    toolUseId: 'call_edit_2',
                    name: 'Edit',
                    args: '{"path":"src/app.ts","oldText":"teh","newText":"the"}',
                    finished: true,
                    result: 'Could not find "teh" in src/app.ts',
                    error: true,
                },
                { type: 'text', content: 'Fixed the typo in src/app.ts.' },
            ] as QaapAgentMessageSegment[]);
        });

        it('builds the same segments when the stream arrives in small chunks', () => {
            const whole = parseFixture().getSegments();
            const chunked = new QaapPiStreamAccumulator();
            feedInChunks(chunked, loadFixture(), 37);
            expect(chunked.getSegments()).to.deep.equal(whole);
        });

        it('lists finished and running tools in the display text', () => {
            const text = parseFixture().getDisplayText();
            expect(text).to.contain('[thinking] The user wants a listing.');
            expect(text).to.contain('[tool done] Bash');
            expect(text).to.contain('[tool done] Edit');
            expect(text).to.contain('Fixed the typo in src/app.ts.');
        });

        it('marks a tool still running until its execution ends', () => {
            const accumulator = new QaapPiStreamAccumulator();
            accumulator.push([
                '{"type":"session","version":3,"id":"s","timestamp":"2026-10-29T10:00:00.000Z","cwd":"/w"}',
                '{"type":"tool_execution_start","toolCallId":"call_x","toolName":"bash","args":{"command":"sleep 5"}}',
                '',
            ].join('\n'));
            expect(accumulator.getSegments()).to.deep.equal([{
                type: 'tool', toolUseId: 'call_x', name: 'Bash', args: '{"command":"sleep 5"}', finished: false,
            }]);
            expect(accumulator.getDisplayText()).to.equal('[tool running] Bash');
        });

        it('records the session header', () => {
            const accumulator = parseFixture();
            expect(accumulator.hasSessionHeader()).to.equal(true);
            expect(accumulator.consumedJsonEvents()).to.equal(true);
        });
    });

    describe('usage', () => {
        it('keeps the last cumulative value per turn instead of summing the updates', () => {
            const total = parseFixture().getTotalUsage();
            // Turn values: 100/40, 180/30, 220/60 with cacheRead 50 on the last turn only.
            expect(total).to.deep.equal({ inputTokens: 500, outputTokens: 130, cacheReadInputTokens: 50 });
        });

        it('sums the reported cost once per turn', () => {
            // 0.0030 + 0.0041 + 0.0060; summing every message_update would be far higher.
            expect(parseFixture().getReportedCostUsd()).to.be.closeTo(0.0131, 1e-9);
        });

        it('reports the latest turn as the turn usage', () => {
            expect(parseFixture().getTurnUsage()).to.deep.equal({
                inputTokens: 220,
                outputTokens: 60,
                cacheReadInputTokens: 50,
            });
        });

        it('does not add reasoning tokens, which Pi already includes in output', () => {
            const accumulator = new QaapPiStreamAccumulator();
            accumulator.push([
                '{"type":"session","version":3,"id":"s","timestamp":"2026-10-29T10:00:00.000Z","cwd":"/w"}',
                '{"type":"turn_start"}',
                '{"type":"message_end","message":{"role":"assistant","content":[],"usage":{"input":10,"output":50,"cacheRead":0,"cacheWrite":0,"reasoning":40,"totalTokens":60,"cost":{"total":0.001}}}}',
                '{"type":"turn_end","message":{"role":"assistant","content":[]}}',
                '',
            ].join('\n'));
            expect(accumulator.getTotalUsage()).to.deep.equal({ inputTokens: 10, outputTokens: 50 });
        });

        it('reports no usage or cost when Pi never reported any', () => {
            const accumulator = new QaapPiStreamAccumulator();
            accumulator.push('{"type":"session","version":3,"id":"s","timestamp":"2026-10-29T10:00:00.000Z","cwd":"/w"}\n');
            expect(accumulator.getTotalUsage()).to.equal(undefined);
            expect(accumulator.getTurnUsage()).to.equal(undefined);
            expect(accumulator.getReportedCostUsd()).to.equal(undefined);
        });
    });

    describe('dispatch', () => {
        it('uses the JSON accumulator only when the first line is the session header', () => {
            const fixtureHeader = loadFixture().split('\n')[0];
            expect(resolvePiJsonStreamAccumulator(`${fixtureHeader}\n`)).to.be.instanceOf(QaapPiStreamAccumulator);
            expect(resolvePiJsonStreamAccumulator(`\n\n  ${fixtureHeader}\n`)).to.be.instanceOf(QaapPiStreamAccumulator);
        });

        it('leaves plain-text Pi output on the existing path', () => {
            expect(resolvePiJsonStreamAccumulator('Hello from Pi\n')).to.equal(undefined);
            expect(resolvePiJsonStreamAccumulator('')).to.equal(undefined);
            expect(resolvePiJsonStreamAccumulator('\n   \n')).to.equal(undefined);
            expect(createAgentStreamAccumulator('pi')).to.be.instanceOf(QaapPiStreamAccumulator);
        });

        it('does not treat a JSON record that is not the session header as Pi JSON output', () => {
            expect(resolvePiJsonStreamAccumulator('{"type":"agent_start"}\n')).to.equal(undefined);
            expect(isPiJsonSessionHeaderLine('{"type":"agent_start"}')).to.equal(false);
            expect(isPiJsonSessionHeaderLine('not json')).to.equal(false);
        });

        it('ignores malformed JSON lines without failing the stream', () => {
            const accumulator = new QaapPiStreamAccumulator();
            accumulator.push('{"type":"session","version":3,"id":"s","timestamp":"t","cwd":"/w"}\n{broken\n');
            expect(accumulator.getSegments()).to.deep.equal([]);
            expect(accumulator.hasSessionHeader()).to.equal(true);
        });
    });
});
