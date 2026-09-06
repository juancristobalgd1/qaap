// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { migrateQaapProductAgentId, QAIQ_AGENT_ID } from './qaap-agent-task-client';
import { isAgentHiddenOnHostedRuntime } from './qaap-hosted-agent-auth-policy';

/**
 * CLI session / device-code login challenge extracted from agent stdout/stderr.
 * Mirrors what the agent TUI prints (Codex device URL + code, Claude OAuth URL, …).
 */
export interface QaapAgentAuthLoginChallenge {
    /** Prefer opening this URL in the browser (same as a TUI hyperlink). */
    readonly url?: string;
    /** Device / one-time code to paste after opening the URL. */
    readonly userCode?: string;
    /**
     * `session` — CLI OAuth / subscription login (Codex, Claude, Cursor, …).
     * `api_key` — missing/invalid API key (Settings / BYOK).
     */
    readonly mode: 'session' | 'api_key';
}

const AUTH_URL_RE = /https?:\/\/[^\s<>"'`)\]|,]+/gi;

interface AuthUrlPolicy {
    readonly agents: readonly string[];
    readonly hostname: string;
    readonly path: RegExp;
}

/**
 * Exact origins and login paths emitted by supported agent CLIs. Never infer trust from a
 * substring such as `oauth`, a query parameter, or a parent-looking subdomain.
 */
const AUTH_URL_POLICIES: readonly AuthUrlPolicy[] = [
    { agents: ['codex'], hostname: 'auth.openai.com', path: /^\/(?:codex\/device|device|oauth|authorize)(?:\/|$)/i },
    { agents: ['codex'], hostname: 'chatgpt.com', path: /^\/(?:auth|oauth)(?:\/|$)/i },
    { agents: ['claude'], hostname: 'claude.ai', path: /^\/oauth\/authorize(?:\/|$)/i },
    { agents: ['claude'], hostname: 'console.anthropic.com', path: /^\/(?:login|oauth|authorize)(?:\/|$)/i },
    { agents: ['claude'], hostname: 'platform.claude.com', path: /^\/(?:login|oauth|authorize)(?:\/|$)/i },
    { agents: ['copilot'], hostname: 'github.com', path: /^\/login\/(?:device|oauth|authorize)(?:\/|$)/i },
    { agents: ['cursor'], hostname: 'cursor.com', path: /^\/(?:auth|login|oauth|device|authorize)(?:\/|$)/i },
    { agents: ['cursor'], hostname: 'cursor.sh', path: /^\/(?:auth|login|oauth|device|authorize)(?:\/|$)/i },
    { agents: ['cursor'], hostname: 'authenticator.cursor.sh', path: /^\/(?:auth|login|oauth|device|authorize)(?:\/|$)/i },
    { agents: ['gemini', 'antigravity'], hostname: 'accounts.google.com', path: /^\/(?:o\/oauth2|signin\/oauth|device)(?:\/|$)/i },
    { agents: ['grok'], hostname: 'auth.x.ai', path: /^\/(?:auth|login|oauth|device|authorize)(?:\/|$)/i },
    { agents: ['copilot'], hostname: 'login.microsoftonline.com', path: /^\/[^/]+\/oauth2\/(?:v2\.0\/)?authorize(?:\/|$)/i },
];

const SESSION_AUTH_PATTERNS: readonly RegExp[] = [
    /\bnot\s+logged\s+in\b/i,
    // "Please run /login", "run the '/login' command" (Copilot CLI quotes it).
    /\brun\s+(?:the\s+)?['"`]?\/login\b/i,
    // Copilot CLI's unauthenticated headline ("No authentication information found").
    /\bno\s+authentication\s+information\s+found\b/i,
    /\bauthentication_failed\b/i,
    /\boauth\s+session\b/i,
    /\bfailed\s+to\s+authenticate\b/i,
    /\blog(?:\s|-)?in\s+required\b/i,
    /\bsign(?:\s|-)?in\s+required\b/i,
    /\bauth(?:entication)?\s+is\s+required\b/i,
    /\bcodex\s+auth\b/i,
    /\bsign\s+in\s+with\s+(?:chatgpt|claude|cursor|github)\b/i,
    /\bdevice(?:\s|-)?auth\b/i,
    /\bone[- ]time\s+code\b/i,
    /\bverification_uri\b/i,
    /\buser_code\b/i,
];

const API_KEY_AUTH_PATTERNS: readonly RegExp[] = [
    /\binvalid[_\s-]?api[_\s-]?key\b/i,
    /\bapi[_\s-]?key\b/i,
    /\bANTHROPIC_API_KEY\b/,
    /\bOPENAI_API_KEY\b/,
    /\bCURSOR_API_KEY\b/,
    /\bCODEX_API_KEY\b/,
    /\bmissing\s+(?:an?\s+)?api\s+key\b/i,
];

const USER_CODE_INLINE_RE = /(?:one[- ]time\s+code|user[_ ]?code|enter(?:\s+this)?\s+(?:one[- ]time\s+)?code|code)\s*[:#]?\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{3,})+)/i;
const USER_CODE_LINE_RE = /^[A-Z0-9]{4,5}-[A-Z0-9]{4,8}$/;

function stripTrailingUrlPunctuation(url: string): string {
    return url.replace(/[.,;:!?)]+$/g, '');
}

function normalizeTrustedAuthLoginUrl(candidate: string, agentId?: string): string | undefined {
    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
            return undefined;
        }
        const normalizedAgentId = migrateQaapProductAgentId(agentId?.trim());
        const policy = AUTH_URL_POLICIES.find(entry => entry.hostname === parsed.hostname.toLowerCase()
            && entry.path.test(parsed.pathname)
            && (!normalizedAgentId || entry.agents.includes(normalizedAgentId)));
        return policy ? parsed.toString() : undefined;
    } catch {
        return undefined;
    }
}

