// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { emitsStreamJsonFinalResult, QaapAgentFinalResultWatcher } from './qaap-agent-final-result-watcher';

describe('QaapAgentFinalResultWatcher', () => {
    it('sees the final result even when it is split across chunks', () => {
        const watcher = new QaapAgentFinalResultWatcher();
        expect(watcher.push('{"type":"assistant","message":{"content":[{"type":"text","text":"Hola"}]}}\n{"type":"res')).to.equal(undefined);
        expect(watcher.push('ult","subtype":"success","is_error":false,"result":"Hola"}\n')).to.deep.equal({ isError: false });
        expect(watcher.result).to.deep.equal({ isError: false });
    });

    it('reports an error result', () => {
        const watcher = new QaapAgentFinalResultWatcher();
        expect(watcher.push('{"type":"result","subtype":"error_during_execution","is_error":true}\n')).to.deep.equal({ isError: true });
    });

    it('ignores text that only mentions a result', () => {
        const watcher = new QaapAgentFinalResultWatcher();
        expect(watcher.push('{"type":"assistant","message":{"content":[{"type":"text","text":"the \\"result\\" is 4"}]}}\n')).to.equal(undefined);
        expect(watcher.push('not json "result"\n')).to.equal(undefined);
    });

    it('applies to the Claude-style stream-json harnesses only', () => {
        expect(emitsStreamJsonFinalResult('claude')).to.equal(true);
        expect(emitsStreamJsonFinalResult('openclaude')).to.equal(true);
        expect(emitsStreamJsonFinalResult('codex')).to.equal(false);
        expect(emitsStreamJsonFinalResult(undefined)).to.equal(false);
    });
});
