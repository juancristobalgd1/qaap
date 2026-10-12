// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectsConversations } from './mobile-projects-conversations';

class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    readyState = 0;
    readonly sent: unknown[] = [];
    protected readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
    constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
    addEventListener(type: string, listener: (ev: unknown) => void): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    send(data: string): void { this.sent.push(JSON.parse(data)); }
    close(): void { this.readyState = 3; this.emit('close', {}); }
    open(): void { this.readyState = 1; this.emit('open', {}); }
    receive(payload: unknown): void { this.emit('message', { data: JSON.stringify(payload) }); }
    protected emit(type: string, ev: unknown): void { (this.listeners.get(type) ?? []).forEach(l => l(ev)); }
}

const summary = (id: string, title: string, updatedAt = 1): QaapAgentConversationSummaryDTO => ({
    id, cwd: '/workspace/project', agentId: 'qaiq', title, status: 'idle', createdAt: 1, updatedAt, messageCount: 0,
} as QaapAgentConversationSummaryDTO);

describe('MobileProjectsConversations live transport', () => {
    let disableJSDOM: (() => void) | undefined;
    let ctor: typeof MobileProjectsConversations;
    let originalWebSocket: unknown;

    before(() => {
        disableJSDOM = enableJSDOM();
        ctor = require('./mobile-projects-conversations').MobileProjectsConversations;
    });
    after(() => disableJSDOM?.());

    beforeEach(() => {
        FakeWebSocket.instances = [];
        originalWebSocket = (global as unknown as { WebSocket?: unknown }).WebSocket;
        (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
        (window as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
        try { window.sessionStorage.clear(); window.localStorage.clear(); } catch { /* storage unavailable */ }
    });
    afterEach(() => {
        (global as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
        (window as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
    });

    it('v1 (qaap.liveV2=0): plain socket path, snapshot applied, frames dispatched unfiltered', () => {
        window.sessionStorage.setItem('qaap.liveV2', '0');
        const conversations = new ctor();
        conversations.openWebSocket();
        const socket = FakeWebSocket.instances[0];
        expect(socket.url).to.not.contain('v=2');
        expect(conversations.liveFeed).to.equal(undefined);
        socket.open();
        expect(socket.sent).to.deep.equal([]); // no hello in v1
        socket.receive({ type: 'snapshot', groups: [{ cwd: '/workspace/project', conversations: [summary('a', 'A')] }] });
        expect(conversations.findSummaryById('a')?.title).to.equal('A');
        expect(conversations.snapshotState).to.equal('ready');
        // v1 frames carry no seq: a repeated / "older" frame is applied again, exactly as before.
        socket.receive({ type: 'updated', conversation: summary('a', 'A2', 5) });
        socket.receive({ type: 'updated', conversation: summary('a', 'A3', 6) });
        expect(conversations.findSummaryById('a')?.title).to.equal('A3');
    });

    it('v1: focusThread is a no-op and nothing is sent', () => {
        window.sessionStorage.setItem('qaap.liveV2', '0');
        const conversations = new ctor();
        conversations.openWebSocket();
        const socket = FakeWebSocket.instances[0];
        socket.open();
        conversations.focusThread('a').dispose();
        expect(socket.sent).to.deep.equal([]);
    });

    it('v2 (default): connects with ?v=2, says hello, applies resync, drops frames at or below the cursor', () => {
        const conversations = new ctor();
        conversations.openWebSocket();
        const socket = FakeWebSocket.instances[0];
        expect(socket.url).to.contain('?v=2');
        socket.open();
        expect(socket.sent[0]).to.deep.equal({ op: 'hello', focus: [] });
        socket.receive({ type: 'resync', epoch: 'boot-1', seq: 10, groups: [{ cwd: '/workspace/project', conversations: [summary('a', 'A')] }] });
        expect(conversations.findSummaryById('a')?.title).to.equal('A');
        expect(JSON.parse(window.sessionStorage.getItem('qaap.liveCursor')!)).to.deep.equal({ epoch: 'boot-1', lastSeq: 10 });
        socket.receive({ type: 'updated', conversation: summary('a', 'old', 5), seq: 10 });
        expect(conversations.findSummaryById('a')?.title).to.equal('A');
        socket.receive({ type: 'updated', conversation: summary('a', 'new', 6), seq: 11 });
        expect(conversations.findSummaryById('a')?.title).to.equal('new');
        // reconnect resumes from the cursor
        socket.close();
        conversations.openWebSocket();
        const second = FakeWebSocket.instances[1];
        second.open();
        expect(second.sent[0]).to.deep.equal({ op: 'hello', epoch: 'boot-1', lastSeq: 11, focus: [] });
    });

    it('v2: focusThread sends focus after the document cut and unfocus on dispose', () => {
        const conversations = new ctor();
        conversations.openWebSocket();
        const socket = FakeWebSocket.instances[0];
        socket.open();
        socket.receive({ type: 'resync', epoch: 'boot-1', seq: 10, groups: [] });
        conversations.cacheDocument({ id: 'a', cwd: '/workspace/project', agentId: 'qaiq', title: 'A', status: 'idle', createdAt: 1, updatedAt: 1, messages: [], epoch: 'boot-1', seq: 9 } as never);
        const focus = conversations.focusThread('a');
        expect(socket.sent.at(-1)).to.deep.equal({ op: 'focus', id: 'a', sinceSeq: 9, epoch: 'boot-1' });
        focus.dispose();
        expect(socket.sent.at(-1)).to.deep.equal({ op: 'unfocus', id: 'a' });
    });
});
