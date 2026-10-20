// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    extractAgentAuthLoginChallenge,
    localizeAgentAuthFailureMessage,
} from './qaap-agent-auth-login';
import { localizeHostedMissingCodingAgentMessage, readQaapHostedRuntime } from './qaap-hosted-agent-auth-policy';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import { extractAgentTurnError } from './qaap-research-agent-log';
import { isAgentToolResultFailure, isTranscriptErrorOutput } from './qaap-transcript-content-display';
import { resolveAgentMessageSegments } from './qaap-transcript-trace-model';

export type QaapAgentFailureKind =
    | 'quota'
    | 'rate_limit'
    | 'model_unavailable'
    | 'tool_unsupported'
    | 'auth'
    | 'timeout'
    | 'network'
    | 'cli_missing';

export type QaapAgentTurnFailureState = 'failed' | 'interrupted' | 'cancelled';

const AGENT_FAILURE_SCAN_LIMIT = 12_000;
const AGENT_LOG_HINT_MAX_LENGTH = 220;
const COLLAPSED_FAILURE_REASON_MAX_LENGTH = 96;
const ANSI_REGEX = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const WINDOWS_CMD_ERROR_LINE = /^(FIND|DIR|COPY|XCOPY|DEL|ERASE|MOVE|REN|RENAME|TYPE|CMD|WHERE|FC|MORE):\s+\S/i;

const QUOTA_PATTERNS: readonly RegExp[] = [
    /\binsufficient[_\s-]?quota\b/i,
    /\bquota\b/i,
    /\bfree[_\s-]?credits?\b/i,
    /\bcredits?\s+(?:exhausted|depleted|used\s+up|ran\s+out)\b/i,
    /\bout\s+of\s+credits?\b/i,
    // Hugging Face router: "You have depleted your monthly included credits."
    /\bdepleted\s+your\b[^.\n]{0,40}\bcredits?\b/i,
    /\bbilling\b/i,
    /\bresource[_\s-]?exhausted\b/i,
];

const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
    /\brate[_\s-]?limit(?:ed|ing)?\b/i,
    /\btoo\s+many\s+requests\b/i,
    /\b429\b/,
];

const MODEL_UNAVAILABLE_PATTERNS: readonly RegExp[] = [
    /\bissue\s+with\s+the\s+selected\s+model\b/i,
    /\bmodel\s+(?:is\s+)?unavailable\b/i,
    /\bmodel[_\s-]?not[_\s-]?found\b/i,
    /\bmodel\s+does\s+not\s+exist\b/i,
    /\bno\s+such\s+model\b/i,
    /\bunknown\s+model\b/i,
    /\bmodel\s+not\s+supported\b/i,
];

const TOOL_UNSUPPORTED_PATTERNS: readonly RegExp[] = [
    // OpenRouter 404 when `tools` is sent to a model without a tool-capable endpoint.
    /\bno\s+endpoints\s+found\s+that\s+support\s+tool\s+use\b/i,
    /\bdoes\s+not\s+support\s+(?:tools?|tool\s+use|tool\s+calls?|function\s+calling)\b/i,
    /\btool[_\s-]?(?:use|calls?|calling)\s+(?:is\s+|are\s+)?not\s+supported\b/i,
    /\bfunction[_\s-]?calling\s+(?:is\s+)?not\s+supported\b/i,
];

/** Auth declarations unambiguous enough to trust wherever the CLI printed them. */
const AUTH_PATTERNS: readonly RegExp[] = [
    /\binvalid[_\s-]?api[_\s-]?key\b/i,
    /\bincorrect\s+api\s+key\b/i,
    /\bauthentication_failed\b/i,
    /\bauthentication\s+failed\b/i,
    /\bfailed\s+to\s+authenticate\b/i,
    /\boauth\s+session\b/i,
    /\bnot\s+logged\s+in\b/i,
    /\bplease\s+run\s+\/login\b/i,
    /\brun\s+\/login\b/i,
    /\bauth(?:entication)?\s+is\s+required\b/i,
    /\bcodex\s+auth\b/i,
    /\bCODEX_API_KEY\b/,
];

/**
 * Bare status words that also show up in tool output (a `curl` 403, a file named
 * `unauthorized.tsx`). They only mean "sign in" inside the CLI's own error envelope.
 */
const AUTH_ENVELOPE_ONLY_PATTERNS: readonly RegExp[] = [
    /\bauthentication\b/i,
    /\bunauthorized\b/i,
    /\b401\b/,
    /\b403\b/,
    /\bforbidden\b/i,
    /\baccess\s+denied\b/i,
];

