// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapAcpBridgeLog, isQaapAcpBridgeLogLine, QaapAcpSniffingStreamAccumulator } from './qaap-acp-bridge-stream';
import { createAgUiCliStreamEmitter } from './qaap-cli-ag-ui-stream';
import { createAgentStreamAccumulator, parseAgentLogForTranscript } from './qaap-cli-transcript-stream';
import { QaapOpencodeStreamAccumulator } from './qaap-opencode-stream';

const BRIDGE_LOG = [
    { type: 'system', subtype: 'init', qaap_transport: 'acp', flavor: 'opencode' },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello from ACP' } } },
    { type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Hello from ACP' }] } },
    { type: 'assistant', message: { id: 'acp-tool-c1', role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'a.txt', is_error: false }] } },
    { type: 'result', subtype: 'success', is_error: false, result: '', usage: { input_tokens: 10, output_tokens: 2 } },
].map(line => JSON.stringify(line)).join('\n') + '\n';

const NATIVE_OPENCODE_LOG = [
    { type: 'text', part: { type: 'text', text: 'Hello natively', time: { end: 1 } } },
].map(line => JSON.stringify(line)).join('\n') + '\n';

describe('qaap-acp-bridge-stream', () => {

    it('recognizes only the bridge init line', () => {
        expect(isQaapAcpBridgeLogLine(JSON.stringify({ type: 'system', subtype: 'init', qaap_transport: 'acp' }))).to.equal(true);
        expect(isQaapAcpBridgeLogLine(JSON.stringify({ type: 'system', qaap_transport: 'native' }))).to.equal(false);
        expect(isQaapAcpBridgeLogLine(JSON.stringify({ type: 'text', qaap_transport: 'acp' }))).to.equal(false);
        expect(isQaapAcpBridgeLogLine('qaap_transport acp')).to.equal(false);
        expect(isQaapAcpBridgeLogLine('{"qaap_transport":"acp"')).to.equal(false);
        expect(isQaapAcpBridgeLog(`\n\n${BRIDGE_LOG}`)).to.equal(true);
        expect(isQaapAcpBridgeLog(NATIVE_OPENCODE_LOG)).to.equal(false);
        // Only the first line counts: a bridge line later in a native log is agent content.
        expect(isQaapAcpBridgeLog(NATIVE_OPENCODE_LOG + BRIDGE_LOG)).to.equal(false);
    });

    it('parses a bridge log of an OpenCode turn with the Claude parser, live and on replay', () => {
        const live = createAgentStreamAccumulator('opencode')!;
        // Split in the middle of the first line: nothing is decided before it is complete.
        expect(live.push(BRIDGE_LOG.slice(0, 20))).to.deep.equal([]);
        live.push(BRIDGE_LOG.slice(20));
        const types = live.getSegments().map(segment => segment.type);
        expect(types).to.deep.equal(['text', 'tool']);
        expect(live.getTurnUsage?.()).to.deep.include({ inputTokens: 10, outputTokens: 2 });

        const replayed = parseAgentLogForTranscript('opencode', BRIDGE_LOG);
        expect(replayed.segments.map(segment => segment.type)).to.deep.equal(['text', 'tool']);
        expect(replayed.content).to.contain('Hello from ACP');
    });

    it('keeps the native OpenCode parser for a native log', () => {
        const sniffing = createAgentStreamAccumulator('opencode') as QaapAcpSniffingStreamAccumulator<QaapOpencodeStreamAccumulator>;
        sniffing.push(NATIVE_OPENCODE_LOG);
        expect(sniffing.isAcpBridge).to.equal(false);
        const native = new QaapOpencodeStreamAccumulator();
        native.push(NATIVE_OPENCODE_LOG);
        expect(sniffing.getSegments()).to.deep.equal(native.getSegments());
        expect(sniffing.getDisplayText()).to.equal(native.getDisplayText());
        expect(parseAgentLogForTranscript('opencode', NATIVE_OPENCODE_LOG).content).to.equal(native.getDisplayText());
    });

    it('decides on a first chunk of plain text without waiting for a newline', () => {
        const sniffing = createAgentStreamAccumulator('opencode') as QaapAcpSniffingStreamAccumulator<QaapOpencodeStreamAccumulator>;
        sniffing.push('Error: no provider');
        expect(sniffing.isAcpBridge).to.equal(false);
    });

    it('emits AG-UI events for a bridge log of an OpenCode turn', () => {
        const emitter = createAgUiCliStreamEmitter('opencode')!;
        const events = emitter.push(BRIDGE_LOG);
        expect(events.length).to.be.greaterThan(0);
        expect(JSON.stringify(events)).to.contain('Hello from ACP');
    });
});
