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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
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
 * Per-agent differences, declarative. `output` is what the bridge prints: Claude stream-json, or plain text for a
 * harness whose transcript is plain text. `gateToolNames` is the tool name the gate gets: the agent's own (a name
 * its capability mapper knows) or the Claude name of the ACP kind. `permissionSource` says who guards tool calls before they run:
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
        output: 'stream-json',
        gateToolNames: 'native',
        modelConfigId: 'model',
        signIn: 'Run `opencode auth login` in a terminal.',
        mcpStdio: true,
    }),
    copilot: Object.freeze({
        agentId: 'copilot',
        permissionSource: 'bridge',
        keepGateEnv: false,
        // Copilot's transcript is plain text today; a structured one is F4 work (the readers would change for the native CLI too).
        output: 'text',
        // Copilot titles describe the call ("Create note.txt and list…"): the gate gets the Claude name of the ACP kind.
        gateToolNames: 'claude',
        modelConfigId: 'model',
        signIn: 'Run `copilot` in a terminal and sign in with /login.',
        // Copilot ignores stdio MCP servers in session/new (seen with 1.0.114; T3 Code notes the same) but takes HTTP
        // ones: the bridge runs the stdio servers itself and serves them to Copilot over loopback HTTP.
        mcpStdio: false,
        mcpHttpProxy: true,
    }),
    antigravity: Object.freeze({
        agentId: 'antigravity',
        permissionSource: 'bridge',
        keepGateEnv: false,
        // Antigravity's native transcript is already Claude-style stream-json.
        output: 'stream-json',
        gateToolNames: 'claude',
        modelConfigId: 'model',
        signIn: 'Run `agy` in a terminal and sign in with Google.',
        mcpStdio: true,
        // agy loads plugins and hooks from its gemini dir; a broken global hook blocks every tool (seen on a dev
        // machine). Qaap runs it with its own profile, like T3 Code; the Google sign-in lives in the keychain.
        ownProfile: 'antigravity-acp',
    }),
    grok: Object.freeze({
        agentId: 'grok',
        permissionSource: 'bridge',
        keepGateEnv: false,
        // Grok's transcript is plain text today, like Copilot's.
        output: 'text',
        gateToolNames: 'claude',
        modelConfigId: 'model',
        signIn: 'Run `grok login` in a terminal.',
        mcpStdio: true,
    }),
});

/** ACP tool kinds that change the workspace or run code. */
const MUTATING_KINDS = new Set(['edit', 'delete', 'move', 'execute']);

/** ACP kinds that neither change the workspace nor run code: the only ones a read-only turn may use. */
const READ_ONLY_KINDS = new Set(['read', 'search', 'think', 'fetch']);

/** Gate names of the mutating kinds; every other non-read kind (other, switch_mode, unknown) is gated as a write. */
const GATE_NAME_BY_MUTATING_KIND = Object.freeze({ edit: 'Edit', execute: 'Bash', delete: 'Write', move: 'Write' });

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
    const options = { flavor: undefined, model: undefined, mode: 'ask', gateClient: undefined, gateClientSha256: undefined, mcpServers: undefined, promptFile: undefined };
    const own = argv.slice(0, separator);
    for (let index = 0; index < own.length; index++) {
        const flag = own[index];
        const value = own[index + 1];
        if (flag === '--flavor' || flag === '--model' || flag === '--mode' || flag === '--gate-client' || flag === '--gate-client-sha256' || flag === '--mcp-servers' || flag === '--prompt-file') {
            if (value === undefined || value.startsWith('--')) {
                throw new Error(`${flag} needs a value`);
            }
            const key = flag === '--gate-client' ? 'gateClient' : flag === '--gate-client-sha256' ? 'gateClientSha256' : flag === '--mcp-servers' ? 'mcpServers' : flag === '--prompt-file' ? 'promptFile' : flag.slice(2);
            options[key] = value;
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

/**
 * MCP servers for `session/new`, read from the launcher's 0600 file: stdio entries only (`name`, `command`, `args`,
 * `env` as name/value pairs). The file never holds a credential, only paths (the delegation token stays in its own
 * 0600 file). Anything malformed throws: the turn must not start with a half-wired delegation.
 */
export function parseMcpServers(text) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length > 8) {
        throw new Error('the MCP server list must be an array of at most 8 entries');
    }
    return parsed.map(entry => {
        const ok = isPlainObject(entry)
            && typeof entry.name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(entry.name)
            && typeof entry.command === 'string' && entry.command.length > 0
            && Array.isArray(entry.args) && entry.args.every(arg => typeof arg === 'string')
            && Array.isArray(entry.env) && entry.env.every(pair => isPlainObject(pair) && typeof pair.name === 'string' && typeof pair.value === 'string');
        if (!ok) {
            throw new Error('malformed MCP server entry');
        }
        return { name: entry.name, command: entry.command, args: [...entry.args], env: entry.env.map(pair => ({ name: pair.name, value: pair.value })) };
    });
}