/** A plain-text line the agent CLI itself prints for a provider/API failure. */
const CLI_ERROR_ENVELOPE_LINE = /^(?:error\b|api\s+error\b|fatal\b|unexpected\s+status\b|http\/?[\d.]*\s+\d{3}\b|status(?:\s+code)?:?\s*\d{3}\b)/i;

/** Line the task runner writes when it kills a run that stopped producing output. */
const RUNNER_IDLE_TIMEOUT_LINE = /\[qaap\] task timed out after (\d+)s without output\./;

const TIMEOUT_PATTERNS: readonly RegExp[] = [
    /\btimeout\b/i,
    /\btimed\s+out\b/i,
    /\bETIMEDOUT\b/,
    /\bdeadline\s+exceeded\b/i,
];

const CLI_MISSING_NAMES = 'qaiq|openclaude|cursor-agent|codex|claude|opencode|grok|agent';
const CLI_MISSING_PATTERNS: readonly RegExp[] = [
    new RegExp(`\\bcommand\\s+not\\s+found:\\s*(${CLI_MISSING_NAMES})\\b`, 'i'),
    new RegExp(`\\b(${CLI_MISSING_NAMES}):\\s*(?:command\\s+)?not\\s+found\\b`, 'i'),
    new RegExp(`\\bENOENT[^\\n]*(?:\\/|\\s)(${CLI_MISSING_NAMES})\\b`, 'i'),
    new RegExp(`\\bspawn\\s+(?:${CLI_MISSING_NAMES})\\s+ENOENT\\b`, 'i'),
    new RegExp(`\\b(?:${CLI_MISSING_NAMES})\\b[^\\n]*\\bis\\s+not\\s+recognized\\s+as\\s+an\\s+internal\\s+or\\s+external\\s+command\\b`, 'i'),
    new RegExp(`\\b(?:${CLI_MISSING_NAMES})\\b[^\\n]*\\bno\\s+such\\s+file\\s+or\\s+directory\\b`, 'i'),
    new RegExp(`\\bno\\s+such\\s+file\\s+or\\s+directory[^\\n]*(${CLI_MISSING_NAMES})\\b`, 'i'),
    new RegExp(`\\bcannot\\s+find\\s+(?:the\\s+)?(?:${CLI_MISSING_NAMES})\\s+(?:binary|executable|command)\\b`, 'i'),
];

const NETWORK_PATTERNS: readonly RegExp[] = [
    /\bECONNREFUSED\b/,
    /\bENOTFOUND\b/,
    /\bEAI_AGAIN\b/,
    /\bnetwork\s+error\b/i,
    /\bfetch\s+failed\b/i,
    /\bconnection\s+(?:refused|reset)\b/i,
];

const LEGACY_AGENT_FAILURE_REGEX = /^Agent\s+(failed|interrupted|cancelled)(?:\s+\(exit\s+(\d+)\))?\.?$/i;

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
}

function sanitizeFailureDisplayText(text: string): string {
    return text.replace(/\uFFFD+/g, '').trim();
}

function truncateAgentFailureHint(text: string): string {
    const trimmed = sanitizeFailureDisplayText(text);
    if (trimmed.length <= AGENT_LOG_HINT_MAX_LENGTH) {
        return trimmed;
    }
    return `${trimmed.slice(0, AGENT_LOG_HINT_MAX_LENGTH - 1)}…`;
}

function truncateCollapsedFailureReason(text: string): string {
    const trimmed = sanitizeFailureDisplayText(text);
    if (trimmed.length <= COLLAPSED_FAILURE_REASON_MAX_LENGTH) {
        return trimmed;
    }
    return `${trimmed.slice(0, COLLAPSED_FAILURE_REASON_MAX_LENGTH - 1)}…`;
}

function firstMeaningfulFailureLine(text: string | undefined): string | undefined {
    if (!text) {
        return undefined;
    }
    for (const line of text.replace(ANSI_REGEX, '').split('\n')) {
        const trimmed = sanitizeFailureDisplayText(line);
        if (trimmed) {
            return trimmed;
        }
    }
    return undefined;
}

function readJsonFailureHint(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const directMessage = record.message;
    if (typeof directMessage === 'string' && directMessage.trim()) {
        return truncateAgentFailureHint(directMessage);
    }
    const error = record.error;
    if (typeof error === 'string' && error.trim()) {
        return truncateAgentFailureHint(error);
    }
    if (error && typeof error === 'object') {
        const nested = readJsonFailureHint(error);
        if (nested) {
            return nested;
        }
    }
    // opencode `run --format json` wraps errors as { name, data: { message } } (NamedError).
    const data = record.data;
    if (data && typeof data === 'object') {
        const nested = readJsonFailureHint(data);
        if (nested) {
            return nested;
        }
    }
    return undefined;
}

/**
 * What the agent CLI itself said about a failure, kept apart from the tool output it streamed:
 * a `curl` 403 or an `npm error` the agent recovered from is not why the turn died.
 */
