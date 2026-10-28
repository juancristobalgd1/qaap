// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Agent task logs for the failure-reason specs. Every record is taken from real task logs
 * (`~/.qaap/agent-tasks/*.log`, Claude Code / QAIQ `stream-json`), trimmed to the fields the
 * classifier reads; ids are shortened.
 */

import type { QaapAgentMessageDTO } from '../qaap-agent-conversation-client';

type FixtureAgentMessage = Pick<QaapAgentMessageDTO, 'role' | 'content' | 'segments'>;

const line = (record: object): string => JSON.stringify(record);

const SYSTEM_INIT = line({ type: 'system', subtype: 'init', cwd: '/workspace/repos/users/demo/app', session_id: 's1', tools: ['Task', 'Bash', 'Edit', 'Read'] });

/** Provider retry the CLI recovered from — a log line, not why the turn died. */
const API_RETRY_RATE_LIMIT = line({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 549.3, error_status: 429, error: 'rate_limit', session_id: 's1' });

export const NPM_MISSING_SCRIPT_OUTPUT = [
    'npm error Missing script: "test"',
    'npm error',
    'npm error To see a list of scripts, run:',
    'npm error   npm run',
    'npm error A complete log of this run can be found in: /Users/jc/.npm/_logs/2026-06-28T21_21_19_677Z-debug-0.log',
].join('\n');

const NPM_TOOL_RESULT = line({
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: `Exit code 1\n${NPM_MISSING_SCRIPT_OUTPUT}`, is_error: true }] },
    parent_tool_use_id: null,
    session_id: 's1',
});

/** A workspace command that printed an HTTP 403 — tool output, not the agent's own sign-in. */
const FORBIDDEN_TOOL_RESULT = line({
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: 'toolu_2', type: 'tool_result', content: 'HTTP/2 403\nError: unauthorized: authentication required for registry.npmjs.org', is_error: true }] },
    parent_tool_use_id: null,
    session_id: 's1',
});

const READ_TOOL_RESULT = line({
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: 'toolu_3', type: 'tool_result', content: '<system-reminder>Warning: the file exists but is shorter than the provided offset (160). The file has 148 lines.</system-reminder>' }] },
    parent_tool_use_id: null,
    session_id: 's1',
});

const MESSAGE_START = line({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'minimaxai/minimax-m3' } }, session_id: 's1' });

const resultEnvelope = (isError: boolean, result: string): string => line({
    type: 'result', subtype: 'success', is_error: isError, duration_ms: 13195981, num_turns: 56, result, stop_reason: 'stop_sequence', session_id: 's1', permission_denials: [],
});

/** Claude Code signed out: `authentication_failed` assistant record + error envelope. */
export const CLAUDE_NOT_LOGGED_IN_LOG = [
    SYSTEM_INIT,
    line({ type: 'assistant', message: { model: '<synthetic>', role: 'assistant', type: 'message', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] }, session_id: 's1', error: 'authentication_failed' }),
    resultEnvelope(true, 'Not logged in · Please run /login'),
].join('\n');

/**
 * Recovery false positive: the run hit a 429 retry, a failing `npm test` and a 403 from the
 * registry, kept working, and died on the provider — the final envelope is the cause.
 */
export const RECOVERED_THEN_PROVIDER_TERMINATED_LOG = [
    SYSTEM_INIT,
    API_RETRY_RATE_LIMIT,
    NPM_TOOL_RESULT,
    FORBIDDEN_TOOL_RESULT,
    READ_TOOL_RESULT,
    line({ type: 'assistant', message: { model: '<synthetic>', role: 'assistant', type: 'message', content: [{ type: 'text', text: 'API Error: terminated' }] }, session_id: 's1', error: 'unknown' }),
    resultEnvelope(true, 'API Error: terminated'),
].join('\n');

/** Same early failures, then the process died mid-stream with no envelope at all. */
export const RECOVERED_THEN_KILLED_LOG = [
    SYSTEM_INIT,
    API_RETRY_RATE_LIMIT,
    NPM_TOOL_RESULT,
    FORBIDDEN_TOOL_RESULT,
    READ_TOOL_RESULT,
    MESSAGE_START,
].join('\n');

/** The agent's trace for the recovered runs: a failed `npm test`, then more work and a reply. */
export const RECOVERED_AGENT_MESSAGE: FixtureAgentMessage = {
    role: 'agent',
    content: '',
    segments: [
        { type: 'tool', toolUseId: 'toolu_1', name: 'Bash', args: '{"command":"npm test"}', finished: true, result: `Exit code 1\n${NPM_MISSING_SCRIPT_OUTPUT}` },
        { type: 'text', content: 'There is no test script; I will build instead.' },
        { type: 'tool', toolUseId: 'toolu_3', name: 'Read', args: '{"file_path":"src/store/history.ts"}', finished: true, result: 'export const history = [];' },
        { type: 'thinking', content: 'Next, wire the store.' },
    ],
};

/** The failed `npm test` WAS the last step before the run died. */
export const TERMINAL_NPM_AGENT_MESSAGE: FixtureAgentMessage = {
    role: 'agent',
    content: '',
    segments: [
        { type: 'tool', toolUseId: 'toolu_3', name: 'Read', args: '{"file_path":"package.json"}', finished: true, result: '{"name":"app"}' },
        { type: 'tool', toolUseId: 'toolu_1', name: 'Bash', args: '{"command":"npm test"}', finished: true, result: `Exit code 1\n${NPM_MISSING_SCRIPT_OUTPUT}` },
    ],
};