/**
 * The agent's argv with the flavor's own additions: Antigravity gets Qaap's own profile (an absolute gemini dir under
 * HOME, created 0700) so global plugins and hooks of the user's agy profile do not apply.
 */
export function buildAgentArgv(flavor, argv, env, mkdir = dir => mkdirSync(dir, { recursive: true, mode: 0o700 })) {
    if (!flavor.ownProfile || !env.HOME) {
        return [...argv];
    }
    const profile = `${env.HOME.replace(/\/+$/, '')}/.cache/qaaq/${flavor.ownProfile}`;
    mkdir(profile);
    return [...argv, '--gemini-dir', profile, '--app-data-dir', flavor.ownProfile];
}

/** The agent's env: the bridge's own, without gate credentials unless the flavor's plugin needs them. */
export function buildAgentEnv(env, flavor) {
    const out = { ...env };
    // Set by the launcher only so the bridge itself can run on an Electron binary.
    delete out.ELECTRON_RUN_AS_NODE;
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
    // Field names differ per agent: OpenCode (filePath, workdir), Copilot (path, old_str), Antigravity (PascalCase).
    const command = pick('command', 'cmd', 'CommandLine', 'commandLine', 'Command');
    const filePath = pick('filePath', 'file_path', 'filepath', 'path', 'Path', 'TargetFile', 'targetFile', 'AbsolutePath')
        ?? (kind === 'execute' ? undefined : firstPath);
    const workdir = pick('workdir', 'cwd', 'Cwd', 'WorkingDirectory') ?? (kind === 'execute' ? firstPath : undefined);
    if (command) {
        input.command = command;
    }
    if (workdir || kind === 'execute') {
        input.cwd = workdir ?? cwd;
    }
    if (filePath) {
        input.file_path = filePath;
    }
    for (const [from, to] of [['oldString', 'old_string'], ['old_string', 'old_string'], ['old_str', 'old_string'],
        ['newString', 'new_string'], ['new_string', 'new_string'], ['new_str', 'new_string'],
        ['content', 'content'], ['file_text', 'content'], ['Content', 'content'], ['CodeContent', 'content'],
        ['TargetContent', 'old_string'], ['ReplacementContent', 'new_string'], ['pattern', 'pattern'], ['url', 'url'], ['destination', 'destination']]) {
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

/** The tool name the gate classifies the call by (see `gateToolNames`). */
export function gateToolName(flavor, kind, nativeName) {
    if (flavor.gateToolNames === 'claude') {
        // Never the agent's title (it describes the call and could read like a harmless tool): a kind without a
        // read-only meaning reaches the gate as a write, so read-only turns block it and ask turns ask.
        return READ_ONLY_KINDS.has(kind) ? TOOL_NAME_BY_KIND[kind] : (GATE_NAME_BY_MUTATING_KIND[kind] ?? 'Write');
    }
    return nativeName;
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

/**
 * Plain-text rendering of translated lines, for a flavor whose transcript is plain text: the reply as it streams,
 * one line per tool call, nothing else (warnings and denials already go to stderr).
 */
export function renderLinesAsText(lines, shownTools = new Map()) {
    let text = '';
    const line = (name, detail) => `\n▸ ${name}${detail ? `: ${String(detail).split('\n')[0].slice(0, 200)}` : ''}\n`;
    for (const entry of lines) {
        if (entry.type === 'stream_event' && entry.event?.delta?.type === 'text_delta') {
            text += entry.event.delta.text;
        } else if (entry.type === 'assistant') {
            for (const block of entry.message?.content ?? []) {
                if (block.type !== 'tool_use') {
                    continue;
                }
                // One line per call, printed once its input names what it does (a call is re-announced when the
                // input arrives); a call that never gets one is printed when it finishes.
                const detail = block.input?.command ?? block.input?.file_path ?? block.input?.url ?? block.input?.pattern;
                if (shownTools.get(block.id) === true) {
                    continue;
                }
                if (detail) {
                    shownTools.set(block.id, true);
                    text += line(block.name, detail);
                } else {
                    shownTools.set(block.id, block.name);
                }
            }
        } else if (entry.type === 'user') {
            for (const block of entry.message?.content ?? []) {
                const pending = block.type === 'tool_result' ? shownTools.get(block.tool_use_id) : undefined;
                if (typeof pending === 'string') {
                    shownTools.set(block.tool_use_id, true);
                    text += line(pending);
                }
            }
        } else if (entry.type === 'result') {
            text += '\n';
        }
    }
    return text;
}

/**
 * A refusal the bridge gives without asking the gate, or undefined. A read-only turn may only read; a call whose
 * input lacks what the gate guards inspect (the command of a shell call, the path of a file change) is refused
 * rather than judged blind.
 */
export function refusePermissionLocally(mode, kind, input) {
    if (mode === 'readonly' && !READ_ONLY_KINDS.has(kind)) {
        return `this turn is read-only; the agent asked for a ${kind} call.`;
    }
    if (kind === 'execute' && !input.command) {
        return 'the agent asked to run a command without saying which.';
    }
    if ((kind === 'edit' || kind === 'delete' || kind === 'move') && !input.file_path) {
        return `the agent asked for a ${kind} call without a path.`;
    }
    return undefined;
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

/** Largest MCP request body the loopback proxy accepts. */
export const MCP_PROXY_MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Open connections and pending requests per server the proxy accepts. */
export const MCP_PROXY_MAX_CONNECTIONS = 16;
export const MCP_PROXY_MAX_PENDING = 64;

/**
 * Serves stdio MCP servers over MCP Streamable HTTP (JSON responses) on 127.0.0.1, for an agent that only takes HTTP
 * MCP servers (Copilot). Each server gets its own path and the whole proxy one random 32-byte bearer secret, which
 * only the agent learns (in session/new). The real credentials stay where the stdio server reads them (a 0600 file).
 * `spawnServer(entry)` returns a child with stdio pipes. Returns `{ entries, close }`.
 */
export async function startMcpHttpProxy(servers, spawnServer) {
    const secret = randomBytes(32).toString('base64url');
    const expected = Buffer.from(`Bearer ${secret}`);
    const routes = new Map();
    const children = [];
    for (const [index, entry] of servers.entries()) {
        const child = spawnServer(entry);
        children.push(child);
        const waiting = new Map();
        const lines = new LineSplitter(line => {
            let message;
            try {
                message = JSON.parse(line);
            } catch {
                return;
            }
            if (message && message.id !== undefined && waiting.has(message.id)) {
                waiting.get(message.id)(message);
                waiting.delete(message.id);
            }
        });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => lines.push(chunk));
        const failAll = () => {
            for (const resolve of waiting.values()) {
                resolve(undefined);
            }
            waiting.clear();
        };
        // A dead server (killed, or its node missing) answers 502; it never takes the bridge down.
        child.on('error', failAll);
        child.stdin.on('error', failAll);
        child.on('close', failAll);
        routes.set(`/mcp/${index}`, { child, waiting });
    }
    let hostHeader;
    const server = createServer((req, res) => {
        // Defence in depth against DNS rebinding: loopback Host only, and no browser Origin.
        if (req.headers.origin !== undefined || req.headers.host !== hostHeader) {
            res.writeHead(403).end();
            return;
        }
        const auth = Buffer.from(String(req.headers.authorization ?? ''));
        if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
            res.writeHead(401).end();
            return;
        }
        const route = routes.get(String(req.url ?? '').split('?')[0]);
        if (!route) {
            res.writeHead(404).end();
            return;
        }
        if (req.method !== 'POST') {
            // No server-initiated stream: the shim never sends requests of its own.
            res.writeHead(405, { allow: 'POST' }).end();
            return;
        }
        let size = 0;
        const chunks = [];
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MCP_PROXY_MAX_BODY_BYTES) {
                res.writeHead(413).end();
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (res.writableEnded) {
                return;
            }
            let message;
            try {
                message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
                res.writeHead(400).end();
                return;
            }
            if (!isPlainObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
                res.writeHead(400).end();
                return;
            }
            const alive = route.child.exitCode === null && !route.child.stdin.destroyed;
            if (message.id === undefined) {
                if (alive) {
                    route.child.stdin.write(`${JSON.stringify(message)}\n`);
                }
                res.writeHead(202).end();
                return;
            }
            // Only primitive ids can be matched to a reply; anything else would hang the request.
            if (typeof message.id !== 'string' && !Number.isInteger(message.id)) {
                res.writeHead(400).end();
                return;
            }
            if (!alive) {
                res.writeHead(502).end();
                return;
            }
            if (route.waiting.has(message.id)) {
                res.writeHead(409).end();
                return;
            }
            if (route.waiting.size >= MCP_PROXY_MAX_PENDING) {
                res.writeHead(503).end();
                return;
            }
            route.waiting.set(message.id, reply => {
                if (res.writableEnded) {
                    return;
                }
                if (!reply) {
                    res.writeHead(502).end();
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(reply));
            });
            // `res` closes when the client goes away (Node's `req` closes as soon as the body is read).
            res.on('close', () => {
                if (!res.writableEnded) {
                    route.waiting.delete(message.id);
                }
            });
            route.child.stdin.write(`${JSON.stringify(message)}\n`);
        });
    });
    // Long delegation waits keep a request open for minutes; connections are few and bounded.
    server.requestTimeout = 0;
    server.maxConnections = MCP_PROXY_MAX_CONNECTIONS;
    server.headersTimeout = 30000;
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    hostHeader = `127.0.0.1:${port}`;
    return {
        entries: servers.map((entry, index) => ({
            type: 'http', name: entry.name, url: `http://127.0.0.1:${port}/mcp/${index}`,
            headers: [{ name: 'Authorization', value: `Bearer ${secret}` }],
        })),
        close: () => {
            server.close();
            server.closeAllConnections?.();
            for (const child of children) {
                child.kill('SIGTERM');
            }
        },
    };
}

