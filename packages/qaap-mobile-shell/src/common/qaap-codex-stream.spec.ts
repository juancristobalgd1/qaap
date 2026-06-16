// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapCodexStreamAccumulator, parseCodexLog } from './qaap-codex-stream';

describe('QaapCodexStreamAccumulator', () => {
    it('parses codex exec --json agent_message and command_execution items', () => {
        const acc = new QaapCodexStreamAccumulator();
        acc.push([
            '{"type":"thread.started","thread_id":"t1"}',
            '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Done."}}',
            '{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"npm test","output":"ok"}}',
        ].join('\n') + '\n');
        expect(acc.getSegments()).to.deep.equal([
            { type: 'text', content: 'Done.' },
            {
                type: 'tool',
                toolUseId: 'item_2',
                name: 'Bash',
                args: '{"command":"npm test"}',
                finished: true,
                result: 'ok',
            },
        ]);
    });

    it('parseCodexLog returns segments for JSON logs', () => {
        const parsed = parseCodexLog('{"type":"item.completed","item":{"id":"a1","type":"assistant_message","text":"Hi"}}\n');
        expect(parsed.segments).to.deep.equal([{ type: 'text', content: 'Hi' }]);
    });

    it('tracks nested subagent tools via collab_tool_call spawn_agent', () => {
        const acc = new QaapCodexStreamAccumulator();
        acc.push([
            '{"type":"item.completed","item":{"id":"agent-1","type":"collab_tool_call","tool":"spawn_agent","prompt":"Review auth"}}',
            '{"type":"item.completed","item":{"id":"read-1","type":"command_execution","command":"cat auth.ts","output":"ok","parent_tool_use_id":"agent-1"}}',
        ].join('\n') + '\n');
        expect(acc.getSegments()).to.deep.equal([
            {
                type: 'tool',
                toolUseId: 'agent-1',
                name: 'Agent',
                args: '{"type":"collab_tool_call"}',
                finished: true,
            },
            {
                type: 'tool',
                toolUseId: 'read-1',
                name: 'Bash',
                args: '{"command":"cat auth.ts"}',
                finished: true,
                result: 'ok',
                parentToolUseId: 'agent-1',
            },
        ]);
    });
});
