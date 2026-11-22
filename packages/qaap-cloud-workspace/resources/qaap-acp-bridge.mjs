// Qaap ACP bridge: runs one Agent Client Protocol (v1) agent for one turn, where the agent runs (host, tenant or
// task sandbox), and prints Claude-style stream-json on stdout so the task runner parses it like a native harness.
// Standalone: Node built-ins only, no repo imports (it is copied into task sandboxes). The ACP client is written by
// hand on purpose: no SDK at runtime (see docs/qaap-unified-harness-acp-design.md, "Desviación F1: puente").
//
//   node qaap-acp-bridge.mjs --flavor <id> [--model <id>] [--mode ask|auto|readonly] [--gate-client <file>] -- <agent argv...>
//
// `--gate-client` names the gate client module (`qaap-tool-gate-pi.mjs`, which exports `askGate`); by default the
// sibling file. In a task sandbox both files are copied per turn and the client is loaded before the agent starts.
// The prompt is read from stdin. Invariants (design section 7 and the F1 review):
//   * The client announces neither `fs/*` nor `terminal/*`; every request from the agent other than
//     `session/request_permission` is answered with JSON-RPC -32601.
//   * A permission is granted only with an `allow_once` option, only after a well-formed gate `allow` without
//     `updatedInput`, and never with `allow_always` (the agent would stop asking). Anything else is a rejection or,
//     when no usable option exists, `cancelled`. Options are chosen by kind, never by id or label.
//   * Updates for another session id are dropped. The agent's stdout is never forwarded verbatim.
//   * Lines are capped (4 MiB) and rate-limited (2000 messages/s); a breach kills the agent and exits PROTOCOL.
//   * On SIGTERM: `session/cancel`, pending permissions answered `cancelled`, exit within 4 s.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ACP_PROTOCOL_VERSION = 1;
export const MAX_LINE_BYTES = 4 * 1024 * 1024;
export const MAX_MESSAGES_PER_SECOND = 2000;
export const CANCEL_GRACE_MS = 3000;
export const HEARTBEAT_MS = 15000;

/** Exit codes; the runner and the failure classifiers read them together with the `[qaap]` stderr line. */
export const EXIT = Object.freeze({
    OK: 0,
    USAGE: 2,
    CANCELLED: 10,
    REFUSAL: 11,
    LIMIT: 12,
    AUTH_REQUIRED: 13,
    PROTOCOL: 14,
    AGENT_DIED: 15,
    VERSION_UNSUPPORTED: 16,
    SPAWN: 17,
});

/** Env names that must never reach the agent process unless its flavor needs them (OpenCode's gate plugin). */
const GATE_ENV = ['QAAP_GATE_URL', 'QAAP_GATE_TOKEN', 'QAAP_GATE_ASK_TTL_SEC', 'QAAP_GATE_ARM_NONCE'];

/**
 * Per-agent differences, declarative. `permissionSource` says who guards tool calls before they run:
 *   * 'plugin': the harness loads Qaap's own pre-execution gate (OpenCode: `tool.execute.before` sees every tool,
 *     verified against `opencode acp` 1.19). The bridge still routes any permission request through the gate.
 *   * 'bridge': the permission request is the only checkpoint, so a mutation that completes without one is
 *     reported as `unpermitted-mutation`.
 */
export const FLAVORS = Object.freeze({
    opencode: Object.freeze({
        agentId: 'opencode',
        permissionSource: 'plugin',
        keepGateEnv: true,
        modelConfigId: 'model',
        signIn: 'Run `opencode auth login` in a terminal.',
    }),
    copilot: Object.freeze({
        agentId: 'copilot',
        permissionSource: 'bridge',
        keepGateEnv: false,
        modelConfigId: 'model',
        signIn: 'Run `copilot` in a terminal and sign in with /login.',
    }),
});

/** ACP tool kinds that change the workspace or run code. */
const MUTATING_KINDS = new Set(['edit', 'delete', 'move', 'execute']);

