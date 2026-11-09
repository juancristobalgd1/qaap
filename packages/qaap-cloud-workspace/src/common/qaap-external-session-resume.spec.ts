// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessage } from './qaap-agent-conversation';
import { applyQaapNativeResumeToCommand, resolveQaapExternalNativeResume } from './qaap-external-session-resume';

const SESSION = '3f1c2b9e-1111-4222-8333-944455556666';

function message(id: string, role: 'user' | 'agent', turnAgentId?: string): QaapAgentMessage {
    return { id, role, content: id, createdAt: 1, ...(turnAgentId ? { turnAgentId } : {}) };
}

describe('resolveQaapExternalNativeResume', () => {

    const imported = [message('u1', 'user', 'claude'), message('a1', 'agent')];
    const origin = { source: 'claude' as const, sessionId: SESSION, importedAt: 1, importedMessageCount: 2 };

    it('resumes the first turn after the import on the same CLI', () => {
        const conv = { externalSession: origin, messages: [...imported, message('u2', 'user', 'claude')] };
        expect(resolveQaapExternalNativeResume(conv, 'claude')).to.deep.equal({ source: 'claude', sessionId: SESSION });
    });

    it('keeps resuming while every later turn ran on that CLI', () => {
        const conv = {
            externalSession: origin,
            messages: [...imported, message('u2', 'user', 'claude'), message('a2', 'agent'), message('u3', 'user', 'claude')],
        };
        expect(resolveQaapExternalNativeResume(conv, 'Claude')?.sessionId).to.equal(SESSION);
    });

    it('replays the history on another harness, and for good once another harness took a turn', () => {
        const switched = { externalSession: origin, messages: [...imported, message('u2', 'user', 'codex')] };
        expect(resolveQaapExternalNativeResume(switched, 'codex')).to.equal(undefined);
        const back = { externalSession: origin, messages: [...switched.messages, message('a2', 'agent'), message('u3', 'user', 'claude')] };
        expect(resolveQaapExternalNativeResume(back, 'claude')).to.equal(undefined);
    });

    it('never resumes a conversation that was not imported, or a CLI without native resume', () => {
        expect(resolveQaapExternalNativeResume({ messages: [message('u1', 'user', 'claude')] }, 'claude')).to.equal(undefined);
        const pi = { externalSession: { ...origin, source: 'pi' as const }, messages: [...imported, message('u2', 'user', 'pi')] };
        expect(resolveQaapExternalNativeResume(pi, 'pi')).to.equal(undefined);
    });
});

describe('applyQaapNativeResumeToCommand', () => {

    it('adds --resume right after the claude binary', () => {
        expect(applyQaapNativeResumeToCommand('claude --print --output-format stream-json -p', 'claude', SESSION))
            .to.equal(`claude --resume ${SESSION} --print --output-format stream-json -p`);
        expect(applyQaapNativeResumeToCommand('/usr/local/bin/claude --print', 'claude', SESSION))
            .to.equal(`/usr/local/bin/claude --resume ${SESSION} --print`);
    });

    it('puts codex resume after the exec flags and keeps the stdin prompt dash', () => {
        expect(applyQaapNativeResumeToCommand('codex --full-auto exec --json -c check_for_update_on_startup=false -m gpt-5 -', 'codex', SESSION))
            .to.equal(`codex --full-auto exec --json -c check_for_update_on_startup=false -m gpt-5 resume ${SESSION} -`);
    });

    it('leaves other agents, unsafe ids and already-resumed commands alone', () => {
        expect(applyQaapNativeResumeToCommand('opencode run --format json', 'opencode', SESSION)).to.equal('opencode run --format json');
        expect(applyQaapNativeResumeToCommand('claude -p', 'claude', 'x; rm -rf /')).to.equal('claude -p');
        expect(applyQaapNativeResumeToCommand(`claude --resume ${SESSION} -p`, 'claude', SESSION)).to.equal(`claude --resume ${SESSION} -p`);
    });
});