interface AgentFailureEvidence {
    /** Error text of the CLI's final result envelope (`is_error` result, Codex `turn.failed`). */
    readonly envelope?: string;
    /** Raw top-level error records (`{"type":"error"}`, provider error bodies), newest first. */
    readonly errorRecords: readonly string[];
    /** Lines outside the JSON stream (CLI stderr/stdout, runner notes), in log order. */
    readonly plainLines: readonly string[];
}

const FINAL_ENVELOPE_SCAN_LINES = 200;
const FINAL_ENVELOPE_LINE = /^\{\s*"type"\s*:\s*"(?:result|turn\.failed|turn\.completed)"/;

/** The last {@link AGENT_FAILURE_SCAN_LIMIT} characters, starting on a whole line: the death is at the end. */
function tailOfAgentLog(log: string): string {
    if (log.length <= AGENT_FAILURE_SCAN_LIMIT) {
        return log;
    }
    const tail = log.slice(-AGENT_FAILURE_SCAN_LIMIT);
    const lineStart = tail.indexOf('\n');
    return lineStart >= 0 ? tail.slice(lineStart + 1) : tail;
}

/** Error of the newest final envelope; `undefined` when that envelope reports success or none exists. */
function findFinalErrorEnvelope(log: string): string | undefined {
    let end = log.length;
    for (let scanned = 0; end > 0 && scanned < FINAL_ENVELOPE_SCAN_LINES; scanned++) {
        const start = log.lastIndexOf('\n', end - 1) + 1;
        const line = log.slice(start, end).trim();
        end = start - 1;
        if (FINAL_ENVELOPE_LINE.test(line)) {
            return extractAgentTurnError(line);
        }
    }
    return undefined;
}

function isTopLevelErrorRecord(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    if (record.type === 'error') {
        return true;
    }
    // Raw provider bodies (`{"error":{…}}`) have no stream type; typed stream records such as
    // `{"type":"system","subtype":"api_retry","error":"rate_limit"}` are retries, not the death.
    return record.type === undefined && record.error !== undefined && record.error !== null;
}

function collectAgentFailureEvidence(log: string | undefined): AgentFailureEvidence {
    const full = (log ?? '').trim();
    const errorRecords: string[] = [];
    const plainLines: string[] = [];
    if (!full) {
        return { errorRecords, plainLines };
    }
    for (const rawLine of tailOfAgentLog(full).replace(ANSI_REGEX, '').split('\n')) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        if (line.startsWith('{') || line.startsWith('[')) {
            try {
                if (isTopLevelErrorRecord(JSON.parse(line))) {
                    errorRecords.unshift(line);
                }
                continue;
            } catch {
                /* not JSON: CLI text that happens to start with a brace */
            }
        }
        plainLines.push(line);
    }
    return { envelope: findFinalErrorEnvelope(full), errorRecords, plainLines };
}

/** Everything the CLI said about the failure (envelope, error records, plain lines). */
function agentFailureEvidenceText(evidence: AgentFailureEvidence): string {
    return [evidence.envelope, ...evidence.errorRecords, ...evidence.plainLines]
        .filter((part): part is string => !!part)
        .join('\n');
}

/** Only the CLI's own error envelope — where a bare 401/403/"forbidden" really means auth. */
function agentFailureEnvelopeText(evidence: AgentFailureEvidence): string {
    return [evidence.envelope, ...evidence.errorRecords, ...evidence.plainLines.filter(line => CLI_ERROR_ENVELOPE_LINE.test(line))]
        .filter((part): part is string => !!part)
        .join('\n');
}

function isPlainFailureHintLine(line: string): boolean {
    return /^(Error|error|npm error|failed to|Cannot find|fatal:)/i.test(line)
        // Windows cmd.exe: "FIND: formato de parámetros incorrecto"
        || WINDOWS_CMD_ERROR_LINE.test(line)
        || /\bis not recognized as an internal or external command\b/i.test(line)
        || /^The system cannot find (?:the )?(?:path|file) specified/i.test(line)
        || /command line is too long|l[ií\uFFFD]?nea de comandos es demasiado larga/i.test(line)
        // QAIQ/Codex often emit a bare credential line without an `Error:` prefix
        // ("Codex auth is required for gpt-5.5. Set CODEX_API_KEY…").
        || /\b(?:auth(?:entication)?\s+is\s+required|CODEX_API_KEY|invalid[_\s-]?api[_\s-]?key)\b/i.test(line);
}

/** npm closes every failure with the same footer; the cause is the first line of its block. */
const NPM_ERROR_PREFIX = /^npm error\b/i;
const NPM_ERROR_BOILERPLATE = /^npm error\s*(?:$|A complete log of this run|To see a list of|\s+npm run\b)/i;