/** Claude Code tool names for ACP kinds, so the transcript shows the usual tool rows and icons. */
const TOOL_NAME_BY_KIND = Object.freeze({
    read: 'Read',
    edit: 'Edit',
    delete: 'Delete',
    move: 'Move',
    search: 'Grep',
    execute: 'Bash',
    think: 'Think',
    fetch: 'WebFetch',
    switch_mode: 'SwitchMode',
});

export function parseBridgeArgs(argv) {
    const separator = argv.indexOf('--');
    if (separator < 0 || separator === argv.length - 1) {
        throw new Error('usage: qaap-acp-bridge --flavor <id> [--model <id>] [--mode ask|auto|readonly] -- <agent argv...>');
    }
    const options = { flavor: undefined, model: undefined, mode: 'ask', gateClient: undefined };
    const own = argv.slice(0, separator);
    for (let index = 0; index < own.length; index++) {
        const flag = own[index];
        const value = own[index + 1];
        if (flag === '--flavor' || flag === '--model' || flag === '--mode' || flag === '--gate-client') {
            if (value === undefined || value.startsWith('--')) {
                throw new Error(`${flag} needs a value`);
            }
            options[flag === '--gate-client' ? 'gateClient' : flag.slice(2)] = value;
            index++;
        } else {
            throw new Error(`unknown option ${flag}`);
        }
    }
    if (!options.flavor || !Object.prototype.hasOwnProperty.call(FLAVORS, options.flavor)) {
        throw new Error(`unknown flavor ${options.flavor ?? '(none)'}`);
    }
    if (!['ask', 'auto', 'readonly'].includes(options.mode)) {
        throw new Error(`unknown mode ${options.mode}`);
    }
    return { ...options, agentArgv: argv.slice(separator + 1) };
}

/** The agent's env: the bridge's own, without gate credentials unless the flavor's plugin needs them. */
export function buildAgentEnv(env, flavor) {
    const out = { ...env };
    if (!flavor.keepGateEnv) {
        for (const name of GATE_ENV) {
            delete out[name];
        }
    }
    return out;
}

/**
 * Picks the option to answer a permission request with. Only `allow_once` grants; `allow_always` is never chosen.
 * Returns `{ outcome: 'selected', optionId }` or `{ outcome: 'cancelled' }` when no usable option exists.
 */
