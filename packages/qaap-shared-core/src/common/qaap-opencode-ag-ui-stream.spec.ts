// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapOpencodeAgUiStreamEmitter } from './qaap-opencode-ag-ui-stream';

describe('QaapOpencodeAgUiStreamEmitter', () => {
    it('maps tool_use and text JSON events to AG-UI events', () => {
        const emitter = new QaapOpencodeAgUiStreamEmitter();
        const events = emitter.push([
            '{"type":"tool_use","part":{"id":"p1","type":"tool","tool":"read","input":{"filePath":"a.ts"},"state":{"status":"completed","output":"ok"}}}',
            '{"type":"text","part":{"type":"text","text":"Done."}}',
        ].join('\n') + '\n');
        expect(events.some(event => event.type === 'TOOL_CALL_START' && event.toolCallId === 'p1')).to.equal(true);
        expect(events.some(event => event.type === 'TOOL_CALL_RESULT' && event.toolCallId === 'p1')).to.equal(true);
        expect(events.some(event => event.type === 'TEXT_MESSAGE_CONTENT')).to.equal(true);
    });

    it('maps reasoning events to REASONING_MESSAGE events', () => {
        const emitter = new QaapOpencodeAgUiStreamEmitter();
        const events = emitter.push('{"type":"reasoning","part":{"type":"reasoning","text":"plan step"}}\n');
        expect(events.map(event => event.type)).to.deep.equal(['REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT']);
    });
});