function extractPlainFailureHint(lines: readonly string[]): string | undefined {
    for (let index = lines.length - 1; index >= 0; index--) {
        if (!isPlainFailureHintLine(lines[index])) {
            continue;
        }
        if (NPM_ERROR_PREFIX.test(lines[index])) {
            let blockStart = index;
            while (blockStart > 0 && NPM_ERROR_PREFIX.test(lines[blockStart - 1])) {
                blockStart--;
            }
            const cause = lines.slice(blockStart, index + 1).find(line => !NPM_ERROR_BOILERPLATE.test(line));
            return truncateAgentFailureHint(cause ?? lines[index]);
        }
        return truncateAgentFailureHint(lines[index]);
    }
    return undefined;
}

/**
 * Pull a short, readable hint from agent stderr/stdout when no known kind matches. Reads the end
 * of the log and prefers the CLI's final error envelope over anything streamed before it.
 */
export function extractAgentLogFailureHint(log: string | undefined): string | undefined {
    const evidence = collectAgentFailureEvidence(log);
    if (evidence.envelope) {
        return truncateAgentFailureHint(evidence.envelope.replace(/\s+/g, ' '));
    }
    for (const record of evidence.errorRecords) {
        const hint = readJsonFailureHint(JSON.parse(record));
        if (hint) {
            return hint;
        }
    }
    return extractPlainFailureHint(evidence.plainLines);
}

/**
 * One-line reason for the collapsed "Task failed" banner so the user does not
 * have to open "Show details" to learn why the turn stopped.
 */
export function summarizeCollapsedAgentFailure(input: {
    readonly formatted: string;
    readonly generic: string;
    readonly technicalContent?: string;
    readonly persistedError?: string;
    readonly exitCode?: number;
}): string | undefined {
    const sample = [input.technicalContent, input.persistedError]
        .filter((part): part is string => !!part?.trim())
        .join('\n');
    const hint = extractAgentLogFailureHint(sample) ?? extractAgentLogFailureHint(input.formatted);
    if (hint) {
        return truncateCollapsedFailureReason(hint);
    }
    if (!input.formatted || input.formatted === input.generic) {
        const first = firstMeaningfulFailureLine(input.technicalContent);
        if (first && first !== input.generic) {
            return truncateCollapsedFailureReason(first);
        }
    }
    if (input.exitCode !== undefined && input.exitCode !== 0) {
        return nls.localize('qaap/agentFailure/exitCodeShort', 'Exit code {0}', String(input.exitCode));
    }
    return undefined;
}

/** Classify agent CLI/API stderr or transcript text for user-facing failure copy. */
export function detectAgentFailureKind(log: string | undefined): QaapAgentFailureKind | undefined {
    return classifyAgentFailureEvidence(collectAgentFailureEvidence(log));
}

function classifyAgentFailureEvidence(evidence: AgentFailureEvidence): QaapAgentFailureKind | undefined {
    const sample = agentFailureEvidenceText(evidence);
    if (!sample) {
        return undefined;
    }
    if (matchesAny(sample, CLI_MISSING_PATTERNS)) {
        return 'cli_missing';
    }
    if (matchesAny(sample, QUOTA_PATTERNS)) {
        return 'quota';
    }
    if (matchesAny(sample, RATE_LIMIT_PATTERNS)) {
        return 'rate_limit';
    }
    // Before model_unavailable: "does not support tool use" must not read as a missing model.
    if (matchesAny(sample, TOOL_UNSUPPORTED_PATTERNS)) {
        return 'tool_unsupported';
    }
    if (matchesAny(sample, MODEL_UNAVAILABLE_PATTERNS)) {
        return 'model_unavailable';
    }
    if (matchesAny(sample, AUTH_PATTERNS) || matchesAny(agentFailureEnvelopeText(evidence), AUTH_ENVELOPE_ONLY_PATTERNS)) {
        return 'auth';
    }
    if (matchesAny(sample, TIMEOUT_PATTERNS)) {
        return 'timeout';
    }
    if (matchesAny(sample, NETWORK_PATTERNS)) {
        return 'network';
    }
    return undefined;
}