export function choosePermissionOption(options, allow) {
    const list = Array.isArray(options) ? options.filter(option => option && typeof option.optionId === 'string') : [];
    const wanted = allow ? 'allow_once' : 'reject_once';
    const matches = list.filter(option => option.kind === wanted);
    if (matches.length === 1) {
        return { outcome: 'selected', optionId: matches[0].optionId };
    }
    if (!allow && matches.length === 0) {
        const always = list.filter(option => option.kind === 'reject_always');
        if (always.length === 1) {
            return { outcome: 'selected', optionId: always[0].optionId };
        }
    }
    return { outcome: 'cancelled' };
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Claude-like input the gate guards understand, from an ACP tool call (native args win over the permission's). */
export function canonicalToolInput(kind, rawInput, locations, cwd) {
    const raw = isPlainObject(rawInput) ? rawInput : {};
    const pick = (...names) => {
        for (const name of names) {
            if (typeof raw[name] === 'string' && raw[name]) {
                return raw[name];
            }
        }
        return undefined;
    };
    const firstPath = Array.isArray(locations) ? locations.find(entry => isPlainObject(entry) && typeof entry.path === 'string')?.path : undefined;
    const input = {};
    const command = pick('command', 'cmd');
    const filePath = pick('filePath', 'file_path', 'filepath', 'path') ?? (kind === 'execute' ? undefined : firstPath);
    const workdir = pick('workdir', 'cwd') ?? (kind === 'execute' ? firstPath : undefined);
    if (command) {
        input.command = command;
    }
    if (workdir || kind === 'execute') {
        input.cwd = workdir ?? cwd;
    }
    if (filePath) {
        input.file_path = filePath;
    }
    for (const [from, to] of [['oldString', 'old_string'], ['old_string', 'old_string'], ['newString', 'new_string'], ['new_string', 'new_string'],
        ['content', 'content'], ['pattern', 'pattern'], ['url', 'url'], ['destination', 'destination']]) {
        if (typeof raw[from] === 'string' && input[to] === undefined) {
            input[to] = raw[from];
        }
    }
    return input;
}

/**
 * Turns ACP `session/update`s into Claude stream-json lines (what `QaapQaiqStreamAccumulator` parses). Pure: it
 * only returns lines, so the fixture specs pin the exact output.
 */
export class AcpStreamTranslator {
    constructor(flavor) {
        this.flavor = flavor;
        this.textMessageId = undefined;
        this.thinkingMessageId = undefined;
        this.text = '';
        this.thinking = '';
        this.blockIndex = 0;
        this.tools = new Map();
        this.permitted = new Set();
        this.costUsd = undefined;
        this.messageCount = 0;
    }

    header(extra = {}) {
        return [{ type: 'system', subtype: 'init', qaap_transport: 'acp', flavor: this.flavor.agentId, ...extra }];
    }

    /** Records that the bridge granted this call (an `allow_once` after a gate allow). */
    markPermitted(callId) {
        this.permitted.add(callId);
    }

    flushText() {
        const lines = [];
        if (!this.text && !this.thinking) {
            return lines;
        }
        const content = [];
        if (this.thinking) {
            content.push({ type: 'thinking', thinking: this.thinking });
        }
        if (this.text) {
            content.push({ type: 'text', text: this.text });
        }
        lines.push({ type: 'assistant', message: { id: this.textMessageId ?? this.thinkingMessageId ?? `acp-msg-${++this.messageCount}`, role: 'assistant', content } });
        this.text = '';
        this.thinking = '';
        this.textMessageId = undefined;
        this.thinkingMessageId = undefined;
        return lines;
    }

    delta(kind, text, messageId) {
        const lines = [];
        // A new message id for the same kind of content starts a new message: close the current one.
        const current = kind === 'text' ? this.textMessageId : this.thinkingMessageId;
        const buffered = kind === 'text' ? this.text : this.thinking;
        if (messageId && current && messageId !== current && buffered) {
            lines.push(...this.flushText());
        }
        if (messageId && kind === 'text' && !this.textMessageId) {
            this.textMessageId = messageId;
        } else if (messageId && kind !== 'text' && !this.thinkingMessageId) {
            this.thinkingMessageId = messageId;
        }
        if (kind === 'text') {
            this.text += text;
            lines.push({ type: 'stream_event', event: { type: 'content_block_delta', index: this.blockIndex, delta: { type: 'text_delta', text } } });
        } else {
            this.thinking += text;
            lines.push({ type: 'stream_event', event: { type: 'content_block_delta', index: this.blockIndex, delta: { type: 'thinking_delta', thinking: text } } });
        }
        return lines;
    }

    /** Lines for one update, plus any warning the update raises. */
    update(update, cwd) {
        if (!isPlainObject(update)) {
            return { lines: [] };
        }
        switch (update.sessionUpdate) {
            case 'agent_message_chunk':
                return { lines: update.content?.type === 'text' && typeof update.content.text === 'string' ? this.delta('text', update.content.text, update.messageId) : [] };
            case 'agent_thought_chunk':
                return { lines: update.content?.type === 'text' && typeof update.content.text === 'string' ? this.delta('thinking', update.content.text, update.messageId) : [] };
            case 'tool_call':
            case 'tool_call_update':
                return this.toolUpdate(update, cwd);
            case 'usage_update':
                if (isPlainObject(update.cost) && typeof update.cost.amount === 'number' && update.cost.currency === 'USD') {
                    this.costUsd = update.cost.amount;
                }
                return { lines: [] };
            case 'plan':
            case 'available_commands_update':
            case 'current_mode_update':
            case 'config_option_update':
            case 'session_info_update':
            case 'user_message_chunk':
                return { lines: [] };
            default:
                return { lines: [] };
        }
    }

    toolUpdate(update, cwd) {
        const callId = typeof update.toolCallId === 'string' ? update.toolCallId : undefined;
        if (!callId) {
            return { lines: [] };
        }
        const previous = this.tools.get(callId);
        const kind = typeof update.kind === 'string' ? update.kind : previous?.kind ?? 'other';
        // The first title is the tool's name (`write`, `bash`); later titles describe the call (`ls`).
        const name = previous?.name ?? (typeof update.title === 'string' && update.title ? update.title : kind);
        const rawInput = isPlainObject(update.rawInput) && Object.keys(update.rawInput).length > 0 ? update.rawInput : previous?.rawInput;
        const locations = Array.isArray(update.locations) && update.locations.length > 0 ? update.locations : previous?.locations ?? [];
        const status = typeof update.status === 'string' ? update.status : previous?.status ?? 'pending';
        const state = { kind, name, rawInput, locations, status, announced: previous?.announced ?? false, finished: previous?.finished ?? false };
        this.tools.set(callId, state);
        const lines = [...this.flushText()];
        const toolName = TOOL_NAME_BY_KIND[kind] ?? name;
        const input = canonicalToolInput(kind, rawInput, locations, cwd);
        if (!state.announced || (rawInput && rawInput !== previous?.rawInput)) {
            state.announced = true;
            lines.push({ type: 'assistant', message: { id: `acp-tool-${callId}`, role: 'assistant', content: [{ type: 'tool_use', id: callId, name: toolName, input }] } });
        }
        let warning;
        if ((status === 'completed' || status === 'failed') && !state.finished) {
            state.finished = true;
            lines.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: toolResultText(update), is_error: status === 'failed' }] } });
            if (status === 'completed' && this.flavor.permissionSource === 'bridge' && MUTATING_KINDS.has(kind) && !this.permitted.has(callId)) {
                warning = { code: 'unpermitted-mutation', detail: `${this.flavor.agentId} completed a ${kind} call (${name}) without asking for permission.` };
            }
        }
        return { lines, ...(warning ? { warning } : {}) };
    }

    /** The closing `result` line of the turn. */
    result(stopReason, usage, errorText) {
        const lines = [...this.flushText()];
        const parsed = isPlainObject(usage) ? usage : {};
        const number = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
        const isError = stopReason !== 'end_turn';
        lines.push({
            type: 'result',
            subtype: isError ? 'error_during_execution' : 'success',
            is_error: isError,
            stop_reason: stopReason,
            // The text already streamed; repeating it here would duplicate it in the transcript.
            result: errorText ?? '',
            usage: {
                input_tokens: number(parsed.inputTokens),
                output_tokens: number(parsed.outputTokens) + number(parsed.thoughtTokens),
                cache_read_input_tokens: number(parsed.cachedReadTokens),
                cache_creation_input_tokens: number(parsed.cachedWriteTokens),
            },
            ...(this.costUsd !== undefined ? { total_cost_usd: this.costUsd } : {}),
        });
        return lines;
    }
}

