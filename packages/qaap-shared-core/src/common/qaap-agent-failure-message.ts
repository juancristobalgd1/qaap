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
    | 'cli_missing'
    | 'provider_key_rejected'
    | 'provider_credits'
    | 'provider_data_policy'
    | 'provider_free_limit';

/** What the runner's provider preflight learned about a BYOK key after an ambiguous CLI error. */
export type QaapProviderKeyVerdict = 'key_rejected' | 'no_credits' | 'free_model_refused';

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
    // Copilot CLI's sign-out headline; it prints it to stdout, followed by login help, and exits 0.
    /\bno\s+authentication\s+information\s+found\b/i,
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

/**
 * A plain-text line the agent CLI itself prints for a provider/API failure. Not `fatal:`: that is
 * git's prefix, and a `git push` 403 is a repository permission, not an expired agent session.
 */
const CLI_ERROR_ENVELOPE_LINE = /^(?:error\b|api\s+error\b|unexpected\s+status\b|http\/?[\d.]*\s+\d{3}\b|status(?:\s+code)?:?\s*\d{3}\b)/i;

/**
 * The provider/API subset of {@link CLI_ERROR_ENVELOPE_LINE}, without a bare `Error:`: test
 * runners print "Error: Test timed out" too, so that prefix alone cannot carry a timeout.
 */
const CLI_PROVIDER_ERROR_LINE = /^(?:api\s+error\b|unexpected\s+status\b|http\/?[\d.]*\s+\d{3}\b|status(?:\s+code)?:?\s*\d{3}\b)/i;

/** Line the task runner writes when it kills a run that stopped producing output. */
const RUNNER_IDLE_TIMEOUT_LINE = /\[qaap\] task timed out after (\d+)s without output\./;

/** Persisted (English, backend-locale) forms of {@link localizeAgentTurnTimeoutMessage}. */
const STORED_IDLE_TIMEOUT = /^Timed out after (\d+) minutes without output\./;
const STORED_MAX_DURATION = /^Timed out at the (\d+)-minute task limit\./;
const STORED_APPROVAL_WAIT = /^Waited (\d+) hours for your approval\./;