function extractAuthUrls(sample: string, agentId?: string): string[] {
    const found: string[] = [];
    const seen = new Set<string>();
    for (const match of sample.matchAll(AUTH_URL_RE)) {
        const url = normalizeTrustedAuthLoginUrl(stripTrailingUrlPunctuation(match[0]), agentId);
        if (!url || seen.has(url)) {
            continue;
        }
        seen.add(url);
        found.push(url);
    }
    return found;
}

function extractUserCode(sample: string): string | undefined {
    const inline = USER_CODE_INLINE_RE.exec(sample);
    if (inline?.[1]) {
        return inline[1].trim();
    }
    for (const line of sample.split('\n')) {
        const trimmed = line.trim();
        if (USER_CODE_LINE_RE.test(trimmed)) {
            return trimmed;
        }
    }
    return undefined;
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
}

/** Classify whether an auth failure is CLI session login vs API-key / Settings. */
export function detectAgentAuthFailureMode(log: string | undefined): 'session' | 'api_key' | undefined {
    const sample = (log ?? '').trim();
    if (!sample) {
        return undefined;
    }
    const hasSession = matchesAny(sample, SESSION_AUTH_PATTERNS) || extractAuthUrls(sample).length > 0;
    const hasApiKey = matchesAny(sample, API_KEY_AUTH_PATTERNS);
    if (hasSession && !hasApiKey) {
        return 'session';
    }
    if (hasApiKey && !hasSession) {
        return 'api_key';
    }
    if (hasSession) {
        // Prefer session when both appear (e.g. "API key invalid — run /login").
        return 'session';
    }
    if (hasApiKey) {
        return 'api_key';
    }
    return undefined;
}

/**
 * Strong, imperative refusal lines a CLI prints when it will NOT run because the user is not
 * signed in (Copilot: "No authentication information found … run '/login' … gh auth login").
 * Unlike {@link SESSION_AUTH_PATTERNS} — which also matches bare login URLs and loose prose —
 * these are used to fail an otherwise-clean exit (a CLI that prints its refusal to stdout and
 * still exits 0), so they must be unmistakable: a "do X to sign in" instruction, not a mention.
 */
