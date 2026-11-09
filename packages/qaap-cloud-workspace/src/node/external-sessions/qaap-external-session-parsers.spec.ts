// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// All fixtures are synthetic. Never paste real session logs into this file.

import type { QaapTranscriptTraceEventDTO } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';
import { expect } from 'chai';
import { QaapExternalClaudeSessionParser } from './qaap-external-claude-session-parser';
import { QaapExternalCodexSessionParser } from './qaap-external-codex-session-parser';
import {
    QaapExternalOpenCodeMessageRow,
    QaapExternalOpenCodePartRow,
    QaapExternalOpenCodeSessionParser,
    QaapExternalOpenCodeSessionRow
} from './qaap-external-opencode-session-parser';
import { QaapExternalPiSessionParser } from './qaap-external-pi-session-parser';
import type { QaapExternalJsonlParseOptions } from './qaap-external-session-parse-options';
import { QaapExternalImportedMessage, QaapExternalTranscriptBuilder } from './qaap-external-session-transcript';

type ToolCallEvent = Extract<QaapTranscriptTraceEventDTO, { type: 'tool_call' }>;

const FALLBACK_MS = Date.parse('2026-01-01T00:00:00.000Z');
const options: QaapExternalJsonlParseOptions = { fallbackSessionId: 'file-session', fallbackTimestampMs: FALLBACK_MS };

function jsonl(...entries: unknown[]): string[] {
    return entries.map(entry => JSON.stringify(entry));
}

function toolCalls(message: QaapExternalImportedMessage): ToolCallEvent[] {
    return (message.traceEvents ?? []).filter((event): event is ToolCallEvent => event.type === 'tool_call');
}

function eventTypes(message: QaapExternalImportedMessage): string[] {
    return (message.traceEvents ?? []).map(event => event.type);
}