function toolResultText(update) {
    const parts = [];
    for (const entry of Array.isArray(update.content) ? update.content : []) {
        if (entry?.type === 'content' && entry.content?.type === 'text' && typeof entry.content.text === 'string') {
            parts.push(entry.content.text);
        } else if (entry?.type === 'diff' && typeof entry.path === 'string') {
            parts.push(`Edited ${entry.path}`);
        }
    }
    return parts.join('\n');
}

/** Exit code and one-line reason for an ACP stop reason. */
export function exitForStopReason(stopReason) {
    switch (stopReason) {
        case 'end_turn': return EXIT.OK;
        case 'cancelled': return EXIT.CANCELLED;
        case 'refusal': return EXIT.REFUSAL;
        case 'max_tokens':
        case 'max_turn_requests': return EXIT.LIMIT;
        default: return EXIT.PROTOCOL;
    }
}

/** True when a JSON-RPC error means the agent wants a sign-in. */
export function isAuthError(error) {
    if (!isPlainObject(error)) {
        return false;
    }
    return error.code === -32000 || /auth|sign.?in|log.?in|credential/i.test(String(error.message ?? ''));
}

/**
 * NDJSON reader with the protocol limits. `onMessage` gets each parsed object; `onViolation(reason)` is called once
 * when a limit is broken (the caller kills the agent).
 */
