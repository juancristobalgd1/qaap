// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The delegation MCP shim (`resources/qaap-delegate-mcp.mjs`), spawned as a child process against a fake
 * Qaaq backend (node:http on 127.0.0.1, port 0). The drift guard compares the constants the dependency-free
 * shim duplicates with the protocol module.
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import * as protocol from '../common/qaap-agent-delegation-protocol';
import { importQaapDelegateShim, startQaapDelegateShim, type QaapShimMessage } from './test/qaap-delegate-mcp-client';

const TOKEN = 'test-token-do-not-log-0123';

interface ReceivedRequest {
    readonly method?: string;
    readonly url?: string;
    readonly headers: http.IncomingHttpHeaders;
    readonly body: unknown;
    readonly res: http.ServerResponse;
}
type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const respondJson = (status: number, payload: unknown): Handler => (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('qaap-delegate-mcp drift guard', () => {

    it('duplicated constants equal the protocol', async () => {
        const shim = await importQaapDelegateShim();
        expect({ ...(shim.DELEGATION_TOOLS as object) }).to.deep.equal({ ...protocol.QAAP_AGENT_DELEGATION_TOOLS });
        expect({ ...(shim.DELEGATION_ROUTES as object) }).to.deep.equal({ ...protocol.QAAP_AGENT_DELEGATION_ROUTES });
        expect(shim.DELEGATION_API_PATH).to.equal(protocol.QAAP_AGENT_DELEGATION_API_PATH);
        expect(shim.DELEGATION_TOKEN_HEADER).to.equal(protocol.QAAP_AGENT_DELEGATION_TOKEN_HEADER);
        expect(shim.DELEGATION_URL_ENV).to.equal(protocol.QAAP_AGENT_DELEGATION_URL_ENV);
        expect(shim.DELEGATION_TOKEN_ENV).to.equal(protocol.QAAP_AGENT_DELEGATION_TOKEN_ENV);
        expect(shim.DELEGATION_TOKEN_FILE_ENV).to.equal(protocol.QAAP_AGENT_DELEGATION_TOKEN_FILE_ENV);
        expect(shim.DELEGATION_SERVER_NAME).to.equal(protocol.QAAP_AGENT_DELEGATION_MCP_SERVER_NAME);
        expect(shim.DELEGATION_WAIT_MAX_SEC).to.equal(protocol.QAAP_AGENT_DELEGATION_WAIT_MAX_SEC);
        expect(shim.DELEGATION_HEARTBEAT_SEC).to.equal(protocol.QAAP_AGENT_DELEGATION_HEARTBEAT_SEC);
        expect(typeof shim.createQaapDelegateServer, 'importing must not start the stdio loop').to.equal('function');
    });
});

describe('qaap-delegate-mcp over stdio', function (): void {
    this.timeout(15_000);
    let backend: http.Server;
    let handler: Handler = respondJson(500, {});
    let received: ReceivedRequest[];
    let baseUrl: string;

    before(async () => {
        received = [];
        backend = http.createServer((req, res) => {
            let body = '';
            req.setEncoding('utf8');
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                received.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined, res });
                handler(req, res);
            });
        });
        await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
    });

    after(async () => {
        backend.closeAllConnections();
        await new Promise(resolve => backend.close(resolve));
    });

    const configuredEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
        [protocol.QAAP_AGENT_DELEGATION_URL_ENV]: baseUrl,
        [protocol.QAAP_AGENT_DELEGATION_TOKEN_ENV]: TOKEN,
        ...extra,
    });
    const progressOf = (messages: QaapShimMessage[]): QaapShimMessage[] => messages.filter(message => message.method === 'notifications/progress');

    it('initialize echoes a supported protocol version and falls back for an unknown one', async () => {
        const shim = startQaapDelegateShim({});
        try {
            const supported = await shim.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
            expect(supported.result.protocolVersion).to.equal('2025-03-26');
            expect(supported.result.capabilities).to.deep.equal({ tools: {} });
            expect(supported.result.serverInfo.name).to.equal('qaaq');
            expect((await shim.request('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).to.equal('2025-06-18');
            expect((await shim.request('ping')).result).to.deep.equal({});
            expect((await shim.request('resources/list')).error.code).to.equal(-32601);
            shim.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            const count = shim.messages.length;
            await shim.request('ping');
            expect(shim.messages.length, 'a notification gets no reply').to.equal(count + 1);
        } finally {
            await shim.close();
        }
    });

    it('tools/list returns exactly the five protocol tools with strict schemas', async () => {
        const shim = startQaapDelegateShim({});
        try {
            const tools = (await shim.request('tools/list')).result.tools as QaapShimMessage[];
            expect(tools.map(tool => tool.name).sort()).to.deep.equal(Object.keys(protocol.QAAP_AGENT_DELEGATION_TOOLS).sort());
            for (const tool of tools) {
                expect(tool.description.length, `${tool.name} needs a description`).to.be.greaterThan(80);
                expect(tool.inputSchema.type).to.equal('object');
                expect(tool.inputSchema.additionalProperties).to.equal(false);
            }
            const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
            expect(byName.qaaq_delegate.inputSchema.required).to.deep.equal(['prompt']);
            expect(byName.qaaq_delegate.inputSchema.properties.isolation.enum).to.deep.equal(['worktree', 'readonly']);
            expect(byName.qaaq_task_wait.inputSchema.properties.mode.enum).to.deep.equal(['any', 'all']);
            expect(byName.qaaq_task_cancel.inputSchema.required).to.deep.equal(['childId']);
            expect(byName.qaaq_child_apply.inputSchema.properties.mode.enum).to.deep.equal(['apply', 'merge']);
            expect(byName.qaaq_task_status.inputSchema.required).to.equal(undefined);
        } finally {
            await shim.close();
        }
    });

    it('forwards each tool to its route with the token header and JSON body', async () => {
        const shim = startQaapDelegateShim(configuredEnv());
        const cases: [string, Record<string, unknown>, string, unknown][] = [
            ['qaaq_delegate', { prompt: 'Explore the parser', isolation: 'readonly' }, '/delegate', { child: { childId: 'c1', state: 'queued' } }],
            ['qaaq_task_wait', { childIds: ['c1'], mode: 'all', timeoutSec: 1 }, '/wait', { finished: [], pending: [], timedOut: true, totals: {} }],
            ['qaaq_task_status', {}, '/status', { children: [], totals: {} }],
            ['qaaq_task_cancel', { childId: 'c1' }, '/cancel', { child: { childId: 'c1', state: 'cancelled' } }],
            ['qaaq_child_apply', { childId: 'c1' }, '/child-apply', { ok: true, mode: 'apply', files: ['a.ts'], conflicts: [] }],
            ['qaaq_list_agents', {}, '/list-agents', { agents: [{ agent: 'codex', selectable: true, models: [] }] }],
        ];
        try {
            for (const [name, args, route, payload] of cases) {
                handler = respondJson(200, payload);
                const count = received.length;
                const reply = await shim.request('tools/call', { name, arguments: args });
                expect(reply.result.isError, `${name} must not be an error`).to.equal(undefined);
                expect(reply.result.content[0].type).to.equal('text');
                expect(JSON.parse(reply.result.content[0].text)).to.deep.equal(payload);
                expect(received.length).to.equal(count + 1);
                const request = received[received.length - 1];
                expect(request.method).to.equal('POST');
                expect(request.url).to.equal(`${protocol.QAAP_AGENT_DELEGATION_API_PATH}${route}`);
                expect(request.headers[protocol.QAAP_AGENT_DELEGATION_TOKEN_HEADER]).to.equal(TOKEN);
                expect(request.headers['content-type']).to.match(/application\/json/);
                expect(request.body).to.deep.equal(args);
            }
        } finally {
            await shim.close();
        }
    });

    it('reads the token from QAAP_DELEGATION_TOKEN_FILE when the env holds none, and prefers the env token', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-shim-token-'));
        const file = path.join(dir, 'token');
        fs.writeFileSync(file, `${TOKEN}-from-file\n`, { mode: 0o600 });
        try {
            for (const [env, expected] of [
                [{ [protocol.QAAP_AGENT_DELEGATION_URL_ENV]: baseUrl, [protocol.QAAP_AGENT_DELEGATION_TOKEN_FILE_ENV]: file }, `${TOKEN}-from-file`],
                [configuredEnv({ [protocol.QAAP_AGENT_DELEGATION_TOKEN_FILE_ENV]: file }), TOKEN],
            ] as [Record<string, string>, string][]) {
                const shim = startQaapDelegateShim(env);
                try {
                    handler = respondJson(200, { children: [], totals: {} });
                    const reply = await shim.request('tools/call', { name: 'qaaq_task_status', arguments: {} });
                    expect(reply.result.isError).to.equal(undefined);
                    expect(received[received.length - 1].headers[protocol.QAAP_AGENT_DELEGATION_TOKEN_HEADER]).to.equal(expected);
                } finally {
                    await shim.close();
                }
            }
            const missing = startQaapDelegateShim({ [protocol.QAAP_AGENT_DELEGATION_URL_ENV]: baseUrl, [protocol.QAAP_AGENT_DELEGATION_TOKEN_FILE_ENV]: path.join(dir, 'nope') });
            try {
                const reply = await missing.request('tools/call', { name: 'qaaq_task_status', arguments: {} });
                expect(reply.result.isError).to.equal(true);
            } finally {
                await missing.close();
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('turns an HTTP error into isError with the status and the backend code, and never logs the token', async () => {
        handler = respondJson(403, { error: 'Token lacks the delegate scope.', code: 'forbidden' });
        const shim = startQaapDelegateShim(configuredEnv());
        try {
            const reply = await shim.request('tools/call', { name: 'qaaq_delegate', arguments: { prompt: 'x' } });
            expect(reply.result.isError).to.equal(true);
            expect(reply.result.content[0].text).to.equal('qaaq qaaq_delegate failed (403 forbidden): Token lacks the delegate scope.');
            expect(shim.stderr()).to.not.contain(TOKEN);
        } finally {
            await shim.close();
        }
    });

    it('answers isError when delegation is not configured, or configured with unexpanded ${VAR} placeholders', async () => {
        const unconfigured: Record<string, string>[] = [{}, {
            [protocol.QAAP_AGENT_DELEGATION_URL_ENV]: '${QAAP_DELEGATION_URL}',
            [protocol.QAAP_AGENT_DELEGATION_TOKEN_ENV]: '${QAAP_DELEGATION_TOKEN}',
        }];
        for (const env of unconfigured) {
            const shim = startQaapDelegateShim(env);
            try {
                const reply = await shim.request('tools/call', { name: 'qaaq_task_status', arguments: {} });
                expect(reply.result.isError).to.equal(true);
                expect(reply.result.content[0].text).to.match(/delegation is not configured/);
                expect((await shim.request('tools/list')).result.tools).to.have.length(6);
            } finally {
                await shim.close();
            }
        }
    });

    it('answers isError when the backend cannot be reached', async () => {
        // Port 1 on loopback has no listener, so the connection is refused.
        const shim = startQaapDelegateShim({ [protocol.QAAP_AGENT_DELEGATION_URL_ENV]: 'http://127.0.0.1:1', [protocol.QAAP_AGENT_DELEGATION_TOKEN_ENV]: TOKEN });
        try {
            const reply = await shim.request('tools/call', { name: 'qaaq_task_status', arguments: {} });
            expect(reply.result.isError).to.equal(true);
            expect(reply.result.content[0].text).to.match(/could not reach the Qaaq backend/);
        } finally {
            await shim.close();
        }
    });

    it('sends progress notifications during a slow wait when the request carries a progressToken', async () => {
        handler = (req, res) => setTimeout(() => respondJson(200, { finished: [], pending: [], timedOut: true, totals: {} })(req, res), 400);
        const shim = startQaapDelegateShim(configuredEnv({ QAAP_DELEGATION_HEARTBEAT_MS: '50' }));
        try {
            const reply = await shim.request('tools/call', { name: 'qaaq_task_wait', arguments: { timeoutSec: 1 }, _meta: { progressToken: 'p-7' } });
            expect(reply.result.isError).to.equal(undefined);
            const progress = progressOf(shim.messages);
            expect(progress.length, `expected several heartbeats, got ${progress.length}`).to.be.at.least(2);
            expect(progress[0]).to.deep.equal({
                jsonrpc: '2.0',
                method: 'notifications/progress',
                params: { progressToken: 'p-7', progress: 1, message: 'waiting for delegated tasks' },
            });
            const countAtReply = progress.length;
            await sleep(150);
            expect(progressOf(shim.messages).length, 'no heartbeat after the call returned').to.equal(countAtReply);
        } finally {
            await shim.close();
        }
    });

    it('sends no progress notifications without a progressToken', async () => {
        handler = (req, res) => setTimeout(() => respondJson(200, { timedOut: true })(req, res), 150);
        const shim = startQaapDelegateShim(configuredEnv({ QAAP_DELEGATION_HEARTBEAT_MS: '20' }));
        try {
            await shim.request('tools/call', { name: 'qaaq_task_wait', arguments: {} });
            expect(progressOf(shim.messages)).to.have.length(0);
        } finally {
            await shim.close();
        }
    });

    it('notifications/cancelled aborts the in-flight request and sends no reply for it', async () => {
        let serverSawClose = false;
        handler = (_req, res) => {
            // Hold the response open until the client goes away.
            res.on('close', () => { serverSawClose = true; });
        };
        const shim = startQaapDelegateShim(configuredEnv());
        try {
            shim.send({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'qaaq_task_wait', arguments: { timeoutSec: 60 } } });
            for (let i = 0; i < 300 && !received.some(request => !request.res.writableEnded && request.url?.endsWith('/wait')); i++) {
                await sleep(10);
            }
            shim.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 42, reason: 'user' } });
            await shim.request('ping');
            await sleep(100);
            expect(shim.messages.some(message => message.id === 42), 'no reply for the cancelled request').to.equal(false);
            expect(serverSawClose, 'backend request was aborted').to.equal(true);
        } finally {
            await shim.close();
        }
    });

    it('answers a parse error with -32700 and keeps running', async () => {
        const shim = startQaapDelegateShim({});
        try {
            shim.child.stdin.write('{not json\n');
            const error = await shim.waitFor(message => message.error?.code === -32700);
            expect(error.id).to.equal(null); // eslint-disable-line no-null/no-null
            expect((await shim.request('ping')).result).to.deep.equal({});
        } finally {
            await shim.close();
        }
    });
});