describe('QaapExternalClaudeSessionParser', () => {

    const CWD = '/work/app';

    it('maps user text, assistant text, thoughts and a tool call with its failed result', () => {
        const transcript = QaapExternalClaudeSessionParser.parse(jsonl(
            { type: 'user', sessionId: 'c-1', cwd: CWD, timestamp: '2026-02-01T10:00:00.000Z', message: { role: 'user', content: 'Fix the build' } },
            {
                type: 'assistant', sessionId: 'c-1', timestamp: '2026-02-01T10:00:01.000Z',
                message: {
                    id: 'm1', content: [
                        { type: 'thinking', thinking: 'Looking at the config' },
                        { type: 'text', text: 'Let me check.' },
                        { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'npm run build' } },
                    ]
                }
            },
            {
                type: 'user', timestamp: '2026-02-01T10:00:02.000Z',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'Build failed', is_error: true }] }
            },
            { type: 'assistant', timestamp: '2026-02-01T10:00:03.000Z', message: { content: [{ type: 'text', text: 'The build failed.' }] } },
        ), options);

        expect(transcript).to.not.equal(undefined);
        const { messages } = transcript!;
        expect(messages).to.have.length(2);
        expect(messages[0]).to.include({ role: 'user', content: 'Fix the build' });
        expect(messages[0].createdAt).to.equal(Date.parse('2026-02-01T10:00:00.000Z'));
        expect(messages[1].role).to.equal('agent');
        expect(messages[1].content).to.equal('Let me check.\n\nThe build failed.');
        expect(eventTypes(messages[1])).to.deep.equal(['thought', 'assistant_text', 'tool_call', 'assistant_text']);
        expect(toolCalls(messages[1])).to.have.length(1);
        expect(toolCalls(messages[1])[0]).to.include({ id: 'tu-1', name: 'Bash', status: 'failed', result: 'Build failed' });
        expect(toolCalls(messages[1])[0].args).to.equal('{"command":"npm run build"}');
    });

    it('skips empty thinking, sidechain entries, meta entries and command or injected user text', () => {
        const transcript = QaapExternalClaudeSessionParser.parse(jsonl(
            { type: 'user', sessionId: 'c-2', cwd: CWD, isMeta: true, message: { role: 'user', content: 'Caveat: meta' } },
            { type: 'user', cwd: CWD, message: { role: 'user', content: '<command-name>/clear</command-name>' } },
            { type: 'user', message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' } },
            { type: 'user', message: { role: 'user', content: '<system-reminder>hint</system-reminder>' } },
            { type: 'user', isSidechain: true, message: { role: 'user', content: 'Sub-agent prompt' } },
            { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'Sub-agent answer' }] } },
            { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } },
            { type: 'attachment', message: { content: 'ignored' } },
            { type: 'user', message: { role: 'user', content: 'Real question' } },
        ), options);

        expect(transcript!.messages).to.have.length(1);
        expect(transcript!.messages[0]).to.include({ role: 'user', content: 'Real question' });
        expect(transcript!.header.firstUserMessage).to.equal('Real question');
    });

    it('takes the custom title over the AI title and the summary as fallback', () => {
        const withCustom = QaapExternalClaudeSessionParser.parse(jsonl(
            { type: 'user', cwd: CWD, message: { content: 'hi' } },
            { type: 'summary', summary: 'Summary' },
            { type: 'ai-title', aiTitle: 'AI one' },
            { type: 'custom-title', customTitle: 'Mine' },
            { type: 'ai-title', aiTitle: 'AI two' },
        ), options);
        expect(withCustom!.header.title).to.equal('Mine');

        const aiOnly = QaapExternalClaudeSessionParser.parse(jsonl(
            { type: 'user', cwd: CWD, message: { content: 'hi' } },
            { type: 'summary', summary: 'Summary' },
            { type: 'ai-title', title: 'AI one' },
            { type: 'ai-title', aiTitle: 'AI two' },
        ), options);
        expect(aiOnly!.header.title).to.equal('AI two');

        const summaryOnly = QaapExternalClaudeSessionParser.parse(jsonl(
            { type: 'user', cwd: CWD, message: { content: 'hi' } },
            { type: 'summary', summary: 'Summary' },
        ), options);
        expect(summaryOnly!.header.title).to.equal('Summary');
    });

    it('reads cwd, session id, timestamps and the QAAP marker from the log', () => {
        const transcript = QaapExternalClaudeSessionParser.parse(jsonl(
            { type: 'user', sessionId: 'claude-s9', cwd: CWD, timestamp: '2026-02-01T10:00:00.000Z', message: { content: '[QAAP task context]\nDo it' } },
            { type: 'assistant', timestamp: '2026-02-01T12:30:00.000Z', message: { content: [{ type: 'text', text: 'Done' }] } },
        ), options);

        expect(transcript!.header).to.include({
            sessionId: 'claude-s9',
            cwd: CWD,
            startedAt: Date.parse('2026-02-01T10:00:00.000Z'),
            updatedAt: Date.parse('2026-02-01T12:30:00.000Z'),
            startedByQaap: true,
        });
        expect(transcript!.header.firstUserMessage).to.contain('[QAAP task context]');
    });

    it('uses the file name and mtime when the log has no session id or timestamp', () => {
        const transcript = QaapExternalClaudeSessionParser.parse(jsonl(
            { type: 'user', cwd: CWD, message: { content: 'hi' } },
        ), options);

        expect(transcript!.header).to.include({ sessionId: 'file-session', startedAt: FALLBACK_MS, updatedAt: FALLBACK_MS, startedByQaap: false });
    });

    it('returns only the header when headerOnly is set', () => {
        const transcript = QaapExternalClaudeSessionParser.parse(jsonl(
            { type: 'user', sessionId: 'c-3', cwd: CWD, message: { content: 'Listing me' } },
            { type: 'assistant', message: { content: [{ type: 'text', text: 'Answer' }] } },
        ), { ...options, headerOnly: true });

        expect(transcript!.messages).to.deep.equal([]);
        expect(transcript!.header.firstUserMessage).to.equal('Listing me');
    });

    it('skips malformed lines', () => {
        const transcript = QaapExternalClaudeSessionParser.parse([
            '{"type":"user", broken',
            '',
            '42',
            ...jsonl({ type: 'user', cwd: CWD, message: { content: 'Still here' } }),
        ], options);

        expect(transcript!.messages).to.have.length(1);
        expect(transcript!.messages[0].content).to.equal('Still here');
    });

    it('returns undefined without a cwd', () => {
        expect(QaapExternalClaudeSessionParser.parse(jsonl({ type: 'user', message: { content: 'no cwd' } }), options)).to.equal(undefined);
    });
});