export class LimitedLineReader {
    constructor(onMessage, onViolation, now = () => Date.now()) {
        this.onMessage = onMessage;
        this.onViolation = onViolation;
        this.now = now;
        this.buffer = '';
        this.windowStart = now();
        this.windowCount = 0;
        this.broken = false;
    }

    push(chunk) {
        if (this.broken) {
            return;
        }
        this.buffer += chunk;
        let newline;
        while ((newline = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, newline);
            this.buffer = this.buffer.slice(newline + 1);
            if (!this.accept(line) || this.broken) {
                return;
            }
        }
        if (Buffer.byteLength(this.buffer, 'utf8') > MAX_LINE_BYTES) {
            this.violate(`a protocol line exceeded ${MAX_LINE_BYTES} bytes`);
        }
    }

    accept(line) {
        if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
            this.violate(`a protocol line exceeded ${MAX_LINE_BYTES} bytes`);
            return false;
        }
        if (!line.trim()) {
            return true;
        }
        const now = this.now();
        if (now - this.windowStart >= 1000) {
            this.windowStart = now;
            this.windowCount = 0;
        }
        if (++this.windowCount > MAX_MESSAGES_PER_SECOND) {
            this.violate(`the agent sent more than ${MAX_MESSAGES_PER_SECOND} messages in one second`);
            return false;
        }
        let message;
        try {
            message = JSON.parse(line);
        } catch {
            this.violate('the agent wrote a line that is not JSON');
            return false;
        }
        if (!isPlainObject(message) || message.jsonrpc !== '2.0') {
            this.violate('the agent wrote a message that is not JSON-RPC 2.0');
            return false;
        }
        this.onMessage(message);
        return true;
    }

    violate(reason) {
        if (!this.broken) {
            this.broken = true;
            this.onViolation(reason);
        }
    }
}

/**
 * One turn. `io` holds the side effects so specs can drive it: `spawnAgent(file, args, env)`, `writeOut(line)`,
 * `writeErr(text)`, `askGate(request)`, `env`, `cwd`, `version`.
 */
