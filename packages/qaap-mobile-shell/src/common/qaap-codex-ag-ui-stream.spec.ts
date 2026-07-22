// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapCodexAgUiStreamEmitter } from './qaap-codex-ag-ui-stream';

describe('QaapCodexAgUiStreamEmitter', () => {
    it('maps agent_message and command_execution items to AG-UI events', () => {
        const emitter = new QaapCodexAgUiStreamEmitter();
        const events = emitter.push([
            '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Done."}}',
            '{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"npm test","output":"ok"}}',
        ].join('\n') + '\n');
        expect(events.some(event => event.type === 'TEXT_MESSAGE_START')).to.equal(true);
        expect(events.some(event => event.type === 'TEXT_MESSAGE_CONTENT' && event.delta === 'Done.')).to.equal(true);
        expect(events.some(event => event.type === 'TOOL_CALL_START' && event.toolCallId === 'item_2')).to.equal(true);
        expect(events.some(event => event.type === 'TOOL_CALL_RESULT' && event.toolCallId === 'item_2' && event.result === 'ok')).to.equal(true);
        expect(events.some(event => event.type === 'TOOL_CALL_END' && event.toolCallId === 'item_2')).to.equal(true);
    });

    it('maps command_execution aggregated_output to TOOL_CALL_RESULT (Codex ThreadItem)', () => {
        const emitter = new QaapCodexAgUiStreamEmitter();
        const events = emitter.push(
            '{"type":"item.completed","item":{"id":"item_34","type":"command_execution","command":"pnpm run dev","status":"completed","exit_code":0,"aggregated_output":"VITE v6 ready\\n  ➜  Local: http://localhost:5173/"}}\n',
        );
        expect(events.some(event => event.type === 'TOOL_CALL_START' && event.toolCallId === 'item_34')).to.equal(true);
        expect(events.some(event =>
            event.type === 'TOOL_CALL_RESULT'
            && event.toolCallId === 'item_34'
            && typeof event.result === 'string'
            && event.result.includes('Local: http://localhost:5173/')
        )).to.equal(true);
        expect(events.some(event => event.type === 'TOOL_CALL_END' && event.toolCallId === 'item_34')).to.equal(true);
    });

    it('maps codex msg.text stream chunks to TEXT_MESSAGE events', () => {
        const emitter = new QaapCodexAgUiStreamEmitter();
        const events = emitter.push('{"type":"message","msg":{"type":"text","content":"Hi"}}\n');
        expect(events.map(event => event.type)).to.deep.equal(['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT']);
    });
});