describe('QaapExternalCodexSessionParser', () => {

    const CWD = '/work/codex-app';

    it('maps user turns, reasoning, output text and tool calls with their outputs', () => {
        const transcript = QaapExternalCodexSessionParser.parse(jsonl(
            { timestamp: '2026-03-01T09:00:00.000Z', type: 'session_meta', payload: { id: 'cx-1', cwd: CWD, originator: 'codex_cli_rs', cli_version: '0.0.1' } },
            { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
            { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md injected' }] } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'List the files' } },
            { type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Plan: run ls' }], encrypted_content: 'opaque' } },
            { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['ls'] }), call_id: 'call-1' } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'Exit code: 2\nnope' } },
            { type: 'event_msg', payload: { type: 'agent_message', message: 'Duplicate of the reply below' } },
            { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Listing failed.' }] } },
        ), options);

        expect(transcript).to.not.equal(undefined);
        const { header, messages } = transcript!;
        expect(header).to.include({ sessionId: 'cx-1', cwd: CWD, originator: 'codex_cli_rs', title: '', firstUserMessage: 'List the files', startedByQaap: false });
        expect(messages).to.have.length(2);
        expect(messages[0]).to.include({ role: 'user', content: 'List the files' });
        expect(messages[1].role).to.equal('agent');
        expect(messages[1].content).to.equal('Listing failed.');
        expect(eventTypes(messages[1])).to.deep.equal(['thought', 'tool_call', 'assistant_text']);
        const [tool] = toolCalls(messages[1]);
        expect(tool).to.include({ id: 'call-1', name: 'shell', status: 'failed', result: 'Exit code: 2\nnope' });
        expect(tool.args).to.equal('{"command":["ls"]}');
    });

    it('keeps a prompt the user repeats after a reply as a new turn', () => {
        const transcript = QaapExternalCodexSessionParser.parse(jsonl(
            { type: 'session_meta', payload: { id: 'cx-3', cwd: CWD } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'continue' } },
            { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Step 1' }] } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'continue' } },
            { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Step 2' }] } },
        ), options);

        expect(transcript!.messages.map(message => message.content)).to.deep.equal(['continue', 'Step 1', 'continue', 'Step 2']);
    });

    it('keeps one user message when user_message and item_completed repeat the same turn', () => {
        const transcript = QaapExternalCodexSessionParser.parse(jsonl(
            { type: 'session_meta', payload: { id: 'cx-2', cwd: CWD } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'Same turn' } },
            { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'Same turn' }] } } },
            { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Reply' }] } },
            { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'Next turn' }] } } },
        ), options);

        expect(transcript!.messages.map(message => [message.role, message.content])).to.deep.equal([
            ['user', 'Same turn'],
            ['agent', 'Reply'],
            ['user', 'Next turn'],
        ]);
    });

    it('maps web searches, custom tool calls with object outputs and renames', () => {
        const transcript = QaapExternalCodexSessionParser.parse(jsonl(
            { type: 'session_meta', payload: { id: 'cx-3', cwd: CWD } },
            { type: 'event_msg', payload: { type: 'thread_renamed', name: 'Renamed thread' } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'Search and patch' } },
            { type: 'response_item', payload: { type: 'web_search_call', action: { query: 'qaap parser' } } },
            { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'patch-1', name: 'apply_patch', input: '*** Begin Patch' } },
            { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'patch-1', output: { content: 'patched', success: true } } },
        ), options);

        expect(transcript!.header.title).to.equal('Renamed thread');
        const [agent] = transcript!.messages.slice(1);
        const [search, patch] = toolCalls(agent);
        expect(search).to.include({ name: 'web_search', status: 'completed' });
        expect(search.args).to.equal('{"query":"qaap parser"}');
        expect(patch).to.include({ id: 'patch-1', name: 'apply_patch', status: 'completed', result: 'patched' });
        expect(patch.args).to.equal('*** Begin Patch');
    });

    it('drops non-user meta lines and returns only the header when headerOnly is set', () => {
        const transcript = QaapExternalCodexSessionParser.parse(jsonl(
            { timestamp: '2026-03-02T08:00:00.000Z', type: 'session_meta', payload: { id: 'cx-4', cwd: CWD, originator: 'T3 Code' } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'Header only' } },
            { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Reply' }] } },
        ), { ...options, headerOnly: true });

        expect(transcript!.messages).to.deep.equal([]);
        expect(transcript!.header).to.include({ originator: 'T3 Code', firstUserMessage: 'Header only', startedAt: Date.parse('2026-03-02T08:00:00.000Z') });
    });

    it('uses the file name when session_meta has no id, skips malformed lines, and returns undefined without cwd', () => {
        const transcript = QaapExternalCodexSessionParser.parse([
            '{not json',
            ...jsonl({ type: 'session_meta', payload: { cwd: CWD } }),
        ], options);
        expect(transcript!.header.sessionId).to.equal('file-session');
        expect(transcript!.header.originator).to.equal(undefined);

        expect(QaapExternalCodexSessionParser.parse(jsonl({ type: 'event_msg', payload: { type: 'user_message', message: 'x' } }), options)).to.equal(undefined);
    });
});