export async function runBridgeTurn(options, prompt, io) {
    const flavor = FLAVORS[options.flavor];
    const translator = new AcpStreamTranslator(flavor);
    const out = lines => {
        for (const line of lines) {
            io.writeOut(`${JSON.stringify(line)}\n`);
        }
    };
    const note = text => io.writeErr(`[qaap] ${text}\n`);
    const warn = warning => {
        out([{ type: 'system', subtype: 'qaap_warning', code: warning.code, detail: warning.detail }]);
        note(warning.detail);
    };
    out(translator.header());

    let child;
    try {
        child = io.spawnAgent(options.agentArgv[0], options.agentArgv.slice(1), buildAgentEnv(io.env, flavor));
    } catch (error) {
        note(`Could not start ${flavor.agentId}: ${error instanceof Error ? error.message : String(error)}`);
        return EXIT.SPAWN;
    }

    let nextId = 1;
    const pending = new Map();
    const pendingPermissions = new Set();
    let sessionId;
    let finished = false;
    let settle;
    const done = new Promise(resolve => {
        settle = code => {
            if (!finished) {
                finished = true;
                resolve(code);
            }
        };
    });
    const send = message => {
        if (!child.stdin.destroyed) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
        }
    };
    const request = (method, params) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        send({ id, method, params });
    });
    const fail = (code, text) => {
        if (text) {
            note(text);
        }
        settle(code);
    };

    const answerPermission = async message => {
        const params = isPlainObject(message.params) ? message.params : {};
        const respond = outcome => send({ id: message.id, result: { outcome } });
        if (params.sessionId !== sessionId) {
            respond({ outcome: 'cancelled' });
            return;
        }
        const toolCall = isPlainObject(params.toolCall) ? params.toolCall : {};
        const callId = typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : undefined;
        const known = callId ? translator.tools.get(callId) : undefined;
        const kind = typeof toolCall.kind === 'string' ? toolCall.kind : known?.kind ?? 'other';
        const rawInput = known?.rawInput ?? toolCall.rawInput;
        const locations = Array.isArray(toolCall.locations) && toolCall.locations.length > 0 ? toolCall.locations : known?.locations ?? [];
        const token = { cancelled: false };
        pendingPermissions.add(token);
        const heartbeat = setInterval(() => out([{ type: 'system', subtype: 'qaap_heartbeat' }]), HEARTBEAT_MS);
        let decision;
        try {
            decision = await io.askGate({
                agentId: flavor.agentId,
                // The server recomputes the kind from the tool name; this is informational only.
                toolKind: 'other',
                rawToolName: known?.name ?? (typeof toolCall.title === 'string' ? toolCall.title : kind),
                input: canonicalToolInput(kind, rawInput, locations, io.cwd),
                cwd: io.cwd,
                acpKind: kind,
                ...(callId ? { harnessCallId: callId } : {}),
            });
        } catch (error) {
            decision = { kind: 'deny', reason: error instanceof Error ? error.message : String(error) };
        } finally {
            clearInterval(heartbeat);
            pendingPermissions.delete(token);
        }
        if (token.cancelled || finished) {
            respond({ outcome: 'cancelled' });
            return;
        }
        // request_permission cannot carry a rewritten input: a gate allow with updatedInput is a deny here.
        const allow = decision?.kind === 'allow' && !(isPlainObject(decision.updatedInput) && Object.keys(decision.updatedInput).length > 0);
        const choice = choosePermissionOption(params.options, allow);
        if (allow && choice.outcome === 'selected' && callId) {
            translator.markPermitted(callId);
        }
        if (!allow && decision?.reason) {
            note(`Blocked: ${decision.reason}`);
        }
        respond(choice);
    };

    const onMessage = message => {
        if (message.id !== undefined && message.method === undefined) {
            const entry = pending.get(message.id);
            if (entry) {
                pending.delete(message.id);
                if (message.error) {
                    entry.reject(Object.assign(new Error(String(message.error.message ?? 'error')), { rpc: message.error }));
                } else {
                    entry.resolve(message.result);
                }
            }
            return;
        }
        if (message.method === 'session/update') {
            if (!isPlainObject(message.params) || message.params.sessionId !== sessionId || sessionId === undefined) {
                return;
            }
            const { lines, warning } = translator.update(message.params.update, io.cwd);
            out(lines);
            if (warning) {
                warn(warning);
            }
            return;
        }
        if (message.method === 'session/request_permission' && message.id !== undefined) {
            void answerPermission(message);
            return;
        }
        if (message.id !== undefined) {
            send({ id: message.id, error: { code: -32601, message: `${message.method} is not supported by this client` } });
        }
    };

    const reader = new LimitedLineReader(onMessage, reason => {
        child.kill('SIGKILL');
        fail(EXIT.PROTOCOL, `ACP protocol error: ${reason}.`);
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => reader.push(chunk));
    child.stderr.on('data', chunk => io.writeErr(String(chunk)));
    child.on('error', error => fail(EXIT.SPAWN, `Could not start ${flavor.agentId}: ${error.message}`));
    child.on('close', (code, signal) => {
        for (const entry of pending.values()) {
            entry.reject(Object.assign(new Error('agent exited'), { exited: true }));
        }
        pending.clear();
        fail(EXIT.AGENT_DIED, finished ? undefined : `${flavor.agentId} exited before the turn ended (${signal ?? `code ${code}`}).`);
    });

    const cancel = () => {
        for (const token of pendingPermissions) {
            token.cancelled = true;
        }
        if (sessionId) {
            send({ method: 'session/cancel', params: { sessionId } });
        }
        setTimeout(() => {
            child.kill('SIGKILL');
            fail(EXIT.CANCELLED, 'The turn was cancelled.');
        }, CANCEL_GRACE_MS).unref?.();
    };
    io.onCancel?.(cancel);

    const turn = (async () => {
        const init = await request('initialize', {
            protocolVersion: ACP_PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            clientInfo: { name: 'qaaq', version: io.version ?? '0' },
        });
        const version = isPlainObject(init) ? init.protocolVersion : undefined;
        if (typeof version !== 'number' || version < ACP_PROTOCOL_VERSION) {
            return fail(EXIT.VERSION_UNSUPPORTED, `${flavor.agentId} speaks ACP version ${String(version)}; Qaap needs version ${ACP_PROTOCOL_VERSION}.`);
        }
        let created;
        try {
            created = await request('session/new', { cwd: io.cwd, mcpServers: [] });
        } catch (error) {
            if (isAuthError(error.rpc)) {
                return fail(EXIT.AUTH_REQUIRED, `${flavor.agentId} needs you to sign in. ${flavor.signIn}`);
            }
            throw error;
        }
        if (!isPlainObject(created) || typeof created.sessionId !== 'string' || !created.sessionId) {
            return fail(EXIT.PROTOCOL, `ACP protocol error: ${flavor.agentId} returned no session id.`);
        }
        sessionId = created.sessionId;
        if (options.model && flavor.modelConfigId) {
            const option = Array.isArray(created.configOptions) ? created.configOptions.find(entry => entry?.id === flavor.modelConfigId) : undefined;
            const available = Array.isArray(option?.options) && option.options.some(entry => entry?.value === options.model);
            if (!available) {
                note(`The model ${options.model} is not offered by ${flavor.agentId}; using ${option?.currentValue ?? 'its default'}.`);
            } else if (option.currentValue !== options.model) {
                await request('session/set_config_option', { sessionId, configId: flavor.modelConfigId, value: options.model });
            }
        }
        const result = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] });
        const stopReason = isPlainObject(result) && typeof result.stopReason === 'string' ? result.stopReason : 'error';
        out(translator.result(stopReason, isPlainObject(result) ? result.usage : undefined));
        const code = exitForStopReason(stopReason);
        if (code === EXIT.REFUSAL) {
            note(`${flavor.agentId} refused to continue.`);
        } else if (code === EXIT.LIMIT) {
            note(`${flavor.agentId} stopped at a limit (${stopReason}).`);
        }
        return settle(code);
    })();
    turn.catch(error => {
        if (error?.exited) {
            return;
        }
        fail(EXIT.PROTOCOL, `ACP protocol error: ${error instanceof Error ? error.message : String(error)}.`);
    });

    const code = await done;
    // One process per turn: the agent never outlives it (a no-op when it already exited).
    child.stdin.end();
    child.kill('SIGTERM');
    return code;
}