export function localizeAgentFailureMessage(kind: QaapAgentFailureKind): string {
    switch (kind) {
        case 'quota':
            return nls.localize(
                'qaap/agentFailure/quotaReached',
                'This model has reached its quota. Switch model or effort in the composer, or wait until the limit resets.',
            );
        case 'rate_limit':
            return nls.localize(
                'qaap/agentFailure/rateLimited',
                'Rate limit reached for this model. Wait a moment or switch model or effort in the composer.',
            );
        case 'model_unavailable':
            return nls.localize(
                'qaap/agentFailure/modelUnavailable',
                'This model is unavailable. Try OpenCode or another model in the composer.',
            );
        case 'tool_unsupported':
            return nls.localize(
                'qaap/agentFailure/toolUnsupported',
                'This model can\'t use tools (function calling), which the coding agent needs. Pick another model in the composer.',
            );
        case 'auth':
            // Prefer session-login copy; callers with a log should use
            // {@link localizeAgentAuthFailureMessage} via {@link resolveAgentTurnFailureMessage}.
            return localizeAgentAuthFailureMessage({ mode: 'session' });
        case 'timeout':
            return nls.localize(
                'qaap/agentFailure/timeout',
                'The agent timed out before finishing. Try a shorter prompt or switch model.',
            );
        case 'network':
            return nls.localize(
                'qaap/agentFailure/network',
                'The agent could not reach the model provider. Check your connection and try again.',
            );
        case 'cli_missing':
            return localizeMissingCodingAgentMessage();
    }
}

/** Shown when Work Hub would otherwise run a natural-language prompt as a raw Shell command. */
export function localizeMissingCodingAgentMessage(): string {
    if (readQaapHostedRuntime()) {
        return localizeHostedMissingCodingAgentMessage();
    }
    return nls.localize(
        'qaap/agentFailure/noCodingAgent',
        'No coding agent CLI is installed. Install Cursor Agent, QAIQ, Claude Code, Codex, or OpenCode, then restart Qaap.',
    );
}

/** Shown when the Qaap Work Hub flow specifically requires the QAIQ runtime. */
export function localizeMissingQaiqMessage(): string {
    return nls.localize(
        'qaap/agentFailure/qaiqMissing',
        'QAIQ is not installed or is not on the server PATH. Install QAIQ in the QAAP server/container, then restart the backend and try again.',
    );
}

export function localizeGenericAgentFailureMessage(
    state: QaapAgentTurnFailureState,
    exitCode?: number,
): string {
    switch (state) {
        case 'interrupted':
            return nls.localize(
                'qaap/agentFailure/interrupted',
                'The agent stopped before it could finish — often after a server restart. Send a follow-up to continue.',
            );
        case 'cancelled':
            return nls.localize(
                'qaap/agentFailure/cancelled',
                'This turn was cancelled.',
            );
        case 'failed':
        default:
            if (exitCode === undefined) {
                return nls.localize(
                    'qaap/agentFailure/failedToStart',
                    'The agent could not start this turn. Check your agent setup and try again.',
                );
            }
            return nls.localize(
                'qaap/agentFailure/stoppedUnexpectedly',
                'The agent stopped unexpectedly. Retry, or send a follow-up to continue.',
            );
    }
}

/** Why the backend paused a turn that was still streaming: silence, or the absolute cap. */
export type QaapAgentTurnTimeoutCause = 'idle' | 'max_duration';

/**
 * Reason recorded when the backend pauses a turn (turn watchdog or the task runner's idle
 * timer). The turn ends `interrupted`, so the copy points at Continue rather than Retry. It
 * starts with "Timed out" so that any reader of `TIMEOUT_PATTERNS` classifies it too.
 */
export function localizeAgentTurnTimeoutMessage(cause: QaapAgentTurnTimeoutCause, minutes: number): string {
    const rounded = String(Math.max(1, Math.round(minutes)));
    if (cause === 'idle') {
        return nls.localize(
            'qaap/agentFailure/idleTimeout',
            'Timed out after {0} minutes without output. Continue to pick up where it left off.',
            rounded,
        );
    }
    return nls.localize(
        'qaap/agentFailure/maxDuration',
        'Timed out at the {0}-minute task limit. Continue to pick up where it left off.',
        rounded,
    );
}

/** Persisted (English, backend-locale) forms of {@link localizeAgentTurnTimeoutMessage}. */
const STORED_IDLE_TIMEOUT = /^Timed out after (\d+) minutes without output\./;
const STORED_MAX_DURATION = /^Timed out at the (\d+)-minute task limit\./;
/** Watchdog copy persisted before the inactivity timeout existed. */
const LEGACY_WATCHDOG_STOP = /^Stopped automatically after .+: the turn exceeded the maximum allowed time\.?$/;
/** Copy recorded when a backend restart (or a failed restart resume) killed the turn. */
const RESTART_INTERRUPTED = /^The backend restarted while this turn was in progress\b/;

function formatStoredAgentTurnTimeout(error: string): string | undefined {
    const idle = STORED_IDLE_TIMEOUT.exec(error);
    if (idle) {
        return localizeAgentTurnTimeoutMessage('idle', Number(idle[1]));
    }
    const max = STORED_MAX_DURATION.exec(error);
    if (max) {
        return localizeAgentTurnTimeoutMessage('max_duration', Number(max[1]));
    }
    return undefined;
}