describe('QaapExternalPiSessionParser', () => {

    const CWD = '/work/pi-app';

    it('maps user text, assistant blocks and tool results', () => {
        const transcript = QaapExternalPiSessionParser.parse(jsonl(
            { type: 'session', id: 'pi-1', cwd: CWD, timestamp: '2026-04-01T09:00:00.000Z' },
            { type: 'session_info', name: 'Pi name' },
            { type: 'model_change', model: 'x' },
            { type: 'message', timestamp: '2026-04-01T09:00:01.000Z', message: { role: 'system', content: 'System prompt' } },
            { type: 'message', timestamp: '2026-04-01T09:00:02.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Add a test' }] } },
            {
                type: 'message', timestamp: '2026-04-01T09:00:03.000Z', message: {
                    role: 'assistant', content: [
                        { type: 'thinking', thinking: 'Plan' },
                        { type: 'text', text: 'On it.' },
                        { type: 'toolCall', id: 'pc-1', name: 'read', arguments: { path: 'a.ts' } },
                    ]
                }
            },
            { type: 'message', message: { role: 'toolResult', toolCallId: 'pc-1', toolName: 'read', content: [{ type: 'text', text: 'file body' }], isError: false } },
            { type: 'message', message: { role: 'toolResult', toolCallId: 'pc-2', toolName: 'bash', content: [{ type: 'text', text: 'boom' }], isError: true } },
        ), options);

        expect(transcript!.header).to.include({ sessionId: 'pi-1', cwd: CWD, title: 'Pi name', firstUserMessage: 'Add a test' });
        expect(transcript!.messages).to.have.length(2);
        expect(transcript!.messages[0]).to.include({ role: 'user', content: 'Add a test' });
        const agent = transcript!.messages[1];
        expect(agent.content).to.equal('On it.');
        expect(eventTypes(agent)).to.deep.equal(['thought', 'assistant_text', 'tool_call']);
        expect(toolCalls(agent)[0]).to.include({ id: 'pc-1', name: 'read', status: 'completed', result: 'file body' });
        expect(toolCalls(agent)[0].args).to.equal('{"path":"a.ts"}');
    });

    it('marks a tool result with isError as failed', () => {
        const transcript = QaapExternalPiSessionParser.parse(jsonl(
            { type: 'session', id: 'pi-2', cwd: CWD },
            { type: 'message', message: { role: 'user', content: 'Run it' } },
            { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'pc-9', name: 'bash', arguments: { command: 'false' } }] } },
            { type: 'message', message: { role: 'toolResult', toolCallId: 'pc-9', toolName: 'bash', content: [{ type: 'text', text: 'exit 1' }], isError: true } },
        ), options);

        expect(toolCalls(transcript!.messages[1])[0]).to.include({ status: 'failed', result: 'exit 1' });
    });

    it('returns only the header when headerOnly is set, and skips malformed lines', () => {
        const transcript = QaapExternalPiSessionParser.parse([
            '{broken',
            ...jsonl(
                { type: 'session', id: 'pi-3', cwd: CWD, timestamp: '2026-04-02T09:00:00.000Z' },
                { type: 'message', message: { role: 'user', content: 'Header me' } },
            ),
        ], { ...options, headerOnly: true });

        expect(transcript!.messages).to.deep.equal([]);
        expect(transcript!.header).to.include({ sessionId: 'pi-3', firstUserMessage: 'Header me', startedAt: Date.parse('2026-04-02T09:00:00.000Z') });
    });

    it('returns undefined without a cwd', () => {
        expect(QaapExternalPiSessionParser.parse(jsonl({ type: 'message', message: { role: 'user', content: 'x' } }), options)).to.equal(undefined);
    });
});