/** Splits a text stream into lines; a line longer than 64 KiB is cut so a hostile agent cannot grow the buffer. */
export class LineSplitter {
    constructor(onLine) {
        this.onLine = onLine;
        this.buffer = '';
    }

    push(chunk) {
        this.buffer += chunk;
        let newline;
        while ((newline = this.buffer.indexOf('\n')) >= 0) {
            this.onLine(this.buffer.slice(0, newline).replace(/\r$/, ''));
            this.buffer = this.buffer.slice(newline + 1);
        }
        while (this.buffer.length > 65536) {
            this.onLine(this.buffer.slice(0, 65536));
            this.buffer = this.buffer.slice(65536);
        }
    }

    flush() {
        if (this.buffer) {
            this.onLine(this.buffer);
            this.buffer = '';
        }
    }
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
    const shownTools = new Map();
    const out = lines => {
        if (flavor.output === 'text') {
            const text = renderLinesAsText(lines, shownTools);
            if (text) {
                io.writeOut(text);
            }
            return;
        }
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
        const argv = buildAgentArgv(flavor, options.agentArgv, io.env);
        child = io.spawnAgent(argv[0], argv.slice(1), buildAgentEnv(io.env, flavor));
    } catch (error) {
        note(`Could not start ${flavor.agentId}: ${error instanceof Error ? error.message : String(error)}`);
        return EXIT.SPAWN;
    }

