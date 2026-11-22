// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { classifyQaapAcpBridgeLine, isQaapAcpBridgeLog, QaapAcpSniffingStreamAccumulator } from './qaap-acp-bridge-stream';
import { filterQaiqStreamProcessLogLines } from './qaap-qaiq-stream';
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

    it('classifies a line by its JSON type, and says nothing about untyped or plain lines', () => {
        expect(classifyQaapAcpBridgeLine(JSON.stringify({ type: 'system', subtype: 'init', qaap_transport: 'acp' }))).to.equal('acp');
        for (const type of ['stream_event', 'assistant', 'user', 'result']) {
            expect(classifyQaapAcpBridgeLine(JSON.stringify({ type })), type).to.equal('acp');
        }
        for (const type of ['text', 'reasoning', 'tool_use', 'step_start', 'step_finish', 'error']) {
            expect(classifyQaapAcpBridgeLine(JSON.stringify({ type })), type).to.equal('native');
        }
        expect(classifyQaapAcpBridgeLine(JSON.stringify({ type: 'system', qaap_transport: 'native' }))).to.equal('native');
        expect(classifyQaapAcpBridgeLine('[qaap] note')).to.equal(undefined);
        expect(classifyQaapAcpBridgeLine('{"type":')).to.equal(undefined);
        expect(classifyQaapAcpBridgeLine('{"no":"type"}')).to.equal(undefined);
        expect(classifyQaapAcpBridgeLine('…(truncated)')).to.equal(undefined);
    });

    it('recognizes a bridge log whose init line was filtered out or whose head was truncated', () => {
        expect(isQaapAcpBridgeLog(`\n\n${BRIDGE_LOG}`)).to.equal(true);
        // The task log readers drop system/init lines.
        const filtered = filterQaiqStreamProcessLogLines(BRIDGE_LOG);
        expect(filtered).to.not.contain('qaap_transport');
        expect(isQaapAcpBridgeLog(filtered)).to.equal(true);
        // A large log is read from its tail.
        expect(isQaapAcpBridgeLog(`…(truncated)\n[qaap] note\n${BRIDGE_LOG.split('\n').slice(3).join('\n')}`)).to.equal(true);
        expect(isQaapAcpBridgeLog(NATIVE_OPENCODE_LOG)).to.equal(false);
        expect(isQaapAcpBridgeLog('plain text only')).to.equal(false);
        // Only the first typed line counts: a bridge-looking line later in a native log is agent content.
        expect(isQaapAcpBridgeLog(NATIVE_OPENCODE_LOG + BRIDGE_LOG)).to.equal(false);
    });

    it('parses a filtered bridge log of an OpenCode turn, live and on replay', () => {
        const filtered = filterQaiqStreamProcessLogLines(BRIDGE_LOG);
        const live = createAgentStreamAccumulator('opencode')!;
        live.push(filtered);
        expect(live.getSegments().map(segment => segment.type)).to.deep.equal(['text', 'tool']);
        expect(parseAgentLogForTranscript('opencode', filtered).content).to.contain('Hello from ACP');
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

    it('waits past plain-text lines, answering as the native reader meanwhile', () => {
        const sniffing = createAgentStreamAccumulator('opencode') as QaapAcpSniffingStreamAccumulator<QaapOpencodeStreamAccumulator>;
        expect(sniffing.push('[qaap] a note\nError: no provider')).to.deep.equal([]);
        const native = new QaapOpencodeStreamAccumulator();
        native.push('[qaap] a note\nError: no provider');
        expect(sniffing.getDisplayText()).to.equal(native.getDisplayText());
        sniffing.push('\n' + BRIDGE_LOG);
        expect(sniffing.isAcpBridge).to.equal(true);
        expect(sniffing.getDisplayText()).to.contain('Hello from ACP');
    });

    it('emits AG-UI events for a bridge log of an OpenCode turn', () => {
        const emitter = createAgUiCliStreamEmitter('opencode')!;
        const events = emitter.push(BRIDGE_LOG);
        expect(events.length).to.be.greaterThan(0);
        expect(JSON.stringify(events)).to.contain('Hello from ACP');
    });
});
