// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    extractAgentAuthLoginChallenge,
    localizeAgentAuthFailureMessage,
} from './qaap-agent-auth-login';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
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

const AUTH_PATTERNS: readonly RegExp[] = [
    /\binvalid[_\s-]?api[_\s-]?key\b/i,
    /\bauthentication_failed\b/i,
    /\bfailed\s+to\s+authenticate\b/i,
    /\boauth\s+session\b/i,
    /\bnot\s+logged\s+in\b/i,
    /\bplease\s+run\s+\/login\b/i,
    /\brun\s+\/login\b/i,
    /\bauth(?:entication)?\s+is\s+required\b/i,
    /\bcodex\s+auth\b/i,
    /\bCODEX_API_KEY\b/,
    /\bauthentication\b/i,
    /\bunauthorized\b/i,
    /\b401\b/,
    /\b403\b/,
    /\bforbidden\b/i,
    /\baccess\s+denied\b/i,
];

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

function extractJsonFailureHint(sample: string): string | undefined {
    for (const line of sample.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            continue;
        }
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            const hint = readJsonFailureHint(parsed);
            if (hint) {
                return hint;
            }
        } catch {
            /* not JSON */
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
    return undefined;
}

/** Pull a short, readable hint from agent stderr/stdout when no known kind matches. */
export function extractAgentLogFailureHint(log: string | undefined): string | undefined {
    const sample = (log ?? '').trim().slice(0, AGENT_FAILURE_SCAN_LIMIT);
    if (!sample) {
        return undefined;
    }
    const jsonHint = extractJsonFailureHint(sample);
    if (jsonHint) {
        return jsonHint;
    }
    const clean = sample.replace(ANSI_REGEX, '');
    const lines = clean.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (/^(Error|error|npm error|failed to|Cannot find|fatal:)/i.test(line)) {
            return truncateAgentFailureHint(line);
        }
        // Windows cmd.exe: "FIND: formato de parámetros incorrecto"
        if (WINDOWS_CMD_ERROR_LINE.test(line)) {
            return truncateAgentFailureHint(line);
        }
        if (/\bis not recognized as an internal or external command\b/i.test(line)) {
            return truncateAgentFailureHint(line);
        }
        if (/^The system cannot find (?:the )?(?:path|file) specified/i.test(line)) {
            return truncateAgentFailureHint(line);
        }
        if (/command line is too long|l[ií\uFFFD]?nea de comandos es demasiado larga/i.test(line)) {
            return truncateAgentFailureHint(line);
        }
        // QAIQ/Codex often emit a bare credential line without an `Error:` prefix
        // ("Codex auth is required for gpt-5.5. Set CODEX_API_KEY…").
        if (/\b(?:auth(?:entication)?\s+is\s+required|CODEX_API_KEY|invalid[_\s-]?api[_\s-]?key)\b/i.test(line)) {
            return truncateAgentFailureHint(line);
        }
    }
    return undefined;
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
    const sample = (log ?? '').trim().slice(0, AGENT_FAILURE_SCAN_LIMIT);
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
    if (matchesAny(sample, AUTH_PATTERNS)) {
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
    return nls.localize(
        'qaap/agentFailure/noCodingAgent',
        'No coding agent CLI is installed. Install Cursor Agent, QAIQ, Claude Code, Codex, or OpenCode, then restart Qaap.',
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
                'qaap/agentFailure/failed',
                'We could not finish this task. Edit your prompt, switch model or agent, or send a follow-up.',
            );
    }
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
    const result = segment.result?.trim() ?? '';
    if (!result) {
        return true;
    }
    return isAgentToolResultFailure(result, { toolName: segment.name }) || isTranscriptErrorOutput(result);
}

/** Last tool call that likely caused the turn failure — prefers traceEvents/segments on the agent message. */
export function extractLastFailedToolFromMessage(
    message: Pick<QaapAgentMessageDTO, 'segments' | 'traceEvents' | 'role' | 'content'> | undefined,
): QaapAgentFailedToolContext | undefined {
    if (!message || message.role !== 'agent') {
        return undefined;
    }
    const segments = resolveAgentMessageSegments(message);
    for (let index = segments.length - 1; index >= 0; index--) {
        const segment = segments[index];
        if (segment.type !== 'tool' || !isFailedToolSegment(segment)) {
            continue;
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
    const kind = detectAgentFailureKind(log);
    if (kind === 'auth') {
        return localizeAgentAuthFailureMessage(extractAgentAuthLoginChallenge(log));
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
    const logHint = extractAgentLogFailureHint(log);
    if (logHint) {
        return nls.localize(
            'qaap/agentFailure/logHint',
            'The agent hit an error: {0}',
            logHint,
        );
    }
    const failedTool = extractLastFailedToolFromMessage(resolvedOptions.agentMessage);
    if (failedTool) {
        const toolLog = failedTool.result ?? log;
        const toolKind = detectAgentFailureKind(toolLog);
        if (toolKind === 'auth') {
            return localizeAgentAuthFailureMessage(extractAgentAuthLoginChallenge(toolLog));
        }
        if (toolKind) {
            return localizeAgentFailureMessage(toolKind);
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