    let nextId = 1;
    const pending = new Map();
    const pendingPermissions = new Set();
    let sessionId;
    let finished = false;
    // Set on SIGTERM: from then on no permission reaches the gate and every pending one is answered `cancelled`.
    let cancelling = false;
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

    // MCP servers for session/new: stdio entries as given, or (Copilot) the same servers behind a loopback HTTP proxy.
    let mcpProxy;
    const sessionMcpServers = async () => {
        const servers = io.mcpServers ?? [];
        if (servers.length === 0) {
            return [];
        }
        if (flavor.mcpStdio) {
            return servers;
        }
        if (flavor.mcpHttpProxy && io.startMcpHttpProxy) {
            const proxy = await io.startMcpHttpProxy(servers);
            if (finished || cancelling) {
                // The turn ended while the proxy started: it must not outlive it.
                proxy.close();
                return [];
            }
            mcpProxy = proxy;
            return proxy.entries;
        }
        note(`${flavor.agentId} does not take the delegation tools in this mode.`);
        return [];
    };

    const answerPermission = async message => {
        const params = isPlainObject(message.params) ? message.params : {};
        const respond = outcome => send({ id: message.id, result: { outcome } });
        if (sessionId === undefined || params.sessionId !== sessionId || cancelling || finished) {
            respond({ outcome: 'cancelled' });
            return;
        }
        const toolCall = isPlainObject(params.toolCall) ? params.toolCall : {};
        const callId = typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : undefined;
        const known = callId ? translator.tools.get(callId) : undefined;
        const kind = typeof toolCall.kind === 'string' ? toolCall.kind : known?.kind ?? 'other';
        // The permission's own input wins: it describes what runs if granted.
        const rawInput = { ...(isPlainObject(known?.rawInput) ? known.rawInput : {}), ...(isPlainObject(toolCall.rawInput) ? toolCall.rawInput : {}) };
        const locations = Array.isArray(toolCall.locations) && toolCall.locations.length > 0 ? toolCall.locations : known?.locations ?? [];
        const input = canonicalToolInput(kind, rawInput, locations, io.cwd);
        const refusal = refusePermissionLocally(options.mode, kind, input);
        if (refusal) {
            note(`Blocked: ${refusal}`);
            respond(choosePermissionOption(params.options, false));
            return;
        }
        const token = { cancelled: false };
        pendingPermissions.add(token);
        const heartbeat = setInterval(() => out([{ type: 'system', subtype: 'qaap_heartbeat' }]), HEARTBEAT_MS);
        let decision;
        try {
            decision = await io.askGate({
                agentId: flavor.agentId,
                // The server recomputes the kind from the tool name; this is informational only.
                toolKind: 'other',
                rawToolName: gateToolName(flavor, kind, known?.name ?? (typeof toolCall.title === 'string' ? toolCall.title : kind)),
                input,
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
        if (token.cancelled || cancelling || finished) {
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
    // Prefixed line by line: the runner logs stderr next to stdout, and agent text must never pass for a
    // stream-json line or a Qaap note.
    const stderrLines = new LineSplitter(line => io.writeErr(`[agent] ${line}\n`));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => stderrLines.push(chunk));
    child.stderr.on('end', () => stderrLines.flush());
    child.on('error', error => fail(EXIT.SPAWN, `Could not start ${flavor.agentId}: ${error.message}`));
    child.on('close', (code, signal) => {
        for (const entry of pending.values()) {
            entry.reject(Object.assign(new Error('agent exited'), { exited: true }));
        }
        pending.clear();
        fail(EXIT.AGENT_DIED, finished ? undefined : `${flavor.agentId} exited before the turn ended (${signal ?? `code ${code}`}).`);
    });

    const cancel = () => {
        cancelling = true;
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
            created = await request('session/new', { cwd: io.cwd, mcpServers: await sessionMcpServers() });
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
        const code = exitForStopReason(stopReason);
        // Before the result line: the runner may end the process shortly after it.
        if (code === EXIT.REFUSAL) {
            note(`${flavor.agentId} refused to continue.`);
        } else if (code === EXIT.LIMIT) {
            note(`${flavor.agentId} stopped at a limit (${stopReason}).`);
        }
        out(translator.result(stopReason, isPlainObject(result) ? result.usage : undefined));
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
    mcpProxy?.close();
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
        if (options.gateClientSha256) {
            // A staged copy could have been rewritten by a process of the agent's uid: load only the expected bytes.
            const source = readFileSync(client);
            if (createHash('sha256').update(source).digest('hex') !== options.gateClientSha256) {
                throw new Error('the gate client does not match its expected hash');
            }
            ({ askGate } = await import(`data:text/javascript;base64,${source.toString('base64')}`));
        } else {
            ({ askGate } = await import(pathToFileURL(client).toString()));
        }
        if (typeof askGate !== 'function') {
            throw new Error('the gate client exports no askGate');
        }
    } catch (error) {
        process.stderr.write(`[qaap] The ACP bridge could not load its gate client (${error instanceof Error ? error.message : String(error)}).\n`);
        process.exitCode = EXIT.USAGE;
        return;
    }
    let mcpServers = [];
    if (options.mcpServers) {
        try {
            mcpServers = parseMcpServers(readFileSync(options.mcpServers, 'utf8'));
        } catch (error) {
            process.stderr.write(`[qaap] The ACP bridge could not read its MCP servers (${error instanceof Error ? error.message : String(error)}).\n`);
            process.exitCode = EXIT.USAGE;
            return;
        }
    }
    // A harness whose native CLI takes `--prompt-file` (Grok) hands the bridge the same file; otherwise stdin.
    let prompt;
    try {
        prompt = options.promptFile ? readFileSync(options.promptFile, 'utf8') : await readStdin();
    } catch (error) {
        process.stderr.write(`[qaap] The ACP bridge could not read its prompt (${error instanceof Error ? error.message : String(error)}).\n`);
        process.exitCode = EXIT.USAGE;
        return;
    }
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
        mcpServers,
        startMcpHttpProxy: servers => startMcpHttpProxy(servers, entry => spawn(entry.command, entry.args, {
            env: { ...buildAgentEnv(process.env, FLAVORS[options.flavor]), ...Object.fromEntries(entry.env.map(pair => [pair.name, pair.value])) },
            stdio: ['pipe', 'pipe', 'ignore'],
        })),
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
