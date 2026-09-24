// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAntigravityAgUiStreamEmitter } from './qaap-antigravity-ag-ui-stream';

describe('QaapAntigravityAgUiStreamEmitter', () => {
    it('uses stream-json AG-UI events when NDJSON envelopes are present', () => {
        const emitter = new QaapAntigravityAgUiStreamEmitter();
        const events = emitter.push('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}\n');
        expect(events.some(event => event.type === 'TEXT_MESSAGE_START')).to.equal(true);
        expect(events.some(event => event.type === 'TEXT_MESSAGE_CONTENT' && event.delta === 'Hi')).to.equal(true);
    });

    it('falls back to formatted tool and text lines when JSON is absent', () => {
        const emitter = new QaapAntigravityAgUiStreamEmitter();
        const events = emitter.push([
            '→ Read src/index.ts',
            '',
            'Summary line.',
        ].join('\n') + '\n');
        expect(events.some(event => event.type === 'TOOL_CALL_START')).to.equal(true);
        expect(events.some(event => event.type === 'TEXT_MESSAGE_CONTENT' && event.delta === 'Summary line.\n')).to.equal(true);
    });

    it('ignores formatted lines after stream-json mode is detected', () => {
        const emitter = new QaapAntigravityAgUiStreamEmitter();
        emitter.push('{"type":"system","subtype":"init"}\n');
        const events = emitter.push('→ Read src/index.ts\n');
        expect(events).to.deep.equal([]);
    });
});