function isStoredAgentTurnTimeout(error: string): boolean {
    return STORED_IDLE_TIMEOUT.test(error) || STORED_MAX_DURATION.test(error) || LEGACY_WATCHDOG_STOP.test(error);
}

/**
 * True when a persisted turn error means the turn was cut short (timeout pause, backend
 * restart) rather than failing on its own — the row and card should offer Continue, not Retry.
 */
export function isAgentTurnInterruptedError(error: string | undefined): boolean {
    const trimmed = error?.trim() ?? '';
    if (!trimmed) {
        return false;
    }
    if (isStoredAgentTurnTimeout(trimmed) || RESTART_INTERRUPTED.test(trimmed)) {
        return true;
    }
    const legacy = LEGACY_AGENT_FAILURE_REGEX.exec(trimmed);
    return legacy?.[1].toLowerCase() === 'interrupted' || trimmed === localizeGenericAgentFailureMessage('interrupted');
}

/** Normalize legacy technical copy persisted on older conversations. */
export function formatStoredAgentFailureMessage(error: string | undefined): string {
    const trimmed = (error ?? '').trim();
    if (!trimmed) {
        return '';
    }
    const legacy = LEGACY_AGENT_FAILURE_REGEX.exec(trimmed);
    if (legacy) {
        const state = legacy[1].toLowerCase() as QaapAgentTurnFailureState;
        const exitCode = legacy[2] ? Number(legacy[2]) : undefined;
        return localizeGenericAgentFailureMessage(state, exitCode);
    }
    const timeout = formatStoredAgentTurnTimeout(trimmed);
    if (timeout) {
        return timeout;
    }
    const kind = detectAgentFailureKind(trimmed);
    if (kind) {
        return localizeAgentFailureMessage(kind);
    }
    return trimmed;
}

export interface QaapAgentFailedToolContext {
    readonly name: string;
    readonly args?: string;
    readonly result?: string;
    readonly exitCode?: number;
}

export interface QaapAgentTurnFailureOptions {
    readonly log?: string;
    readonly state?: QaapAgentTurnFailureState;
    readonly exitCode?: number;
    readonly agentMessage?: Pick<QaapAgentMessageDTO, 'segments' | 'traceEvents' | 'role' | 'content'>;
    /** Harness of the turn: a key error of a sign-in harness (every one but QAIQ) asks for sign-in. */
    readonly agentId?: string;
}

function parseExitCodeFromToolResult(result: string | undefined): number | undefined {
    if (!result?.trim()) {
        return undefined;
    }
    const match = /(?:exit(?:\s+code)?|code)\s*[:=]?\s*(\d+)/i.exec(result)
        ?? /exited with (?:code )?(\d+)/i.exec(result);
    if (!match) {
        return undefined;
    }
    const code = Number(match[1]);
    return Number.isFinite(code) ? code : undefined;
}

function isFailedToolSegment(
    segment: { readonly name?: string; readonly finished?: boolean; readonly result?: string },
): boolean {
    if (!segment.finished) {
        return false;
    }
    // A tool that finished without a result told us nothing; it is not evidence of failure.
    const result = segment.result?.trim() ?? '';
    if (!result) {
        return false;
    }
    return isAgentToolResultFailure(result, { toolName: segment.name }) || isTranscriptErrorOutput(result);
}

/**
 * The tool to blame for a turn failure — only when a failed tool call was the agent's LAST step
 * before it died. A failure the agent moved past (another tool, or a reply) is not the cause.
 */
export function extractLastFailedToolFromMessage(
    message: Pick<QaapAgentMessageDTO, 'segments' | 'traceEvents' | 'role' | 'content'> | undefined,
): QaapAgentFailedToolContext | undefined {
    if (!message || message.role !== 'agent') {
        return undefined;
    }
    const segments = resolveAgentMessageSegments(message);
    for (let index = segments.length - 1; index >= 0; index--) {
        const segment = segments[index];
        if (segment.type === 'thinking' || (segment.type === 'text' && !segment.content.trim())) {
            continue;
        }
        if (segment.type !== 'tool' || !isFailedToolSegment(segment)) {
            return undefined;
        }
        const result = segment.result?.trim() ?? '';
        return {
            name: segment.name,
            args: segment.args,
            result: result || undefined,
            exitCode: parseExitCodeFromToolResult(result),
        };
    }
    return undefined;
}

