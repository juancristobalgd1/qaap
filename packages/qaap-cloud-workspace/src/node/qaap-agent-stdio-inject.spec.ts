// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { EventEmitter } from 'events';
import { injectStdioUserMessageExtracted } from './qaap-agent-stdio-inject';

class FakeStdin extends EventEmitter {
    writable = true;
    destroyed = false;
    readonly writes: string[] = [];
    write(chunk: string): boolean {
        this.writes.push(chunk);
        return true;
    }
}

function host(overrides: {
    readonly stdio?: boolean;
    readonly pending?: boolean;
    readonly stdin?: FakeStdin | null;
} = {}): {
    readonly ctx: Parameters<typeof injectStdioUserMessageExtracted>[0];
    readonly stdin: FakeStdin | undefined;
} {
    const stdin = overrides.stdin === null
        ? undefined
        : (overrides.stdin ?? new FakeStdin());
    const processes = new Map();
    if (stdin) {
        processes.set('t1', { stdin } as never);
    }
    return {
        ctx: {
            qaiqStdioTasks: overrides.stdio === false ? new Set() : new Set(['t1']),
            processes,
            pendingQaiqControlRequests: new Map(overrides.pending ? [['t1', [{ requestId: 'r1' }]]] : []),
        },
        stdin,
    };
}

describe('injectStdioUserMessageExtracted', () => {

    it('writes a stream-json user line to a live QAIQ stdin pipe', () => {
        const { ctx, stdin } = host();
        expect(injectStdioUserMessageExtracted(ctx, 't1', '  also run the tests  ')).to.equal(true);
        expect(stdin?.writes).to.have.length(1);
        const parsed = JSON.parse(stdin!.writes[0]);
        expect(parsed.type).to.equal('user');
        expect(parsed.message).to.deep.equal({ role: 'user', content: 'also run the tests' });
        expect(stdin!.writes[0].endsWith('\n')).to.equal(true);
    });

    it('refuses agents that are not on the stream-json stdin protocol', () => {
        const { ctx, stdin } = host({ stdio: false });
        expect(injectStdioUserMessageExtracted(ctx, 't1', 'hello')).to.equal(false);
        expect(stdin?.writes).to.deep.equal([]);
    });

    it('refuses while a can_use_tool control request is unanswered', () => {
        const { ctx, stdin } = host({ pending: true });
        expect(injectStdioUserMessageExtracted(ctx, 't1', 'hello')).to.equal(false);
        expect(stdin?.writes).to.deep.equal([]);
    });

    it('refuses a closed or missing stdin', () => {
        const closed = new FakeStdin();
        closed.writable = false;
        expect(injectStdioUserMessageExtracted(host({ stdin: closed }).ctx, 't1', 'hello')).to.equal(false);
        expect(injectStdioUserMessageExtracted(host({ stdin: null }).ctx, 't1', 'hello')).to.equal(false);
        expect(injectStdioUserMessageExtracted(host().ctx, 't1', '   ')).to.equal(false);
    });
});