/** Only read in the CLI's error envelope: a test suite printing "timed out" is not the agent timing out. */
const TIMEOUT_PATTERNS: readonly RegExp[] = [
    // Our approval-wait pause copy does not say "timed out", but it is the same pause.
    /^Waited \d+ hours for your approval\./m,
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

/**
 * Note the task runner appends after probing the user's BYOK key with the provider, when the CLI's
 * own error was ambiguous (QAIQ reports any OpenRouter 4xx as "an issue with the selected model").
 */
const PROVIDER_PREFLIGHT_LINE = /^\[qaap\] provider check: ([\w .-]+?) (key_rejected|no_credits|free_model_refused)\b/m;

/** Line written by {@link formatProviderPreflightNote}; never contains the key or the response body. */
export function formatProviderPreflightNote(providerLabel: string, verdict: QaapProviderKeyVerdict, httpStatus?: number): string {
    return `[qaap] provider check: ${providerLabel} ${verdict}${httpStatus !== undefined ? ` (HTTP ${httpStatus})` : ''}.`;
}

const PROVIDER_PREFLIGHT_KIND: Readonly<Record<QaapProviderKeyVerdict, QaapAgentFailureKind>> = {
    key_rejected: 'provider_key_rejected',
    no_credits: 'provider_credits',
    free_model_refused: 'provider_data_policy',
};

/**
 * Provider error bodies that are about the user's own key or account, not about Qaap or the model.
 * OpenRouter answers 401 "No auth credentials found" / "User not found." for a bad or revoked key,
 * 402 for a key without credits, 404 for a free model the account's privacy settings exclude and
 * 429 "free-models-per-day" for the daily free-model cap. Our own copy is listed too, so a
 * persisted reason classifies back to the same kind.
 */
const PROVIDER_KEY_REJECTED_PATTERNS: readonly RegExp[] = [
    /\bno\s+auth\s+credentials\s+found\b/i,
    /\bkey\s+was\s+rejected\b/i,
];
/** A disabled/revoked/expired key, only on a line that also names a BYOK provider. */
const PROVIDER_KEY_REVOKED_LINE = /\b(?:api\s+)?key\s+(?:is\s+|has\s+been\s+)?(?:disabled|revoked|expired)\b/i;
/** Only with the provider named: "User not found." alone could be any tool's output. */
const OPENROUTER_KEY_REJECTED_PATTERNS: readonly RegExp[] = [
    /\buser\s+not\s+found\b/i,
    /\binvalid[_\s-]?api[_\s-]?key\b/i,
];
const PROVIDER_CREDITS_PATTERNS: readonly RegExp[] = [
    /\binsufficient\s+credits\b/i,
    /\brequires\s+more\s+credits\b/i,
    /\bkey\s+limit\s+exceeded\b/i,
    /\bkey\s+is\s+out\s+of\s+credits\b/i,
];
const PROVIDER_DATA_POLICY_PATTERNS: readonly RegExp[] = [
    /\bno\s+endpoints\s+found\s+matching\s+your\s+data\s+policy\b/i,
    /\bfree\s+model\s+may\s+be\s+unavailable\s+right\s+now\b/i,
];
const PROVIDER_FREE_LIMIT_PATTERNS: readonly RegExp[] = [
    /\bfree[_\s-]?models?[_\s-]?per[_\s-]?(?:day|min)\b/i,
    /\bfree-model\s+limit\s+reached\b/i,
];

const PROVIDER_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bopen\s?router\b/i, 'OpenRouter'],
    [/\bhugging\s?face\b/i, 'Hugging Face'],
    [/\bnvidia\b(?!\/)/i, 'NVIDIA'],
    [/\banthropic\b/i, 'Anthropic'],
    [/\bopenai\b/i, 'OpenAI'],
    [/\b(?:google|gemini)\b/i, 'Google'],
];

/** Provider named in the failure (preflight note first), for "Your {provider} key was rejected". */
export function detectAgentFailureProviderLabel(log: string | undefined): string | undefined {
    const sample = log ?? '';
    const preflight = PROVIDER_PREFLIGHT_LINE.exec(sample);
    if (preflight) {
        return preflight[1];
    }
    return PROVIDER_LABELS.find(([pattern]) => pattern.test(sample))?.[1];
}

function classifyProviderKeyEvidence(sample: string, envelope: string): QaapAgentFailureKind | undefined {
    const preflight = PROVIDER_PREFLIGHT_LINE.exec(sample);
    if (preflight) {
        return PROVIDER_PREFLIGHT_KIND[preflight[2] as QaapProviderKeyVerdict];
    }
    if (matchesAny(sample, PROVIDER_DATA_POLICY_PATTERNS)) {
        return 'provider_data_policy';
    }
    if (matchesAny(sample, PROVIDER_FREE_LIMIT_PATTERNS)) {
        return 'provider_free_limit';
    }
    if (matchesAny(sample, PROVIDER_CREDITS_PATTERNS) || (/\b402\b/.test(envelope) && /\bcredits?\b/i.test(envelope))) {
        return 'provider_credits';
    }
    if (matchesAny(sample, PROVIDER_KEY_REJECTED_PATTERNS)
        || sample.split('\n').some(line => PROVIDER_KEY_REVOKED_LINE.test(line) && PROVIDER_LABELS.some(([pattern]) => pattern.test(line)))) {
        return 'provider_key_rejected';
    }
    // A bare 401/403 is only the BYOK key when the provider's own error envelope says so.
    if (/\bopen\s?router\b/i.test(envelope)
        && (matchesAny(envelope, OPENROUTER_KEY_REJECTED_PATTERNS) || /\b(?:401|403)\b|\bunauthorized\b|\bforbidden\b/i.test(envelope))) {
        return 'provider_key_rejected';
    }
    return undefined;
}