/** Technical body for failure details — prefers persisted content, then failed tool stdout/stderr. */
export function resolveAgentTurnFailureTechnicalContent(
    message: Pick<QaapAgentMessageDTO, 'content' | 'segments' | 'traceEvents' | 'role' | 'error'> | undefined,
    log?: string,
): string | undefined {
    const persisted = message?.content?.trim();
    const summary = message?.error?.trim();
    if (persisted && persisted !== summary) {
        return persisted;
    }
    const failedTool = extractLastFailedToolFromMessage(message);
    if (failedTool?.result?.trim()) {
        return failedTool.result;
    }
    const trimmedLog = log?.trim();
    return trimmedLog || undefined;
}

/**
 * User-facing turn failure — prefers product copy derived from agent logs over exit codes.
 */
export function resolveAgentTurnFailureMessage(
    log: string | undefined,
    options?: QaapAgentTurnFailureOptions | string,
): string {
    const resolvedOptions: QaapAgentTurnFailureOptions = typeof options === 'string'
        ? { state: 'failed' }
        : (options ?? { state: 'failed' });
    const evidence = collectAgentFailureEvidence(log);
    const idleTimeout = RUNNER_IDLE_TIMEOUT_LINE.exec(evidence.plainLines.join('\n'));
    if (idleTimeout) {
        return localizeAgentTurnTimeoutMessage('idle', Number(idleTimeout[1]) / 60);
    }
    const kind = classifyAgentFailureEvidence(evidence);
    const challengeOptions = resolvedOptions.agentId ? { agentId: resolvedOptions.agentId } : undefined;
    if (kind === 'auth') {
        return localizeAgentAuthFailureMessage(extractAgentAuthLoginChallenge(agentFailureEvidenceText(evidence), challengeOptions));
    }
    if (kind === 'quota' || kind === 'rate_limit') {
        // Prefer the provider's concrete line (incl. "Resets in …") over generic copy.
        const hint = extractAgentLogFailureHint(log);
        if (hint && detectAgentFailureKind(hint) === kind) {
            return hint.replace(/^Error:\s*/i, '').trim();
        }
        return localizeAgentFailureMessage(kind);
    }
    if (kind) {
        return localizeAgentFailureMessage(kind);
    }
    const failedTool = extractLastFailedToolFromMessage(resolvedOptions.agentMessage);
    const logHint = extractAgentLogFailureHint(log);
    if (logHint && !isHintFromRecoveredTool(logHint, resolvedOptions.agentMessage, failedTool)) {
        return nls.localize(
            'qaap/agentFailure/logHint',
            'The agent hit an error: {0}',
            logHint,
        );
    }
    if (failedTool) {
        const toolLog = failedTool.result;
        // Tool output is the workspace talking, not the agent CLI: a 403 from `curl` or a 429
        // from the npm registry is a failed command, not a sign-in or model quota problem.
        // Only a missing agent CLI (the agent shelling out to itself) keeps its setup copy.
        if (detectAgentFailureKind(toolLog) === 'cli_missing') {
            return localizeAgentFailureMessage('cli_missing');
        }
        const toolHint = extractAgentLogFailureHint(toolLog);
        if (toolHint) {
            return nls.localize(
                'qaap/agentFailure/toolFailedWithHint',
                '{0} failed: {1}',
                failedTool.name,
                toolHint,
            );
        }
        const exitCode = failedTool.exitCode ?? resolvedOptions.exitCode;
        if (exitCode !== undefined && exitCode !== 0) {
            return nls.localize(
                'qaap/agentFailure/toolExitCode',
                '{0} exited with code {1}.',
                failedTool.name,
                exitCode,
            );
        }
        return nls.localize(
            'qaap/agentFailure/toolFailedGeneric',
            '{0} did not complete successfully.',
            failedTool.name,
        );
    }
    if (resolvedOptions.state) {
        return localizeGenericAgentFailureMessage(resolvedOptions.state, resolvedOptions.exitCode);
    }
    if (typeof options === 'string') {
        return formatStoredAgentFailureMessage(options) || options;
    }
    return localizeGenericAgentFailureMessage('failed', resolvedOptions.exitCode);
}

/**
 * Plain-text CLIs interleave tool output with their own stderr, so an `npm error` line in the log
 * may be from a command the agent already moved past. Such a hint is not why the turn died.
 */
function isHintFromRecoveredTool(
    hint: string,
    message: Pick<QaapAgentMessageDTO, 'segments' | 'traceEvents' | 'role' | 'content'> | undefined,
    terminalFailedTool: QaapAgentFailedToolContext | undefined,
): boolean {
    if (!message || message.role !== 'agent') {
        return false;
    }
    const needle = hint.replace(/…$/, '').slice(0, 80);
    if (!needle || terminalFailedTool?.result?.includes(needle)) {
        return false;
    }
    return resolveAgentMessageSegments(message)
        .some(segment => segment.type === 'tool' && !!segment.result?.includes(needle));
}

