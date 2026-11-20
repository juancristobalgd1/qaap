// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveAntigravityCliTemplate } from './qaap-antigravity-cli';
import { isAgentHiddenOnHostedRuntime } from './qaap-hosted-agent-auth-policy';
import type { QaapHarnessSignOut } from './qaap-harness-sign-out';

/**
 * How the backend learns whether the owner has a session for a harness (the Free/Pro rule needs it):
 * - `probe`: a status command or credential check the backend runs (`resolveAgentConnectionProbe` in
 *   qaap-cloud-workspace must return one for this id);
 * - `attestation`: no verifiable probe exists, so the sign-in dialog attests the CLI's own success line
 *   (`QAAP_SESSION_ATTESTATION_AGENT_IDS`).
 * There is no "none": a harness that cannot answer stays signed out (Pro locked) until it has a session.
 */
export type QaapHarnessSessionCheck = 'probe' | 'attestation';

/** Built-in VPS coding-agent CLI the task runner can auto-detect on PATH. */
export interface QaapBuiltinAgentDefinition {
    readonly id: string;
    readonly label: string;
    /** Executable looked up with `which <bin>` (may differ from {@link id}). */
    readonly bin: string;
    /** Shell template. `{prompt}` is delivered via stdin or `--prompt-file` (not argv) so Windows cmd.exe is not overflowed. */
    readonly template: string;
    /**
     * Required: how this harness's session is checked. Adding a harness without it does not compile, and
     * `qaap-agent-session-check.spec.ts` (qaap-cloud-workspace) fails when the declaration has no implementation.
     */
    readonly sessionCheck: QaapHarnessSessionCheck;
    /**
     * Required: how Settings → Harness signs the owner out of this harness. Adding a harness without it
     * does not compile, and `qaap-harness-sign-out.spec.ts` verifies every entry.
     */
    readonly signOut: QaapHarnessSignOut;
}

/** A retired CLI keeps its launch shape only; it declares its session check and sign-out again when it comes back. */
export type QaapRetiredAgentDefinition = Omit<QaapBuiltinAgentDefinition, 'sessionCheck' | 'signOut'>;

/**
 * Auto-detected server-side agent CLIs (AionUi-compatible core set).
 * QAIQ is registered separately in the task runner because it uses `{qaiq_flags}` and stream-json.
 * Niche or ACP-only CLIs (Snow, Kiro, Nanobot, vibe-acp, …) stay in `QAAP_AGENT_COMMANDS`.
 */
