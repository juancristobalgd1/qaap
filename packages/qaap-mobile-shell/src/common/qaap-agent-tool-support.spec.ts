// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    agentTurnLooksLikeToolCallEmittedAsText,
    looksLikeToolCallJsonText,
    qaiqModelSupportsToolCalls,
} from './qaap-agent-tool-support';

/** Real transcript text from a `tencent/hy3:free` agent turn (screenshot repro). */
const HUNYUAN_BASH_ARGS_TEXT = '{ "command": "ls -la", "description": "List all files in the current directory" }';

describe('qaap-agent-tool-support', () => {

    it('flags confirmed tool-less model families and stays optimistic for the rest', () => {
        expect(qaiqModelSupportsToolCalls('tencent/hy3:free')).to.be.false;
        expect(qaiqModelSupportsToolCalls('tencent/hy3')).to.be.false;
        expect(qaiqModelSupportsToolCalls(' tencent/hy3:free ')).to.be.false;
        expect(qaiqModelSupportsToolCalls('moonshotai/kimi-k2.6:free')).to.be.undefined;
        expect(qaiqModelSupportsToolCalls('claude-sonnet-5')).to.be.undefined;
        expect(qaiqModelSupportsToolCalls(undefined)).to.be.undefined;
        expect(qaiqModelSupportsToolCalls('')).to.be.undefined;
    });

    it('detects bare Bash arguments emitted as text (Hunyuan repro)', () => {
        expect(looksLikeToolCallJsonText(HUNYUAN_BASH_ARGS_TEXT)).to.be.true;
        expect(looksLikeToolCallJsonText('{"command":"npm test"}')).to.be.true;
    });

    it('detects wrapped tool calls and file-tool argument shapes', () => {
        expect(looksLikeToolCallJsonText('{"name": "Bash", "arguments": {"command": "ls"}}')).to.be.true;
        expect(looksLikeToolCallJsonText('{"tool": "Read", "input": {"file_path": "/x.ts"}}')).to.be.true;
        expect(looksLikeToolCallJsonText('{"file_path": "/a/b.ts", "old_string": "x", "new_string": "y"}')).to.be.true;
    });

    it('detects a tool call inside a single fenced code block', () => {
        expect(looksLikeToolCallJsonText('```json\n{ "command": "ls -la", "description": "List files" }\n```')).to.be.true;
        expect(looksLikeToolCallJsonText('```\n{"command": "pwd"}\n```')).to.be.true;
    });

    it('never flags ordinary answers, embedded JSON, or non-tool shapes', () => {
        expect(looksLikeToolCallJsonText('The tests pass. Run `ls -la` to see the files.')).to.be.false;
        expect(looksLikeToolCallJsonText('Here is the config you asked for: {"command": "ls"} — save it as run.json')).to.be.false;
        expect(looksLikeToolCallJsonText('{"result": "ok", "files": 12}')).to.be.false;
        expect(looksLikeToolCallJsonText('{"command": "ls", "unexpected_key": true}')).to.be.false;
        expect(looksLikeToolCallJsonText('[{"command": "ls"}]')).to.be.false;
        expect(looksLikeToolCallJsonText('{}')).to.be.false;
        expect(looksLikeToolCallJsonText('{"name": "Bash"}')).to.be.false;
        expect(looksLikeToolCallJsonText(undefined)).to.be.false;
        expect(looksLikeToolCallJsonText('')).to.be.false;
    });

    it('flags a settled turn whose only output is tool-call-shaped text', () => {
        expect(agentTurnLooksLikeToolCallEmittedAsText([
            { type: 'text', content: HUNYUAN_BASH_ARGS_TEXT },
        ])).to.be.true;
        expect(agentTurnLooksLikeToolCallEmittedAsText([
            { type: 'thinking', content: 'planning…' },
            { type: 'text', content: '{"command": "ls -la"}' },
        ])).to.be.true;
    });

    it('never flags turns that ran a real tool or answered with prose', () => {
        expect(agentTurnLooksLikeToolCallEmittedAsText([
            { type: 'tool', content: undefined },
            { type: 'text', content: HUNYUAN_BASH_ARGS_TEXT },
        ])).to.be.false;
        expect(agentTurnLooksLikeToolCallEmittedAsText([
            { type: 'text', content: 'Listed the files; everything looks fine.' },
        ])).to.be.false;
        expect(agentTurnLooksLikeToolCallEmittedAsText([])).to.be.false;
        expect(agentTurnLooksLikeToolCallEmittedAsText(undefined)).to.be.false;
    });
});