/** A tool that finished without a result: not evidence of anything. */
export const RESULTLESS_TOOL_AGENT_MESSAGE: FixtureAgentMessage = {
    role: 'agent',
    content: '',
    segments: [
        { type: 'tool', toolUseId: 'toolu_4', name: 'Bash', args: '{"command":"npm run dev"}', finished: true },
    ],
};

/** QAIQ gave up after the same tool failed three times. */
export const REPEATED_TOOL_FAILURES_LOG = [
    SYSTEM_INIT,
    NPM_TOOL_RESULT,
    resultEnvelope(true, 'Stopped: repeated tool failures detected.\n\n`Bash` failed 3 times with `exit code 1`. Please inspect permissions, path, or tool schema before retrying.'),
].join('\n');

/** Hugging Face router out of credits (HTTP 402). */
export const CREDITS_DEPLETED_LOG = [
    SYSTEM_INIT,
    resultEnvelope(true, 'API Error: 402 {"error":"You have depleted your monthly included credits. Purchase pre-paid credits to continue using Inference Providers. Alternatively, subscribe to PRO to get 20x more included usage."}'),
].join('\n');

export const MODEL_UNAVAILABLE_LOG = [
    SYSTEM_INIT,
    resultEnvelope(true, 'There\'s an issue with the selected model (deepseek/deepseek-v4-flash:free). It may not exist or you may not have access to it. Run --model to pick a different model.'),
].join('\n');

/** QAIQ on NVIDIA NIM after the provider retired the model: HTTP 410 with an end-of-life detail. */
export const NVIDIA_MODEL_END_OF_LIFE_LOG = [
    SYSTEM_INIT,
    resultEnvelope(true, 'API Error: 410 {"status":410,"title":"Gone","detail":"The model \'nvidia/llama-3.3-nemotron-super-49b-v1\' has reached its end of life and is no longer available."}'),
].join('\n');

/** QAIQ when its OpenAI-compatible endpoint answers 404 for the model (it no longer serves it). */
export const PROVIDER_ENDPOINT_404_LOG = [
    SYSTEM_INIT,
    resultEnvelope(true, 'Provider endpoint at integrate.api.nvidia.com returned 404. Verify OPENAI_BASE_URL is correct and the model is served there.'),
].join('\n');

/** Codex CLI on a ChatGPT Free account: the plan's usage cap, with the retry time the CLI prints. */
export const CODEX_USAGE_LIMIT_LOG = [
    SYSTEM_INIT,
    resultEnvelope(true, 'You\'ve hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at Nov 19th, 2026 12:56 AM.'),
].join('\n');

/** Codex CLI on a ChatGPT account: a model the plan cannot run (the server lists the models per account). */
export const CODEX_MODEL_NOT_SUPPORTED_LOG = [
    SYSTEM_INIT,
    resultEnvelope(true, '{"error":{"message":"The \'gpt-5.6-sol\' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}'),
].join('\n');

/** The task runner's idle timer killed a run that stopped producing output. */
export const RUNNER_IDLE_TIMEOUT_LOG = [
    SYSTEM_INIT,
    READ_TOOL_RESULT,
    MESSAGE_START,
    '',
    '[qaap] task timed out after 1200s without output.',
].join('\n');

const apiRetryRateLimit = (attempt: number): string => line({
    type: 'system', subtype: 'api_retry', attempt, max_retries: 10, retry_delay_ms: 30000, error_status: 429, error: 'rate_limit', session_id: 's1',
});

/** The CLI kept retrying a 429 until the runner's idle timer killed it: the rate limit is the cause. */
export const RATE_LIMIT_RETRY_LOOP_IDLE_LOG = [
    SYSTEM_INIT,
    READ_TOOL_RESULT,
    MESSAGE_START,
    apiRetryRateLimit(1),
    apiRetryRateLimit(2),
    apiRetryRateLimit(3),
    '',
    '[qaap] task timed out after 1200s without output.',
].join('\n');

/** A 429 retry the CLI recovered from, then the run went quiet: the idle timer is the cause. */
export const RECOVERED_RETRY_THEN_IDLE_LOG = [
    SYSTEM_INIT,
    apiRetryRateLimit(1),
    READ_TOOL_RESULT,
    MESSAGE_START,
    '',
    '[qaap] task timed out after 1200s without output.',
].join('\n');

/** A clean success envelope followed by a non-zero exit (the CLI was killed while flushing). */
export const SUCCESS_ENVELOPE_LOG = [
    SYSTEM_INIT,
    NPM_TOOL_RESULT,
    resultEnvelope(false, 'Done. I added the test script and the suite passes.'),
].join('\n');

/** `message.error` strings seen on production sidebar rows before this fix. */
export const PRODUCTION_ROW_ERRORS = {
    bashExitCode: 'Bash exited with code 1.',
    bashNpmFooter: 'Bash failed: npm error A complete log of this run can be found in: /root/.npm/_logs/2026-10-18T09_12_44_101Z-debug-0.log',
    permissionHint: 'The agent hit an error: Permission to use Bash has been denied because the current approval policy does not allow it.',
    legacyWatchdog: 'Stopped automatically after 45 minutes: the turn exceeded the maximum allowed time.',
    backendRestart: 'The backend restarted while this turn was in progress, so it was interrupted. Retry to continue.',
} as const;