export const QAAP_BUILTIN_AGENT_DEFINITIONS: readonly QaapBuiltinAgentDefinition[] = [
    {
        id: 'codex',
        label: 'Codex',
        bin: 'codex',
        sessionCheck: 'probe',
        signOut: { kind: 'cli', args: ['logout'] },
        template: 'codex exec --json -c check_for_update_on_startup=false {model_flags} {prompt}',
    },
    {
        id: 'claude',
        label: 'Claude Code',
        bin: 'claude',
        sessionCheck: 'probe',
        signOut: { kind: 'cli', args: ['auth', 'logout'] },
        template: 'claude --print --output-format stream-json --verbose --include-partial-messages {trust_flags} {model_flags} -p {prompt}',
    },
    {
        id: 'opencode',
        label: 'OpenCode',
        bin: 'opencode',
        sessionCheck: 'probe',
        signOut: {
            kind: 'files',
            removesAllProviders: true,
            paths: [{ root: { env: 'XDG_DATA_HOME', fallback: '.local/share' }, relative: 'opencode/auth.json' }],
        },
        template: 'opencode run --format json --print-logs --log-level ERROR --dangerously-skip-permissions {model_flags} {prompt}',
    },
    {
        id: 'pi',
        label: 'Pi',
        bin: 'pi',
        sessionCheck: 'probe',
        signOut: {
            kind: 'files',
            removesAllProviders: true,
            paths: [{ root: { env: 'PI_CODING_AGENT_DIR', fallback: '.pi/agent' }, relative: 'auth.json' }],
        },
        template: 'pi --mode json -p --no-session -ne -e {gate_ext} {trust_flags} {model_flags} {prompt}',
    },
    {
        id: 'cursor',
        label: 'Cursor Agent',
        bin: 'cursor-agent',
        sessionCheck: 'probe',
        signOut: { kind: 'cli', args: ['logout'], env: { NO_OPEN_BROWSER: '1' } },
        template: 'cursor-agent -p --force --trust --approve-mcps {model_flags} {prompt}',
    },
    {
        id: 'antigravity',
        label: 'Antigravity CLI',
        bin: 'agy',
        sessionCheck: 'probe',
        signOut: {
            kind: 'by-bin',
            byBin: {
                agy: {
                    kind: 'tui',
                    steps: [
                        {
                            text: '/logout\r',
                            waitFor: 'Antigravity|Ask anything|Type\\s+/|@\\s+to\\s+mention|Select login method',
                            fallbackMs: 2_500,
                        },
                        {
                            text: '\r',
                            waitFor: 'Confirm Sign Out',
                            fallbackMs: 1_500,
                        },
                    ],
                    successPatterns: [
                        'Signed out of\\b',
                        'Signed out from server:',
                        'Select login method',
                    ],
                    timeoutMs: 12_000,
                },
                gemini: {
                    kind: 'files',
                    paths: [
                        { root: 'home', relative: '.gemini/oauth_creds.json' },
                        { root: 'home', relative: '.gemini/google_accounts.json' },
                    ],
                },
            },
        },
        template: resolveAntigravityCliTemplate('agy'),
    },
    {
        id: 'copilot',
        label: 'Copilot CLI',
        bin: 'copilot',
        sessionCheck: 'attestation',
        signOut: {
            kind: 'json-keys',
            path: { root: 'home', relative: '.copilot/config.json' },
            keys: ['loggedInUsers', 'lastLoggedInUser', 'copilot_tokens', 'logged_in_users', 'last_logged_in_user'],
        },
        template: 'copilot --autopilot --yolo --max-autopilot-continues 20 -p {prompt}',
    },
    {
        id: 'grok',
        label: 'Grok Build',
        bin: 'grok',
        sessionCheck: 'probe',
        signOut: { kind: 'cli', args: ['logout'] },
        template: 'grok --always-approve {model_flags} -p {prompt}',
    },
];

/**
 * Agent CLIs that are no longer offered as Work Hub harnesses. They are intentionally NOT registered
 * anywhere (task-runner auto-detection, Settings → Harness list, composer picker): to re-enable one, move
 * its entry back into {@link QAAP_BUILTIN_AGENT_DEFINITIONS}. Removing them from the registry (instead of
 * disabling them by default) keeps the picker and the backend runner in agreement.
 */
export const QAAP_RETIRED_AGENT_DEFINITIONS: readonly QaapRetiredAgentDefinition[] = [
    { id: 'openclaude', label: 'OpenClaude', bin: 'openclaude', template: 'openclaude --print --output-format stream-json --verbose --include-partial-messages {qaiq_flags} {prompt}' },
    // `--model` is a top-level Hermes flag (`hermes --model <slug> chat`). Putting it after
    // `chat` is accepted by argparse, but a stale ~/.hermes/config.yaml still supplies the
    // main/auxiliary model when `{model_flags}` is empty — including dead OpenRouter `:free`
    // slugs such as `poolside/laguna-m.1:free`. `--ignore-user-config` keeps Work Hub on the
    // picker (or Hermes's silent default) while still loading credentials from `.env`.
    // `--provider nous`: Hermes signs in to the Nous Portal from the Connect dialog (device code);
    // only QAIQ runs on Settings API keys. Nous serves the same `org/model` picker slugs.
    { id: 'hermes', label: 'Hermes', bin: 'hermes', template: 'hermes --yolo --ignore-user-config --provider nous {model_flags} chat -Q -q {prompt}' },
    { id: 'openclaw', label: 'OpenClaw', bin: 'openclaw', template: 'openclaw agent --local --message {prompt}' },
    { id: 'qwen', label: 'Qwen Code', bin: 'qwen', template: 'qwen -p --approval-mode yolo {model_flags} {prompt}' },
    { id: 'kimi', label: 'Kimi CLI', bin: 'kimi', template: 'kimi -p {prompt}' },
];

export const QAAP_BUILTIN_AGENT_IDS = new Set(QAAP_BUILTIN_AGENT_DEFINITIONS.map(definition => definition.id));

/**
 * Every agent runtime that Qaap can use as a Work Hub harness, including the native Qaap
 * runner. Keep this list derived from the task-runner catalog so the configuration UI and the
 * backend cannot drift apart when a new CLI is added.
 */