async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function main() {
    let options;
    try {
        options = parseBridgeArgs(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`[qaap] ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = EXIT.USAGE;
        return;
    }
    let askGate;
    try {
        // Loaded before the agent exists, so a copy the agent could write to is never read after it starts.
        const client = options.gateClient ?? fileURLToPath(new URL('./qaap-tool-gate-pi.mjs', import.meta.url));
        ({ askGate } = await import(pathToFileURL(client).toString()));
        if (typeof askGate !== 'function') {
            throw new Error('the gate client exports no askGate');
        }
    } catch (error) {
        process.stderr.write(`[qaap] The ACP bridge could not load its gate client (${error instanceof Error ? error.message : String(error)}).\n`);
        process.exitCode = EXIT.USAGE;
        return;
    }
    const prompt = await readStdin();
    let onCancel;
    process.on('SIGTERM', () => onCancel?.());
    process.on('SIGINT', () => onCancel?.());
    const code = await runBridgeTurn(options, prompt, {
        // Same process group as the bridge (not detached): the runner's group kill reaches the agent too.
        spawnAgent: (file, args, env) => spawn(file, args, { env, stdio: ['pipe', 'pipe', 'pipe'] }),
        writeOut: text => process.stdout.write(text),
        writeErr: text => process.stderr.write(text),
        askGate: requestBody => askGate(requestBody, process.env),
        onCancel: handler => {
            onCancel = handler;
        },
        env: process.env,
        cwd: process.cwd(),
    });
    process.exitCode = code;
    // Do not linger on a stuck agent pipe.
    setTimeout(() => process.exit(code), 500).unref();
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
    main().catch(error => {
        process.stderr.write(`[qaap] The ACP bridge failed (${error instanceof Error ? error.message : String(error)}).\n`);
        process.exitCode = EXIT.PROTOCOL;
    });
}