/** Failure kinds caused by the user's own provider key or account (BYOK), fixed in Settings → BYOK. */
export function isProviderKeyFailureKind(kind: QaapAgentFailureKind | undefined): boolean {
    return kind === 'provider_key_rejected' || kind === 'provider_credits'
        || kind === 'provider_data_policy' || kind === 'provider_free_limit';
}

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
    /** The input had a JSON event stream, i.e. it is an agent log rather than a bare error string. */
    readonly structured: boolean;
    /**
     * Provider retry records (`system/api_retry`) after the CLI's last other JSON record: the CLI was
     * still retrying when the log ended. Not evidence on their own (a recovered retry is noise); they
     * only explain why the runner's idle timer killed the run.
     */
    readonly trailingRetryRecords: readonly string[];
}

/** At most this many plain lines and no JSON stream: the input is an error message, not a log. */
const STANDALONE_ERROR_MAX_LINES = 2;

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

function isProviderRetryRecord(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return record.type === 'system' && record.subtype === 'api_retry';
}

function collectAgentFailureEvidence(log: string | undefined): AgentFailureEvidence {
    const full = (log ?? '').trim();
    const errorRecords: string[] = [];
    const plainLines: string[] = [];
    let trailingRetryRecords: string[] = [];
    let structured = false;
    if (!full) {
        return { errorRecords, plainLines, structured, trailingRetryRecords };
    }
    for (const rawLine of tailOfAgentLog(full).replace(ANSI_REGEX, '').split('\n')) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        if (line.startsWith('{') || line.startsWith('[')) {
            try {
                const parsed = JSON.parse(line);
                structured = true;
                if (isTopLevelErrorRecord(parsed)) {
                    errorRecords.unshift(line);
                }
                trailingRetryRecords = isProviderRetryRecord(parsed) ? [...trailingRetryRecords, line] : [];
                continue;
            } catch {
                /* not JSON: CLI text that happens to start with a brace */
            }
        }
        plainLines.push(line);
    }
    return { envelope: findFinalErrorEnvelope(full), errorRecords, plainLines, structured, trailingRetryRecords };
}

/** Everything the CLI said about the failure (envelope, error records, plain lines). */
function agentFailureEvidenceText(evidence: AgentFailureEvidence): string {
    return [evidence.envelope, ...evidence.errorRecords, ...evidence.plainLines]
        .filter((part): part is string => !!part)
        .join('\n');
}

/**
 * Only the CLI's own error envelope — where a bare 401/403/"forbidden" really means auth. A
 * plain-text log interleaves tool output (`Error: Request failed with status code 403`) with the
 * CLI's stderr, so there only its last line or a provider error line counts, as for timeouts.
 */
function agentFailureEnvelopeText(evidence: AgentFailureEvidence): string {
    const interleaved = !evidence.structured && evidence.plainLines.length > STANDALONE_ERROR_MAX_LINES;
    const lastIndex = evidence.plainLines.length - 1;
    const plain = evidence.plainLines.filter((line, index) => CLI_ERROR_ENVELOPE_LINE.test(line)
        && (!interleaved || index === lastIndex || CLI_PROVIDER_ERROR_LINE.test(line)));
    return [evidence.envelope, ...evidence.errorRecords, ...plain]
        .filter((part): part is string => !!part)
        .join('\n');
}

/**
 * Where a timeout can be read: the CLI's error envelope, the last line it printed, the runner's own
 * idle line, our stored timeout copy, or an input that is itself a short error message, not a log.
 */