/** The short reasons a failed turn is reduced to in rows and card titles. */
export type QaapAgentFailureReasonKind =
    | 'stopped'
    | 'timeout'
    | 'sign_in'
    | 'command_failed'
    | 'usage_limit'
    | 'model'
    | 'agent_setup'
    | 'network';

export interface QaapAgentFailureReason {
    readonly kind: QaapAgentFailureReasonKind;
    /** Short localized reason, e.g. "Timed out" or "A command failed". */
    readonly label: string;
    /** The full persisted message (localized where we own the copy) for a "Details" affordance. */
    readonly detail?: string;
    /** The turn was cut short (timeout pause, restart): offer Continue rather than Retry. */
    readonly interrupted: boolean;
}

export interface QaapAgentFailureReasonOptions {
    /** Agent display name for "Sign in to {agent}"; without it the label reads "Sign in required". */
    readonly agentLabel?: string;
}

/** Persisted copy that names a tool which was the turn's last, failed step. */
const STORED_TOOL_FAILURE = /^(?!(?:Process|Agent)\b)[\w.:/-]+ (?:failed: |exited with code -?\d+\.?$|did not complete successfully\.?$)/;
/** CLI envelopes that end a run after repeated tool failures. */
const REPEATED_TOOL_FAILURE = /\brepeated tool failures\b|\bfailed \d+ times with\b/i;

function classifyStoredAgentFailure(error: string): QaapAgentFailureReasonKind {
    if (isStoredAgentTurnTimeout(error)) {
        return 'timeout';
    }
    if (STORED_TOOL_FAILURE.test(error) || REPEATED_TOOL_FAILURE.test(error)) {
        return 'command_failed';
    }
    if (/needs you to sign in|sign in required/i.test(error)) {
        return 'sign_in';
    }
    switch (detectAgentFailureKind(error)) {
        case 'auth':
            return 'sign_in';
        case 'quota':
        case 'rate_limit':
            return 'usage_limit';
        case 'model_unavailable':
        case 'tool_unsupported':
            return 'model';
        case 'cli_missing':
            return 'agent_setup';
        case 'timeout':
            return 'timeout';
        case 'network':
            return 'network';
        default:
            return 'stopped';
    }
}

function localizeAgentFailureReasonLabel(kind: QaapAgentFailureReasonKind, options?: QaapAgentFailureReasonOptions): string {
    switch (kind) {
        case 'timeout':
            return nls.localize('qaap/agentFailure/reasonTimeout', 'Timed out');
        case 'sign_in': {
            const agentLabel = options?.agentLabel?.trim();
            return agentLabel
                ? nls.localize('qaap/agentFailure/reasonSignInTo', 'Sign in to {0}', agentLabel)
                : nls.localize('qaap/mobileProjects/transcriptSignInRequired', 'Sign in required');
        }
        case 'command_failed':
            return nls.localize('qaap/agentFailure/reasonCommandFailed', 'A command failed');
        case 'usage_limit':
            return nls.localize('qaap/mobileProjects/transcriptQuotaReached', 'Quota reached');
        case 'model':
            return nls.localize('qaap/agentFailure/reasonModelUnavailable', 'Model unavailable');
        case 'agent_setup':
            return nls.localize('qaap/mobileProjects/transcriptAgentCliMissing', 'Agent CLI missing');
        case 'network':
            return nls.localize('qaap/agentFailure/reasonNetwork', 'Could not reach the model provider');
        case 'stopped':
        default:
            return nls.localize('qaap/agentFailure/reasonStopped', 'The agent stopped unexpectedly');
    }
}

/**
 * Reduce a persisted turn failure (`message.error`) to one short localized reason, keeping the
 * full message as {@link QaapAgentFailureReason.detail}. `undefined` only for an empty error.
 */
export function describeAgentTurnFailure(
    error: string | undefined,
    options?: QaapAgentFailureReasonOptions,
): QaapAgentFailureReason | undefined {
    const sample = error?.trim();
    if (!sample) {
        return undefined;
    }
    const kind = classifyStoredAgentFailure(sample);
    const label = localizeAgentFailureReasonLabel(kind, options);
    const formatted = formatStoredAgentFailureMessage(sample);
    return {
        kind,
        label,
        ...(formatted && formatted !== label ? { detail: formatted } : {}),
        interrupted: isAgentTurnInterruptedError(sample),
    };
}

/**
 * Short, user-facing cause for a persisted turn failure (`message.error`): one of the reasons in
 * {@link QaapAgentFailureReasonKind}, e.g. "Sign in required" or "A command failed". Returns
 * `undefined` only when there is no error. Use {@link describeAgentTurnFailure} for the detail.
 */
export function localizeAgentFailureShortReason(
    error: string | undefined,
    options?: QaapAgentFailureReasonOptions,
): string | undefined {
    return describeAgentTurnFailure(error, options)?.label;
}