const CLI_UNAUTH_DECLARATION_PATTERNS: readonly RegExp[] = [
    /\bno\s+authentication\s+information\s+found\b/i,
    /\brun\s+(?:the\s+)?['"`]?\/login\b/i,
    /\brun\s+['"`]?gh\s+auth\s+login\b/i,
];

/**
 * True when the CLI output is an unmistakable "not signed in, cannot run" refusal — safe to
 * fail an exit-0 turn on. Deliberately stricter than {@link detectAgentAuthFailureMode}.
 */
export function isUnauthenticatedCliDeclaration(log: string | undefined): boolean {
    const sample = (log ?? '').trim();
    return !!sample && CLI_UNAUTH_DECLARATION_PATTERNS.some(pattern => pattern.test(sample));
}

/**
 * Pull a clickable login URL (+ optional device code) from agent CLI output.
 * Returns `undefined` when the sample has no auth/session/login signal.
 */
export function extractAgentAuthLoginChallenge(
    log: string | undefined,
    options?: { readonly preferMode?: 'session' | 'api_key'; readonly agentId?: string },
): QaapAgentAuthLoginChallenge | undefined {
    const sample = (log ?? '').trim();
    if (!sample) {
        return undefined;
    }
    const urls = extractAuthUrls(sample, options?.agentId);
    const userCode = extractUserCode(sample);
    const detectedMode = detectAgentAuthFailureMode(sample);
    const mode = options?.preferMode ?? detectedMode;
    if (!mode && !urls.length && !userCode) {
        return undefined;
    }
    const resolvedMode = mode ?? 'session';
    return {
        mode: resolvedMode,
        ...(urls[0] ? { url: urls[0] } : {}),
        ...(userCode ? { userCode } : {}),
    };
}

/** User-facing copy for auth failures — session login vs Settings API key. */
export function localizeAgentAuthFailureMessage(
    challenge: QaapAgentAuthLoginChallenge | undefined,
): string {
    if (challenge?.mode === 'api_key') {
        return nls.localize(
            'qaap/agentFailure/authApiKey',
            'Authentication failed for this model or provider. Check your API key in Settings and try again.',
        );
    }
    if (challenge?.url) {
        return nls.localize(
            'qaap/agentFailure/authSessionWithUrl',
            'This agent needs you to sign in. Open the link below, then retry the task.',
        );
    }
    return nls.localize(
        'qaap/agentFailure/authSession',
        'This agent needs you to sign in before it can continue. Open the agent terminal to complete login, then retry.',
    );
}

/**
 * Interactive login command for the transcript terminal (device-auth / OAuth),
 * matching what users run in the agent TUI.
 */
export function resolveAgentLoginCliCommand(agentId: string | undefined): string | undefined {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized) {
        return undefined;
    }
    // Commands audited against the installed CLIs (Aug 2026, `<bin> login --help`). In a headless
    // cloud workspace the classic OAuth redirect-to-localhost cannot complete — the callback lands
    // on the user's machine, not the server — so only device-code / paste flows work. Prefer the
    // device-code flag wherever the CLI offers one.
    switch (normalized) {
        case 'codex':
            return 'codex login --device-auth';
        case 'claude':
            // Claude Code's own login is device/console paste; no flag needed.
            return 'claude auth login';
        case 'grok':
            // grok login --device-auth: "device-code authentication for headless/remote
            // environments" (its own help). Works in cloud; previously misfiled as BYOK.
            return 'grok login --device-auth';
        case 'copilot':
            // gh's default is a browser redirect; --web prints the one-time device code, the only
            // headless-viable path here.
            return 'gh auth login --web';
        case 'cursor':
            // Localhost OAuth callback cannot complete on a headless VPS.
            if (isAgentHiddenOnHostedRuntime('cursor')) {
                return undefined;
            }
            // Prints a URL instead of opening a browser. Completes on desktop.
            return process.platform === 'win32'
                ? '$env:NO_OPEN_BROWSER=\'1\'; cursor-agent login'
                : 'NO_OPEN_BROWSER=1 cursor-agent login';
        case QAIQ_AGENT_ID:
            // QAIQ is BYOK / Settings — no CLI OAuth login command.
            return undefined;
        // gemini / antigravity (`agy`) expose no login subcommand — `agy` just launches the TUI,
        // which is the dead end users hit. Treat them as BYOK so the UI points to Settings instead.
        default:
            return undefined;
    }
}

/** True when text looks like a CLI session-login failure (vs generic API-key). */
export function isAgentSessionAuthFailure(log: string | undefined): boolean {
    return detectAgentAuthFailureMode(log) === 'session'
        || !!extractAgentAuthLoginChallenge(log)?.url;
}

/**
 * True when the agent authenticates through a real CLI OAuth / device-code login
 * (a terminal sign-in flow), as opposed to a BYOK / Settings API-key agent.
 * Mirrors {@link resolveAgentLoginCliCommand}: an agent has a terminal sign-in
 * exactly when a dedicated login command exists for it.
 */
export function agentHasCliOAuthLogin(agentId: string | undefined): boolean {
    return resolveAgentLoginCliCommand(agentId) !== undefined;
}

/** Preferences sheet query that contains BYOK API-key fields (not AI Configuration / MCP). */
export const QAAP_AI_FEATURES_SETTINGS_QUERY = 'ai-features';

/**
 * True when the agent signs in with a Settings API key rather than a CLI OAuth / device-code
 * flow. Hosted-blocked localhost-OAuth agents (Cursor) stay out of this path.
 */
export function agentNeedsSettingsApiKeyPath(agentId: string | undefined): boolean {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized || normalized === 'shell') {
        return false;
    }
    if (isAgentHiddenOnHostedRuntime(normalized)) {
        return false;
    }
    return !agentHasCliOAuthLogin(normalized);
}

export function localizeAddApiKeyInSettingsCta(): string {
    return nls.localize(
        'qaap/agentLogin/addApiKeyInSettings',
        'Add API key in Settings',
    );
}

/**
 * User-facing copy for BYOK / Settings-catalog agents that do NOT have a terminal
 * sign-in: they authenticate with an API key configured in Settings, so opening a
 * TUI would not log anyone in.
 */
export function localizeAgentSettingsApiKeyLoginMessage(agentLabel?: string): string {
    if (agentLabel) {
        return nls.localize(
            'qaap/agentLogin/settingsApiKeyNamed',
            '{0} signs in with an API key in Settings, not a terminal login. Add or update the key in Settings, then retry.',
            agentLabel,
        );
    }
    return nls.localize(
        'qaap/agentLogin/settingsApiKey',
        'This agent signs in with an API key in Settings, not a terminal login. Add or update the key in Settings, then retry.',
    );
}