export interface QaapHarnessDefinition {
    readonly id: string;
    readonly label: string;
    readonly bin: string;
}

export const QAAP_HARNESS_DEFINITIONS: readonly QaapHarnessDefinition[] = [
    ...QAAP_BUILTIN_AGENT_DEFINITIONS.map(({ id, label, bin }) => ({ id, label, bin })),
];

export const CURSOR_AGENT_ID = 'cursor';

/**
 * Detected CLIs that stay out of the composer picker, the default-agent resolution and the
 * backend runner's selection. `qaiq` (retired, BYOK-only runner) and `openclaude` (retired) are
 * kept here so a stale `qaiq` default, pick or @mention falls back to the first available harness.
 */
export const UI_HIDDEN_VPS_AGENT_IDS = new Set<string>(['qaiq', 'openclaude']);

/** VPS agents whose CLI model list is not API-selectable in headless runs. */
export const NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS = new Set<string>();

/**
 * VPS agents that expose a selectable model catalog in the composer picker.
 * Keep in sync with {@link listStaticNativeAgentModels} plus OpenCode CLI discovery.
 */
export const NATIVE_MODEL_PICKER_AGENT_IDS = new Set([
    'codex',
    'claude',
    'openclaude',
    'grok',
    'opencode',
    'pi',
    'hermes',
    'qwen',
    'copilot',
    'antigravity',
    'gemini',
    CURSOR_AGENT_ID,
]);

export function isUiHiddenVpsAgent(agentId: string | undefined): boolean {
    const normalized = agentId?.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    if (UI_HIDDEN_VPS_AGENT_IDS.has(normalized)) {
        return true;
    }
    return isAgentHiddenOnHostedRuntime(normalized);
}

/**
 * OpenAI Codex CLI changed its headless entrypoint over time:
 * - newer versions expose `codex exec <prompt>`;
 * - older research-preview builds only support `codex -q <prompt>`.
 *
 * Background tasks cannot use the interactive TUI because the server process has no raw TTY,
 * so detect the installed CLI shape and always pick a non-interactive template.
 *
 * The `codex exec` template is the default. The legacy `codex -q` template is returned only when
 * the help text is non-empty, does not list `exec` as a command, and positively shows the `-q`/`--quiet`
 * flag. Empty or unrecognized help (e.g. a timed-out `codex --help`) must not select the legacy
 * template, because modern CLIs reject `-q` with "unexpected argument".
 */
export function resolveQaapCodexTemplate(helpText: string): string {
    const hasExecCommand = /\bcodex\s+exec\b/.test(helpText) || /^\s+exec\b/m.test(helpText);
    const isLegacyCli = helpText.trim() !== '' && !hasExecCommand && /(^|\s)-q\b|--quiet\b/m.test(helpText);
    return isLegacyCli
        ? 'codex -q --json -c check_for_update_on_startup=false {model_flags} {prompt}'
        : 'codex exec --json -c check_for_update_on_startup=false {model_flags} {prompt}';
}

const QAAP_BUILTIN_AGENT_ALIASES: Readonly<Record<string, string>> = {
    'cursor-agent': 'cursor',
    'gemini': 'antigravity',
    'grok-build': 'grok',
    'grok-cli': 'grok',
};

/**
 * Mention / storage alias for {@link QAAP_BUILTIN_AGENT_DEFINITIONS} ids. Retired CLIs
 * ({@link QAAP_RETIRED_AGENT_DEFINITIONS}) and their aliases resolve to `undefined`.
 */
export function resolveQaapBuiltinAgentMentionId(token: string): string | undefined {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }
    const id = QAAP_BUILTIN_AGENT_ALIASES[normalized] ?? normalized;
    return QAAP_BUILTIN_AGENT_IDS.has(id) ? id : undefined;
}

const QAAP_BUILTIN_AGENT_BY_ID = new Map(QAAP_BUILTIN_AGENT_DEFINITIONS.map(definition => [definition.id, definition]));

/** Sign-out strategy declared for a built-in harness id, or `undefined` when the id is unknown. */
export function resolveQaapBuiltinAgentSignOut(agentId: string | undefined): QaapHarnessSignOut | undefined {
    const normalized = agentId?.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }
    return QAAP_BUILTIN_AGENT_BY_ID.get(normalized)?.signOut;
}