describe('QaapExternalOpenCodeSessionParser', () => {

    const session: QaapExternalOpenCodeSessionRow = {
        id: 'ses_1',
        directory: '/work/opencode-app',
        title: 'New session - 2026-11-08T23:18:17.004Z',
        timeCreated: 1000,
        timeUpdated: 5000,
    };

    const messages: QaapExternalOpenCodeMessageRow[] = [
        { id: 'msg_2', timeCreated: 2000, data: JSON.stringify({ role: 'assistant', time: { created: 2000 } }) },
        { id: 'msg_1', timeCreated: 1000, data: JSON.stringify({ role: 'user', time: { created: 1000 } }) },
    ];

    const parts: QaapExternalOpenCodePartRow[] = [
        { id: 'prt_1', messageId: 'msg_1', timeCreated: 1000, data: JSON.stringify({ type: 'text', text: 'Refactor the store' }) },
        { id: 'prt_2', messageId: 'msg_1', timeCreated: 1001, data: JSON.stringify({ type: 'text', text: '<injected>', synthetic: true }) },
        { id: 'prt_3', messageId: 'msg_2', timeCreated: 2000, data: JSON.stringify({ type: 'step-start' }) },
        { id: 'prt_4', messageId: 'msg_2', timeCreated: 2001, data: JSON.stringify({ type: 'reasoning', text: 'Need to read the file' }) },
        {
            id: 'prt_5', messageId: 'msg_2', timeCreated: 2002, data: JSON.stringify({
                type: 'tool', callID: 'call_1', tool: 'read', state: { status: 'completed', input: { filePath: 'store.ts' }, output: 'export const store' }
            })
        },
        {
            id: 'prt_6', messageId: 'msg_2', timeCreated: 2003, data: JSON.stringify({
                type: 'tool', callID: 'call_2', tool: 'bash', state: { status: 'error', input: { command: 'false' }, error: 'exit 1' }
            })
        },
        { id: 'prt_7', messageId: 'msg_2', timeCreated: 2004, data: JSON.stringify({ type: 'text', text: 'Done.' }) },
        {
            id: 'prt_8', messageId: 'msg_2', timeCreated: 2005, data: JSON.stringify({
                type: 'tool', callID: 'call_3', tool: 'bash', state: { status: 'running', input: { command: 'sleep 9' } }
            })
        },
    ];

    it('maps user text and assistant parts in order, with tool states', () => {
        const transcript = QaapExternalOpenCodeSessionParser.parse(session, messages, parts);

        expect(transcript.header).to.include({
            sessionId: 'ses_1',
            cwd: '/work/opencode-app',
            title: '',
            firstUserMessage: 'Refactor the store',
            startedAt: 1000,
            updatedAt: 5000,
            startedByQaap: false,
        });
        expect(transcript.messages.map(message => message.role)).to.deep.equal(['user', 'agent']);
        expect(transcript.messages[0]).to.include({ content: 'Refactor the store' });
        const agent = transcript.messages[1];
        expect(eventTypes(agent)).to.deep.equal(['thought', 'tool_call', 'tool_call', 'assistant_text', 'tool_call']);
        const [read, bash, running] = toolCalls(agent);
        expect(read).to.include({ id: 'call_1', name: 'read', status: 'completed', result: 'export const store' });
        expect(read.args).to.equal('{"filePath":"store.ts"}');
        expect(bash).to.include({ id: 'call_2', name: 'bash', status: 'failed', result: 'exit 1' });
        expect(running.result).to.equal(undefined);
        expect(agent.content).to.equal('Done.');
    });

    it('keeps a real session title, detects the QAAP marker and skips malformed part data', () => {
        const header = QaapExternalOpenCodeSessionParser.header({ ...session, title: 'Real title' }, '[QAAP task context]\nGo');
        expect(header.title).to.equal('Real title');
        expect(header.startedByQaap).to.equal(true);

        const transcript = QaapExternalOpenCodeSessionParser.parse(session, messages, [
            ...parts,
            { id: 'prt_0', messageId: 'msg_1', timeCreated: 999, data: '{bad json' },
        ]);
        expect(transcript.messages[0].content).to.equal('Refactor the store');
    });

    it('returns a placeholder title as empty', () => {
        expect(QaapExternalOpenCodeSessionParser.header(session, '').title).to.equal('');
    });
});

describe('QaapExternalTranscriptBuilder', () => {

    it('folds assistant items between two user turns into one agent message', () => {
        const builder = new QaapExternalTranscriptBuilder();
        builder.addUser('First question', 1);
        builder.addThought('Thinking', 2);
        builder.addAssistantText('Part one.', 2);
        builder.startTool('c1', 'read', { path: 'x' }, 3);
        builder.finishTool('c1', 'contents', false, 4);
        builder.addAssistantText('Part two.', 5);
        builder.addUser('Second question', 6);
        const messages = builder.build();

        expect(messages.map(message => message.role)).to.deep.equal(['user', 'agent', 'user']);
        expect(messages[1].content).to.equal('Part one.\n\nPart two.');
        expect(messages[1].createdAt).to.equal(2);
        expect(messages[1].finishedAt).to.equal(5);
        expect(messages[1].traceEvents).to.have.length(4);
        expect(messages[2].content).to.equal('Second question');
    });

    it('keeps the last messages and starts on a user turn', () => {
        const builder = new QaapExternalTranscriptBuilder();
        for (let index = 0; index < 5; index++) {
            builder.addUser(`q${index}`, index);
            builder.addAssistantText(`a${index}`, index);
        }
        const messages = builder.build(3);

        expect(messages.map(message => message.content)).to.deep.equal(['q4', 'a4']);
    });
});
