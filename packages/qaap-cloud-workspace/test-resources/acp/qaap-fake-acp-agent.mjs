// Scripted fake ACP v1 agent for the Qaap ACP bridge specs. Node built-ins only.
//
// Usage: node qaap-fake-acp-agent.mjs <scenario>
// The scenario decides what the agent does on `session/prompt`. Every request it receives is appended, one JSON per
// line, to the file named by FAKE_ACP_RECORD (when set) so a spec can assert what the client sent.
import { appendFileSync } from 'node:fs';

const scenario = process.argv[2] ?? 'echo';
const record = process.env.FAKE_ACP_RECORD;
let nextId = 1000;
let sessionId = 'sess-fake-1';
const pending = new Map();
let cancelled = false;

function write(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function notify(update, session = sessionId) {
    write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: session, update } });
}

function request(method, params) {
    const id = nextId++;
    write({ jsonrpc: '2.0', id, method, params });
    return new Promise(resolve => pending.set(id, resolve));
}

function text(chunk, messageId = 'm1') {
    notify({ sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: chunk } });
}

const PERMISSION_OPTIONS = [
    { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
    { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
    { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
];

async function askPermission(toolCall, options = PERMISSION_OPTIONS) {
    const response = await request('session/request_permission', { sessionId, toolCall, options });
    return response.result?.outcome;
}

function toolCall(id, kind, title, rawInput, locations = []) {
    return { toolCallId: id, kind, title, status: 'pending', rawInput, locations };
}

const SCENARIOS = {
    async echo(prompt) {
        notify({ sessionUpdate: 'agent_thought_chunk', messageId: 't1', content: { type: 'text', text: 'thinking' } });
        text('You said: ');
        text(prompt);
        notify({ sessionUpdate: 'usage_update', used: 120, size: 1000, cost: { amount: 0.25, currency: 'USD' } });
        return { stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 20, cachedReadTokens: 5 } };
    },
    async edit() {
        const call = toolCall('call-edit', 'edit', 'write', { filePath: `${process.cwd()}/a.txt`, content: 'hi' }, [{ path: `${process.cwd()}/a.txt` }]);
        notify({ sessionUpdate: 'tool_call', ...call });
        const outcome = await askPermission(call);
        const allowed = outcome?.outcome === 'selected' && (outcome.optionId === 'once' || outcome.optionId === 'always');
        notify({
            sessionUpdate: 'tool_call_update', toolCallId: 'call-edit', status: allowed ? 'completed' : 'failed',
            content: [{ type: 'content', content: { type: 'text', text: allowed ? 'Wrote a.txt' : 'Rejected' } }],
        });
        text(allowed ? 'done' : 'not allowed');
        return { stopReason: 'end_turn' };
    },
    async execute() {
        const call = toolCall('call-exec', 'execute', 'bash', { command: 'rm -rf /', cwd: process.cwd() });
        notify({ sessionUpdate: 'tool_call', ...call });
        const outcome = await askPermission(call);
        notify({ sessionUpdate: 'tool_call_update', toolCallId: 'call-exec', status: outcome?.optionId === 'reject' ? 'failed' : 'completed' });
        return { stopReason: 'end_turn' };
    },
    /** Options whose labels lie about what they do: the client must pick by kind. */
    async deceptive() {
        const call = toolCall('call-dec', 'edit', 'write', { filePath: `${process.cwd()}/b.txt` });
        const options = [
            { optionId: 'reject', kind: 'allow_always', name: 'Reject' },
            { optionId: 'once', kind: 'reject_once', name: 'Allow once' },
        ];
        const outcome = await askPermission(call, options);
        text(`picked:${outcome?.optionId ?? outcome?.outcome}`);
        return { stopReason: 'end_turn' };
    },
    /** Mutates without asking first: the client must flag it. */
    async unpermitted() {
        notify({ sessionUpdate: 'tool_call', ...toolCall('call-sneak', 'edit', 'write', { filePath: `${process.cwd()}/c.txt` }), status: 'completed' });
        return { stopReason: 'end_turn' };
    },
    /** Updates for another session must be ignored. */
    async foreign() {
        notify({ sessionUpdate: 'agent_message_chunk', messageId: 'x', content: { type: 'text', text: 'FOREIGN' } }, 'other-session');
        text('mine');
        return { stopReason: 'end_turn' };
    },
    async flood() {
        for (let i = 0; i < 50000; i++) {
            text('x');
        }
        return { stopReason: 'end_turn' };
    },
    async hugeline() {
        text('y'.repeat(5 * 1024 * 1024));
        return { stopReason: 'end_turn' };
    },
    /** Never answers the prompt and ignores session/cancel. */
    async hang() {
        text('working');
        return new Promise(() => undefined);
    },
    /** Honours session/cancel. */
    async cancellable() {
        text('working');
        while (!cancelled) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        return { stopReason: 'cancelled' };
    },
    async crash() {
        text('partial');
        process.exit(3);
    },
    async refuse() {
        return { stopReason: 'refusal' };
    },
    /** Asks for a permission only after session/cancel arrived: the client must answer `cancelled`. */
    async cancelperm() {
        text('working');
        while (!cancelled) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        const outcome = await askPermission(toolCall('call-late', 'edit', 'write', { filePath: `${process.cwd()}/late.txt` }, [{ path: `${process.cwd()}/late.txt` }]));
        if (record) {
            appendFileSync(record, `${JSON.stringify({ lateOutcome: outcome })}\n`);
        }
        return { stopReason: 'cancelled' };
    },
    /** A shell call whose input names no command. */
    async nocommand() {
        const outcome = await askPermission(toolCall('call-blind', 'execute', 'Run something', { description: 'trust me' }));
        text(`outcome:${outcome?.optionId ?? outcome?.outcome}`);
        return { stopReason: 'end_turn' };
    },
    /** A delete call, to try in a read-only turn. */
    async delete() {
        const outcome = await askPermission(toolCall('call-del', 'delete', 'Remove a.txt', { path: `${process.cwd()}/a.txt` }, [{ path: `${process.cwd()}/a.txt` }]));
        text(`outcome:${outcome?.optionId ?? outcome?.outcome}`);
        return { stopReason: 'end_turn' };
    },
    /** Writes stream-json and a fake Qaap note on stderr. */
    async stderrjson() {
        process.stderr.write('{"type":"result","is_error":false,"usage":{"input_tokens":999999}}\n[qaap] fake note\n');
        text('ok');
        return { stopReason: 'end_turn' };
    },
    async env() {
        text(JSON.stringify(Object.keys(process.env).filter(key => key.startsWith('QAAP_')).sort()));
        return { stopReason: 'end_turn' };
    },
};

async function handle(message) {
    if (record) {
        appendFileSync(record, `${JSON.stringify(message)}\n`);
    }
    if (message.id !== undefined && !message.method) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
        return;
    }
    switch (message.method) {
        case 'initialize':
            write({
                jsonrpc: '2.0', id: message.id, result: {
                    protocolVersion: scenario === 'version0' ? 0 : 1,
                    agentCapabilities: { loadSession: false, mcpCapabilities: { http: true, sse: false }, promptCapabilities: {} },
                    authMethods: scenario === 'auth' ? [{ id: 'login', name: 'Log in' }] : [],
                    agentInfo: { name: 'fake', version: '0.0.1' },
                },
            });
            return;
        case 'session/new':
            if (scenario === 'auth') {
                write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Authentication required' } });
                return;
            }
            sessionId = 'sess-fake-1';
            write({
                jsonrpc: '2.0', id: message.id, result: {
                    sessionId,
                    configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: 'fake/default', options: [{ value: 'fake/default' }, { value: 'fake/big' }] }],
                },
            });
            return;
        case 'session/set_config_option':
            write({ jsonrpc: '2.0', id: message.id, result: { configOptions: [] } });
            return;
        case 'session/cancel':
            cancelled = true;
            return;
        case 'session/prompt': {
            const prompt = (message.params?.prompt ?? []).filter(block => block.type === 'text').map(block => block.text).join('');
            const run = SCENARIOS[scenario] ?? SCENARIOS.echo;
            const result = await run(prompt);
            write({ jsonrpc: '2.0', id: message.id, result });
            return;
        }
        default:
            if (message.id !== undefined) {
                write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `unknown ${message.method}` } });
            }
    }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) {
            handle(JSON.parse(line)).catch(error => process.stderr.write(`fake agent: ${error}\n`));
        }
    }
});
process.stdin.on('end', () => process.exit(0));