function agentFailureTimeoutText(evidence: AgentFailureEvidence): string {
    const standalone = !evidence.structured && evidence.plainLines.length <= STANDALONE_ERROR_MAX_LINES;
    const lastIndex = evidence.plainLines.length - 1;
    const plain = standalone
        ? evidence.plainLines
        // The last plain line is what the CLI printed as it died; earlier lines may be test output.
        : evidence.plainLines.filter((line, index) => index === lastIndex
            || CLI_PROVIDER_ERROR_LINE.test(line)
            || RUNNER_IDLE_TIMEOUT_LINE.test(line)
            || STORED_IDLE_TIMEOUT.test(line)
            || STORED_MAX_DURATION.test(line)
            || STORED_APPROVAL_WAIT.test(line));
    return [evidence.envelope, ...evidence.errorRecords, ...plain]
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

/**
 * The usage limit behind a run the idle timer killed, read only from the CLI's own error records
 * and the retries it was still making (see {@link AgentFailureEvidence.trailingRetryRecords}):
 * a 429 printed by a workspace command earlier in the log did not silence the agent.
 */
function classifyIdleUsageLimitEvidence(evidence: AgentFailureEvidence): 'quota' | 'rate_limit' | undefined {
    const records = [evidence.envelope, ...evidence.errorRecords, ...evidence.trailingRetryRecords]
        .filter((part): part is string => !!part)
        .join('\n');
    if (!records) {
        return undefined;
    }
    if (matchesAny(records, QUOTA_PATTERNS)) {
        return 'quota';
    }
    return matchesAny(records, RATE_LIMIT_PATTERNS) ? 'rate_limit' : undefined;
}

function classifyAgentFailureEvidence(evidence: AgentFailureEvidence): QaapAgentFailureKind | undefined {
    const sample = agentFailureEvidenceText(evidence);
    if (!sample) {
        return undefined;
    }
    if (matchesAny(sample, CLI_MISSING_PATTERNS)) {
        return 'cli_missing';
    }
    // Before quota/rate limit/model: an OpenRouter "free-models-per-day" 429 or a rejected key
    // behind QAIQ's "issue with the selected model" is the user's key, not the model or Qaap.
    const providerKind = classifyProviderKeyEvidence(sample, agentFailureEnvelopeText(evidence));
    if (providerKind) {
        return providerKind;
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
    if (matchesAny(agentFailureTimeoutText(evidence), TIMEOUT_PATTERNS)) {
        return 'timeout';
    }
    if (matchesAny(sample, NETWORK_PATTERNS)) {
        return 'network';
    }
    return undefined;
}

export function localizeAgentFailureMessage(kind: QaapAgentFailureKind, providerLabel?: string): string {
    const provider = providerLabel?.trim() || nls.localize('qaap/agentFailure/providerFallback', 'provider');
    switch (kind) {
        case 'provider_key_rejected':
            return nls.localize(
                'qaap/agentFailure/providerKeyRejected',
                'Your {0} key was rejected. Update it in Settings → BYOK, then retry.',
                provider,
            );
        case 'provider_credits':
            return nls.localize(
                'qaap/agentFailure/providerCredits',
                'Your {0} key is out of credits. Add credits with {0}, or update the key in Settings → BYOK.',
                provider,
            );
        case 'provider_data_policy':
            return nls.localize(
                'qaap/agentFailure/providerDataPolicy',
                'This {0} free model may be unavailable right now, or your {0} privacy settings block free endpoints. Pick another model, or allow free endpoints in your {0} privacy settings.',
                provider,
            );
        case 'provider_free_limit':
            return nls.localize(
                'qaap/agentFailure/providerFreeLimit',
                '{0} free-model limit reached. Wait for the daily reset, add credits with {0}, or pick another model.',
                provider,
            );
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

/**
 * Why the backend paused a turn that was still streaming: silence, the absolute cap, or a
 * permission approval left unanswered past its (much longer) wait cap.
 */
export type QaapAgentTurnTimeoutCause = 'idle' | 'max_duration' | 'approval_wait';

/**
 * Reason recorded when the backend pauses a turn (turn watchdog or the task runner's idle
 * timer). The turn ends `interrupted`, so the copy points at Continue rather than Retry. The
 * timer copies start with "Timed out"; every form is matched by `TIMEOUT_PATTERNS` and
 * `isStoredAgentTurnTimeout`.
 */
export function localizeAgentTurnTimeoutMessage(cause: QaapAgentTurnTimeoutCause, minutes: number): string {
    const rounded = String(Math.max(1, Math.round(minutes)));
    if (cause === 'approval_wait') {
        return nls.localize(
            'qaap/agentFailure/approvalWaitTimeout',
            'Waited {0} hours for your approval. Continue picks it up again.',
            String(Math.max(1, Math.round(minutes / 60))),
        );
    }
    if (cause === 'idle') {
        return nls.localize(
            'qaap/agentFailure/idleTimeout',
            'Timed out after {0} minutes without output. Continue picks it up again.',
            rounded,
        );
    }
    return nls.localize(
        'qaap/agentFailure/maxDuration',
        'Timed out at the {0}-minute task limit. Continue picks it up again.',
        rounded,
    );
}

/**
 * Reason recorded when a backend restart (or a failed restart resume) killed a turn. Its work is
 * kept, so it points at Continue (the row's one-tap recovery), like the timeout pauses.
 */
export function localizeAgentTurnRestartInterruptedMessage(): string {
    return nls.localize(
        'qaap/agentFailure/backendRestartInterrupted',
        'The backend restarted while this turn was in progress, so it was interrupted. Continue picks it up again.',
    );
}

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
    const approvalWait = STORED_APPROVAL_WAIT.exec(error);
    if (approvalWait) {
        return localizeAgentTurnTimeoutMessage('approval_wait', Number(approvalWait[1]) * 60);
    }
    // Older rows persisted "… Retry to continue." under a turn the row now offers Continue for.
    if (RESTART_INTERRUPTED.test(error)) {
        return localizeAgentTurnRestartInterruptedMessage();
    }
    return undefined;
}

function isStoredAgentTurnTimeout(error: string): boolean {
    return STORED_IDLE_TIMEOUT.test(error) || STORED_MAX_DURATION.test(error) || STORED_APPROVAL_WAIT.test(error)
        || LEGACY_WATCHDOG_STOP.test(error);
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
        return localizeAgentFailureMessage(kind, detectAgentFailureProviderLabel(trimmed));
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
    let kind: QaapAgentFailureKind | undefined;
    const idleTimeout = RUNNER_IDLE_TIMEOUT_LINE.exec(evidence.plainLines.join('\n'));
    if (idleTimeout) {
        // A CLI stuck retrying a rate limit or an exhausted quota goes quiet too: name the provider
        // limit, not the timer that stopped it. Otherwise the idle line is the reason.
        kind = classifyIdleUsageLimitEvidence(evidence);
        if (!kind) {
            return localizeAgentTurnTimeoutMessage('idle', Number(idleTimeout[1]) / 60);
        }
    } else {
        kind = classifyAgentFailureEvidence(evidence);
    }
    const challengeOptions = resolvedOptions.agentId ? { agentId: resolvedOptions.agentId } : undefined;
    if (kind === 'auth') {
        return localizeAgentAuthFailureMessage(extractAgentAuthLoginChallenge(agentFailureEvidenceText(evidence), challengeOptions));
    }
    if (isProviderKeyFailureKind(kind)) {
        return localizeAgentFailureMessage(kind!, detectAgentFailureProviderLabel(agentFailureEvidenceText(evidence)));
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
    | 'network'
    | 'provider_key'
    | 'provider_policy';

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

/**
 * Persisted copy that names a tool which was the turn's last, failed step. Provider lines in the
 * same shape (`Request failed: 429 quota exceeded`, persisted verbatim as a usage-limit hint) name
 * an HTTP step, not a tool, so those words are excluded.
 */
const STORED_TOOL_FAILURE = /^(?!(?:Process|Agent|Request|Fetch|Connection|Upload|Download|Authentication|Login)\b)[\w.:/-]+ (?:failed: |exited with code -?\d+\.?$|did not complete successfully\.?$)/;
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
        case 'provider_credits':
        case 'provider_free_limit':
            return 'usage_limit';
        case 'provider_key_rejected':
            return 'provider_key';
        case 'provider_data_policy':
            return 'provider_policy';
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
        case 'provider_key':
            return nls.localize('qaap/agentFailure/reasonProviderKey', 'API key rejected');
        case 'provider_policy':
            return nls.localize('qaap/agentFailure/reasonProviderPolicy', 'Blocked by provider settings');
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
