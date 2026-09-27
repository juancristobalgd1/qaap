// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapQaiqAgUiStreamEmitter } from './qaap-qaiq-ag-ui-stream';

describe('QaapQaiqAgUiStreamEmitter', () => {
    it('maps stream_event text deltas to TEXT_MESSAGE events', () => {
        const emitter = new QaapQaiqAgUiStreamEmitter();
        const first = emitter.push('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}\n');
        expect(first.map(event => event.type)).to.deep.equal(['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT']);
        const second = emitter.push('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}}\n');
        expect(second).to.deep.equal([{
            type: 'TEXT_MESSAGE_CONTENT',
            messageId: first[0].messageId,
            delta: ' there',
        }]);
    });

    it('maps tool stream events to TOOL_CALL_START and TOOL_CALL_ARGS', () => {
        const emitter = new QaapQaiqAgUiStreamEmitter();
        const events = emitter.push([
            '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu-edit","name":"Edit","input":{}}}}',
            '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"file_path\\":\\"src/"}}}',
            '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"config.ts\\"}"}}}',
        ].join('\n') + '\n');
        expect(events.filter(event => event.type === 'TOOL_CALL_START')).to.have.length(1);
        expect(events.filter(event => event.type === 'TOOL_CALL_ARGS')).to.have.length(2);
    });

    it('maps assistant tool_use and user tool_result to TOOL_CALL_RESULT and TOOL_CALL_END', () => {
        const emitter = new QaapQaiqAgUiStreamEmitter();
        emitter.push('{"type":"assistant","timestamp_ms":1,"message":{"content":[{"type":"tool_use","id":"tu1","name":"bash","input":{"command":"ls"}}]}}\n');
        const events = emitter.push('{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":"file.ts"}]}}\n');
        expect(events).to.deep.equal([
            { type: 'TOOL_CALL_RESULT', toolCallId: 'tu1', result: 'file.ts' },
            { type: 'TOOL_CALL_END', toolCallId: 'tu1' },
        ]);
    });

    it('skips duplicate timestamped assistant text after stream_event deltas', () => {
        const emitter = new QaapQaiqAgUiStreamEmitter();
        const reply = '¡Hola! Estoy bien.';
        emitter.push(`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(reply)}}}}\n`);
        const snapshot = emitter.push(`{"type":"assistant","timestamp_ms":2,"message":{"content":[{"type":"text","text":${JSON.stringify(reply)}}]}}\n`);
        expect(snapshot.some(event => event.type === 'TEXT_MESSAGE_START')).to.equal(false);
    });

    it('maps successful result text to an immediate final TEXT_MESSAGE', () => {
        const emitter = new QaapQaiqAgUiStreamEmitter();
        const result = 'He creado la landing page y ejecuté la verificación.';

        const events = emitter.push(`{"type":"result","result":${JSON.stringify(result)}}\n`);

        expect(events).to.deep.equal([
            { type: 'TEXT_MESSAGE_START', messageId: events[0].messageId },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: events[0].messageId, delta: result },
            { type: 'TEXT_MESSAGE_END', messageId: events[0].messageId },
        ]);
    });

    it('uses successful result text to finish a partial streamed answer', () => {
        const emitter = new QaapQaiqAgUiStreamEmitter();
        const first = emitter.push('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"He creado"}}}\n');

        const events = emitter.push('{"type":"result","result":"He creado la landing page."}\n');

        expect(events).to.deep.equal([
            { type: 'TEXT_MESSAGE_CONTENT', messageId: first[0].messageId, delta: ' la landing page.' },
            { type: 'TEXT_MESSAGE_END', messageId: first[0].messageId },
        ]);
    });

    it('does not duplicate a result already delivered by a closed text block', () => {
        const emitter = new QaapQaiqAgUiStreamEmitter();
        const result = 'Resumen final.';
        emitter.push([
            '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text"}}}',
            `{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(result)}}}}`,
            '{"type":"stream_event","event":{"type":"content_block_stop","index":0}}',
        ].join('\n') + '\n');

        const events = emitter.push(`{"type":"result","result":${JSON.stringify(result)}}\n`);

        expect(events).to.deep.equal([]);
    });
});
