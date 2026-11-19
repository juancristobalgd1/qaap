// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { migrateQaapProductAgentId } from './qaap-agent-task-client';
import { normalizeAntigravityCliBin } from './qaap-antigravity-cli';
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
    /**
     * The CLI is blocked on a prompt for the code the sign-in page shows after approval
     * (Claude Code `Paste code here if prompted >`, Gemini `Enter the authorization code:`).
     * The dialog must offer an input whose value is written to the CLI's stdin.
     */
    readonly codeEntry?: boolean;
    /**
     * The paste-back prompt also takes the final redirect URL (Pi: `paste the authorization code
     * / redirect URL here`): on a remote workspace the `127.0.0.1` callback page cannot load in
     * the user's browser, so they copy its address instead.
     */
    readonly acceptsRedirectUrl?: boolean;
}

/** Box-drawing characters and ESC/BEL end a URL: TUIs draw a URL row inside a `│` gutter, and OSC-8 sequences carry ESC/BEL. */
const AUTH_URL_RE = /https?:\/\/[^\s<>"'`)\]|,─-╿\x07\x1B]+/gi;
const OSC8_HYPERLINK_TARGET_RE = /\x1B\]8;[^;\x07\x1B]*;([^\x07\x1B]+)(?:\x07|\x1B\\)/g;
const TERMINAL_CONTROL_RE = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B\[[0-?]*[ -/]*[@-~]/g;
/** Box-drawing gutter and spaces around the text of one terminal row. */
const ROW_EDGE_DECORATION_RE = /^[\s|─-╿]+|[\s|─-╿]+$/g;
/** The end of a row that is cut inside an http(s) URL, and the start of the row that continues it. */
const WRAPPED_URL_TAIL_RE = /https?:\/\/\S*$/i;
const WRAPPED_URL_ROW_START_RE = /^[\w%&=?#+.~\/-]+/;

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
    // OpenCode's "ChatGPT Pro/Plus (headless)" method prints the same Codex device page.
    { agents: ['codex', 'opencode'], hostname: 'auth.openai.com', path: /^\/(?:codex\/device|device|oauth|authorize)(?:\/|$)/i },
    { agents: ['codex'], hostname: 'chatgpt.com', path: /^\/(?:auth|oauth)(?:\/|$)/i },
    // Claude Code 2.1.x and OpenClaude (`openclaude auth login`) print `https://claude.com/cai/oauth/authorize?code=true&…`.
    { agents: ['claude', 'openclaude'], hostname: 'claude.com', path: /^\/(?:cai\/)?oauth\/authorize(?:\/|$)/i },
    { agents: ['claude', 'openclaude'], hostname: 'claude.ai', path: /^\/oauth\/authorize(?:\/|$)/i },
    { agents: ['claude', 'openclaude'], hostname: 'console.anthropic.com', path: /^\/(?:login|oauth|authorize)(?:\/|$)/i },
    { agents: ['claude', 'openclaude'], hostname: 'platform.claude.com', path: /^\/(?:login|oauth|authorize)(?:\/|$)/i },
    { agents: ['copilot'], hostname: 'github.com', path: /^\/login\/(?:device|oauth|authorize)(?:\/|$)/i },
    // Cursor Agent prints `https://cursor.com/loginDeepControl?challenge=…&uuid=…` and polls for the result.
    { agents: ['cursor'], hostname: 'cursor.com', path: /^\/(?:loginDeepControl|auth|login|oauth|device|authorize)(?:\/|$)/i },
    { agents: ['cursor'], hostname: 'cursor.sh', path: /^\/(?:auth|login|oauth|device|authorize)(?:\/|$)/i },
    { agents: ['cursor'], hostname: 'authenticator.cursor.sh', path: /^\/(?:auth|login|oauth|device|authorize)(?:\/|$)/i },
    // Gemini CLI "Login with Google" (NO_BROWSER) prints `accounts.google.com/o/oauth2/v2/auth?…`.
    { agents: ['gemini', 'antigravity'], hostname: 'accounts.google.com', path: /^\/(?:o\/oauth2|signin\/oauth|device)(?:\/|$)/i },
    // Hermes 0.19 `auth add nous --type oauth` prints `portal.nousresearch.com/manage-subscription?user_code=…`.
    { agents: ['hermes'], hostname: 'portal.nousresearch.com', path: /^\/(?:manage-subscription|device|oauth|activate)(?:\/|$)/i },
    // Grok 1.0.x `login --device-auth` prints `https://accounts.x.ai/oauth2/device?user_code=…`.
    { agents: ['grok'], hostname: 'accounts.x.ai', path: /^\/oauth2\/device(?:\/|$)/i },
    { agents: ['grok'], hostname: 'auth.x.ai', path: /^\/(?:auth|login|oauth|device|authorize)(?:\/|$)/i },
    // Pi 1.4 `/login openrouter` prints `https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1…&code_challenge=…`.
    { agents: ['pi'], hostname: 'openrouter.ai', path: /^\/auth\/?$/i },
    // Pi `/login` providers (qaap-pi-login-providers.ts), each on its exact authorize / device page:
    // Anthropic `claude.ai/oauth/authorize`, OpenAI ChatGPT `auth.openai.com/api/accounts/authorize`,
    // GitHub Copilot device verification `github.com/login/device`.
    { agents: ['pi'], hostname: 'claude.ai', path: /^\/oauth\/authorize(?:\/|$)/i },
    { agents: ['pi'], hostname: 'auth.openai.com', path: /^\/api\/accounts\/authorize(?:\/|$)/i },
    { agents: ['pi'], hostname: 'github.com', path: /^\/login\/device(?:\/|$)/i },
    { agents: ['copilot'], hostname: 'login.microsoftonline.com', path: /^\/[^/]+\/oauth2\/(?:v2\.0\/)?authorize(?:\/|$)/i },
];

/** Prompts of CLIs that wait for the user to paste back the code shown after approval. */
const CODE_ENTRY_PROMPT_PATTERNS: readonly RegExp[] = [
    /\bpaste\s+(?:the\s+)?(?:authorization\s+)?code\s+here\b/i,
    /\benter\s+the\s+authori[sz]ation\s+code\b/i,
    // Pi: `Complete sign-in in your browser, or paste the authorization code / redirect URL here:`.
    /\bpaste\s+(?:the\s+)?authori[sz]ation\s+code\s*\/\s*redirect\s+url\b/i,
    // Pi OpenAI (ChatGPT): `Complete login in your browser, or paste the final redirect URL here:`.
    /\bpaste\s+(?:the\s+)?(?:final\s+)?redirect\s+url\s+here\b/i,
];

/** A paste-back prompt that also takes the browser's final redirect URL. */
const REDIRECT_URL_ENTRY_PATTERN = /\bredirect\s+url\s+here\b/i;

/**
 * Final lines of a successful CLI login. Only unambiguous past-tense confirmations: a prompt
 * such as "Waiting for authorization…" must never count as connected.
 */
const LOGIN_SUCCESS_PATTERNS: readonly RegExp[] = [
    /\blog(?:ged)?\s*in\s+successful(?:ly)?\b/i,
    /\bsuccessfully\s+(?:logged|signed)\s+in\b/i,
    /\b(?:logged|signed)\s+in\s+(?:successfully|as\s+\S+)/i,
    /\bauthentication\s+(?:successful|complete)\b/i,
    /\bauthenticated\s+as\s+\S+/i,
    // Pi: `Logged in to OpenRouter` (never the `Log in to …` status shown while it waits).
    /(?<!\bnot\s)\blogged\s+in\s+to\s+\w/i,
];

/** A CLI that reported the sign-in itself failed (Pi: `Failed to login to OpenRouter: …`). */
const LOGIN_FAILURE_PATTERNS: readonly RegExp[] = [
    /\bfailed\s+to\s+log\s?in\s+to\b/i,
];

/**
 * Qaap's own pre-spawn sign-in guard refusals (qaap-agent-sign-in-preflight.ts): "Sign in to {0} to use
 * {1}." and "Couldn't confirm your sign-in to {0}; try again.". The guard writes one of them as the whole
 * log of a `preflightFailure: 'sign_in_required'` task; recognizing them makes the transcript offer the
 * Sign in chip instead of the generic "could not start" copy. Anchored to a full line so agent prose
 * that merely mentions signing in does not match.
 */
export const QAAP_SIGN_IN_GUARD_REFUSAL_PATTERNS: readonly RegExp[] = [
    /^\s*sign\s+in\s+to\s+[^\n;]{1,80}?\s+to\s+use\s+[^\n]{1,160}\.\s*$/im,
    /^\s*couldn['\u2019]t\s+confirm\s+your\s+sign-in\s+to\s+[^\n;]{1,80};\s+try\s+again\.\s*$/im,
];

/**
 * Harness CLIs' own "no usable session" refusals, unmistakable wherever they are printed and
 * therefore safe to fail an exit-0 turn on (see {@link isUnauthenticatedCliDeclaration}):
 * - Cursor Agent without a session: "Authentication required. Please run 'agent login' first, or set
 *   CURSOR_API_KEY environment variable." (`cursor-agent login` in older builds);
 * - Codex against the OpenAI API with no credential at all: "unexpected status 401 Unauthorized: Missing
 *   bearer or basic authentication in header";
 * - Codex with an `auth.json` that carries no ChatGPT tokens: "plan type is required for chatgpt authentication".
 * Each is the CLI's or provider's exact wording, not prose an agent would write about auth code.
 */
export const QAAP_HARNESS_UNAUTHENTICATED_PATTERNS: readonly RegExp[] = [
    /\bauthentication\s+required\.\s+please\s+run\s+['"`]?(?:cursor-)?agent\s+login['"`]?\s+first\b/i,
    /\b401\s+unauthorized:?\s+missing\s+bearer\s+or\s+basic\s+authentication\b/i,
    /\bplan\s+type\s+is\s+required\s+for\s+chatgpt\s+authentication\b/i,
];

/**
 * The guard refusal line inside a failure text, with whether the refusal can be retried ("Couldn't confirm your
 * sign-in" is a probe that failed to answer, not a missing sign-in). `undefined` when no line is a guard refusal.
 */
export function matchQaapSignInGuardRefusal(output: string | undefined): { readonly message: string; readonly retryable: boolean } | undefined {
    for (const line of (output ?? '').split('\n')) {
        const trimmed = line.trim();
        if (QAAP_SIGN_IN_GUARD_REFUSAL_PATTERNS.some(pattern => pattern.test(trimmed))) {
            return { message: trimmed, retryable: /^couldn['\u2019]t\s+confirm/i.test(trimmed) };
        }
    }
    return undefined;
}

const SESSION_AUTH_PATTERNS: readonly RegExp[] = [
    ...QAAP_SIGN_IN_GUARD_REFUSAL_PATTERNS,
    ...QAAP_HARNESS_UNAUTHENTICATED_PATTERNS,
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
    // Google's Antigravity CLI (`agy`) without a session (same lines as the failure classifier).
    /\bauthentication\s+required\.\s+please\s+visit\s+the\s+url\s+to\s+log\s+in\b/i,
    /\bauthentication\s+required\.\s+run\s+['"`]?agy['"`]?\s+to\s+log\s+in\b/i,
    /\bauthentication\s+failed\s+or\s+timed\s+out\b/i,
    /\bauthentication\s+interrupted\b/i,
    /\bplease\s+sign\s+in\s+to\s+view\s+available\s+models\b/i,
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

/**
 * Joins a URL that a TUI cut at the end of a row (inside a box gutter or not) with the row that
 * continues it. Only a continuation that cannot be prose is joined: it must start with a URL
 * delimiter, or the cut must follow `=`, `&`, `?`, `#` or a percent-escape.
 */
function joinWrappedAuthUrlRows(text: string): string {
    const rows: string[] = [];
    for (const rawRow of text.split('\n')) {
        const row = rawRow.replace(ROW_EDGE_DECORATION_RE, '');
        const previous = rows.length ? rows[rows.length - 1] : undefined;
        const tail = previous?.match(WRAPPED_URL_TAIL_RE)?.[0];
        const continuation = WRAPPED_URL_ROW_START_RE.exec(row)?.[0];
        if (previous !== undefined && tail && continuation && isWrappedAuthUrlContinuation(tail, continuation)) {
            rows[rows.length - 1] = `${previous}${row}`;
        } else {
            rows.push(row);
        }
    }
    return rows.join('\n');
}

function isWrappedAuthUrlContinuation(tail: string, continuation: string): boolean {
    return /^[%&=?#+.~\/_-]/.test(continuation) || /[=&?#]$|%[0-9A-Fa-f]{2}$/.test(tail);
}

function extractAuthUrls(sample: string, agentId?: string): string[] {
    // Whole OSC-8 targets first: a TUI that wraps its URL row still links the complete URL.
    const hyperlinkTargets = [...sample.matchAll(OSC8_HYPERLINK_TARGET_RE)].map(match => match[1].trim());
    const visible = joinWrappedAuthUrlRows(sample.replace(TERMINAL_CONTROL_RE, ''));
    const candidates = [...hyperlinkTargets, ...[...visible.matchAll(AUTH_URL_RE)].map(match => match[0])];
    const found: string[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
        const url = normalizeTrustedAuthLoginUrl(stripTrailingUrlPunctuation(candidate), agentId);
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
    ...QAAP_HARNESS_UNAUTHENTICATED_PATTERNS,
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
    // Only QAIQ runs on a Settings API key: for every other harness a rejected key ("401 Incorrect
    // API key provided") means its own sign-in is missing or stale, so offer the sign-in flow.
    const mode = options?.preferMode
        ?? (detectedMode === 'api_key' && options?.agentId && !agentNeedsSettingsApiKeyPath(options.agentId) ? 'session' : detectedMode);
    if (!mode && !urls.length && !userCode) {
        return undefined;
    }
    const resolvedMode = mode ?? 'session';
    const codeEntry = matchesAny(sample, CODE_ENTRY_PROMPT_PATTERNS);
    const acceptsRedirectUrl = codeEntry && REDIRECT_URL_ENTRY_PATTERN.test(sample);
    return {
        mode: resolvedMode,
        ...(urls[0] ? { url: urls[0] } : {}),
        ...(userCode ? { userCode } : {}),
        ...(codeEntry ? { codeEntry } : {}),
        ...(acceptsRedirectUrl ? { acceptsRedirectUrl } : {}),
    };
}

/** True when the login CLI reported that the sign-in completed. */
export function isAgentLoginSuccessOutput(output: string | undefined): boolean {
    const sample = (output ?? '').trim();
    return !!sample && matchesAny(sample, LOGIN_SUCCESS_PATTERNS);
}

/** True when the login CLI reported that the sign-in failed (it may keep running, like Pi's TUI). */
export function isAgentLoginFailureOutput(output: string | undefined): boolean {
    const sample = (output ?? '').trim();
    return !!sample && matchesAny(sample, LOGIN_FAILURE_PATTERNS);
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
 *
 * `cliBin` is the Antigravity CLI the host resolved (`harness-status` / agent descriptor `cliBin`). `agy` (the
 * supported client) has no login subcommand, so it gets no command here: the Connect flow drives its Google OAuth
 * picker in the hidden terminal (`resolveAgentConnectionFlow`, kind `tui-login`) and opens the URL it prints. Gemini CLI's in-app sign-in is kept only for a host
 * without `agy`; Google retired it for personal accounts on 18 Jun 2026. A missing `cliBin` keeps that login.
 */
export function resolveAgentLoginCliCommand(agentId: string | undefined, cliBin?: string): string | undefined {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized) {
        return undefined;
    }
    // Commands verified against the CLIs the image installs (Oct 2026, captured under a PTY): each
    // prints a link / device code within seconds and finishes without a localhost callback, which
    // can never reach a headless VPS.
    switch (normalized) {
        case 'codex':
            return 'codex login --device-auth';
        case 'claude':
            // 2.1.x prints `claude.com/cai/oauth/authorize?…` then `Paste code here if prompted >`.
            return 'claude auth login';
        case 'grok':
            // Prints `accounts.x.ai/oauth2/device?user_code=…` and the code on its own line.
            return 'grok login --device-auth';
        case 'copilot':
            // `To authenticate, visit https://github.com/login/device and enter code XXXX-XXXX`.
            // The hidden Connect terminal runs the JavaScript entry instead (resolveAgentHiddenLoginCommand).
            return 'copilot login --device-code';
        case 'opencode':
            // The bare `opencode auth login` opens a provider picker nobody can drive from a phone.
            // The headless ChatGPT method prints `auth.openai.com/codex/device` + `Enter code:`.
            // Flags verified against opencode-ai 1.18.28 (image) and 1.19.6 (latest): `-p` and `-m` still
            // skip both pickers. Its env (resolveAgentLoginEnv) keeps the models.dev refresh from holding the link.
            return 'opencode auth login -p openai -m \'ChatGPT Pro/Plus (headless)\'';
        case 'cursor': {
            // Prints `cursor.com/loginDeepControl?challenge=…&uuid=…` and polls cursor's API for
            // the result (no localhost callback). Hosted runtimes still hide Cursor by policy.
            if (isAgentHiddenOnHostedRuntime('cursor')) {
                return undefined;
            }
            // This common module is bundled into the browser, where Node's `process` is not
            // defined. Keep the optional platform probe guarded so merely opening the picker
            // cannot crash the whole modal.
            const runtimeProcess = (globalThis as typeof globalThis & {
                process?: { readonly platform?: string };
            }).process;
            return runtimeProcess?.platform === 'win32'
                ? '$env:NO_OPEN_BROWSER=\'1\'; cursor-agent login'
                : 'NO_OPEN_BROWSER=1 cursor-agent login';
        }
        case 'openclaude':
            // OpenClaude 0.31 (the QAIQ image build too) prints the same `claude.com/cai/oauth/authorize`
            // link as Claude Code, then `Paste code here if prompted >`.
            return 'openclaude auth login';
        case 'hermes':
            // Hermes 0.19 removed `hermes login`; the Nous Portal device-code sign-in prints
            // `portal.nousresearch.com/manage-subscription?user_code=…` plus the code and polls.
            return 'hermes auth add nous --type oauth --no-browser';
        case 'antigravity':
        case 'gemini':
            // Gemini CLI (fallback host only) has no login subcommand: its interactive start signs in.
            // With "Login with Google" preselected and NO_BROWSER it prints an `accounts.google.com` link
            // and `Enter the authorization code:` instead of a picker. `agy` gets no command (see above).
            return (normalizeAntigravityCliBin(cliBin) ?? 'gemini') === 'gemini' ? resolveGeminiCliLoginCommand() : undefined;
        // QAIQ is the only harness that runs on Settings API keys.
        default:
            return undefined;
    }
}

function isWindowsRuntime(): boolean {
    // Bundled into the browser too, where Node's `process` is not defined.
    return (globalThis as typeof globalThis & { process?: { readonly platform?: string } }).process?.platform === 'win32';
}

/**
 * Finds the JavaScript entry of the Copilot CLI's Linux platform package next to the `copilot` on PATH (the
 * npm loader `@github/copilot/npm-loader.js`) and prints it; prints nothing on any other platform, on a Node
 * older than 22, or for a `copilot` that is not the npm package. Written with double quotes only: the POSIX
 * command wraps it in single quotes.
 */
const COPILOT_JS_ENTRY_SCRIPT = [
    'const fs=require("fs"),path=require("path");',
    'if(process.platform==="linux"&&Number(process.versions.node.split(".")[0])>=22){',
    'for(const dir of (process.env.PATH||"").split(":")){',
    'let real;try{real=fs.realpathSync(path.join(dir||".","copilot"))}catch{continue}',
    'let musl=false;try{musl=!process.report.getReport().header.glibcVersionRuntime}catch{}',
    'const name="copilot-"+(musl?"linuxmusl":"linux")+"-"+process.arch,root=path.dirname(real);',
    'for(const entry of [path.join(root,"node_modules","@github",name,"index.js"),path.join(root,"..",name,"index.js")]){',
    'if(fs.existsSync(entry)){process.stdout.write(entry);process.exit(0)}}',
    'break}}',
].join('');

/**
 * Copilot CLI sign-in on a Linux host. `copilot` is a Node single-executable (SEA) that, on its first run of a
 * version, unpacks a ~170 MB bundle into `~/.cache/copilot/pkg` before printing anything: on a VPS tenant
 * (gVisor, slow overlay disk, tight memory) that took longer than the link deadline, and the retry after the
 * killed first attempt crashed natively inside the SEA (`node::Start` frames, exit 1). The same npm package
 * ships the CLI as plain JavaScript (`index.js` of the platform package); running it on the host's own Node
 * needs no unpacking and no embedded runtime, and stores the sign-in where the CLI reads it (`~/.copilot`).
 * Falls back to the `copilot` binary when that entry cannot be found.
 */
const COPILOT_JS_LOGIN_COMMAND = `qaap_copilot_entry=$(node -e '${COPILOT_JS_ENTRY_SCRIPT}' 2>/dev/null); `
    + 'if [ -n "$qaap_copilot_entry" ]; then node "$qaap_copilot_entry" login --device-code; else copilot login --device-code; fi';

/**
 * Command the hidden Connect terminal runs for a harness's login (`command` is
 * {@link resolveAgentLoginCliCommand}'s). Only Copilot differs: on POSIX hosts it runs the npm package's
 * JavaScript entry when one exists (COPILOT_JS_LOGIN_COMMAND). A visible terminal keeps the plain command.
 */
export function resolveAgentHiddenLoginCommand(agentId: string | undefined, command: string): string {
    return migrateQaapProductAgentId(agentId?.trim()) === 'copilot' && command === 'copilot login --device-code' && !isWindowsRuntime()
        ? COPILOT_JS_LOGIN_COMMAND
        : command;
}

/**
 * Environment the Connect terminal exports for one harness's login command only.
 * - Copilot: no self-update while signing in (the SEA would fetch and switch versions mid-login).
 * - OpenCode: `auth login` force-refreshes the models.dev catalog (10 s timeout, two retries) before it asks
 *   OpenAI for the device code. Behind the tenant egress proxy that refresh can hang for 20-30 s, so the
 *   dialog saw only `┌  Add credential` and gave up after 15 s. An unreachable local catalog URL fails in
 *   milliseconds and OpenCode falls back to the catalog bundled in the binary, which lists `openai`
 *   (verified with opencode-ai 1.19.6: 21.7 s to the code with a black-holed catalog, 1.9 s with this).
 *   The URL also gets its own cache file, so the real `models.json` cache is never touched.
 */
export function resolveAgentLoginEnv(agentId: string | undefined): Readonly<Record<string, string>> | undefined {
    switch (migrateQaapProductAgentId(agentId?.trim())) {
        case 'copilot':
            return { COPILOT_AUTO_UPDATE: 'false' };
        case 'opencode':
            return { OPENCODE_MODELS_URL: QAAP_OPENCODE_LOGIN_MODELS_URL };
        default:
            return undefined;
    }
}

/** Catalog URL for OpenCode's sign-in: refused at once on any host, so its bundled catalog is used. */
export const QAAP_OPENCODE_LOGIN_MODELS_URL = 'http://127.0.0.1:9';

/**
 * Link deadline of the Connect dialog for a harness whose first run does slow one-time work before it prints
 * the link: Copilot's SEA unpacks its bundle when the JavaScript entry is not available; OpenCode creates its
 * database and loads plugins on first use. Undefined keeps the default deadline.
 */
export function resolveAgentLoginChallengeTimeoutMs(agentId: string | undefined): number | undefined {
    switch (migrateQaapProductAgentId(agentId?.trim())) {
        case 'copilot':
            return 60_000;
        case 'opencode':
            return 45_000;
        default:
            return undefined;
    }
}

/**
 * Prepares Gemini CLI for an unattended sign-in, in the agent's own `~/.gemini` (the hidden
 * terminal runs as the tenant uid with the tenant HOME, never the backend's):
 * - selects "Login with Google" (`security.auth.selectedType`), so no auth picker opens;
 * - marks the IDE nudge as seen, so no IDE-integration question opens;
 * - trusts only the current folder (the tenant workspace the Connect terminal starts in) through
 *   the official `trustedFolders.json` rule `TRUST_FOLDER`, so the folder-trust dialog ("Trusting
 *   a folder allows Gemini CLI to load its local configurations...") cannot hold the link back.
 *   Folder trust stays enabled for every other folder, an existing rule for this folder is kept,
 *   and a file this script cannot parse (comments) is left alone.
 * Paths follow Gemini CLI's own `GEMINI_CLI_HOME` / `GEMINI_CLI_TRUSTED_FOLDERS_PATH` overrides.
 * Written with double quotes only: the POSIX command wraps it in single quotes.
 */
const GEMINI_CLI_PREPARE_LOGIN_SCRIPT = [
    'const fs=require("fs"),path=require("path"),os=require("os");',
    'const dir=path.join(process.env.GEMINI_CLI_HOME||os.homedir(),".gemini");',
    'const read=file=>{try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch(error){return error.code==="ENOENT"?{}:undefined}};',
    'const isObject=value=>!!value&&typeof value==="object"&&!Array.isArray(value);',
    'fs.mkdirSync(dir,{recursive:true});',
    'const settingsFile=path.join(dir,"settings.json"),stored=read(settingsFile),settings=isObject(stored)?stored:{};',
    'settings.security={...settings.security,auth:{...(settings.security||{}).auth,selectedType:"oauth-personal"}};',
    'settings.ide={...settings.ide,hasSeenNudge:true};',
    'fs.writeFileSync(settingsFile,JSON.stringify(settings,null,2));',
    'const trustFile=process.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH||path.join(dir,"trustedFolders.json"),rules=read(trustFile),folder=fs.realpathSync(process.cwd());',
    'if(isObject(rules)&&!rules[folder]){rules[folder]="TRUST_FOLDER";fs.mkdirSync(path.dirname(trustFile),{recursive:true});',
    'fs.writeFileSync(trustFile,JSON.stringify(rules,null,2),{mode:0o600})}',
].join('');

/**
 * `GEMINI_CLI_TRUST_WORKSPACE=true` is Gemini CLI's documented per-session trust switch (what
 * `--skip-trust` sets); unlike the flag, older CLIs that do not know it simply ignore it.
 */
function resolveGeminiCliLoginCommand(): string {
    const runtimeProcess = (globalThis as typeof globalThis & {
        process?: { readonly platform?: string };
    }).process;
    return runtimeProcess?.platform === 'win32'
        ? '$env:NO_BROWSER=\'true\'; $env:GEMINI_CLI_TRUST_WORKSPACE=\'true\'; gemini'
        : `node -e '${GEMINI_CLI_PREPARE_LOGIN_SCRIPT}' && NO_BROWSER=true GEMINI_CLI_TRUST_WORKSPACE=true gemini`;
}

/**
 * True when the agent authenticates through a real CLI OAuth / device-code login
 * (a terminal sign-in flow), as opposed to a BYOK / Settings API-key agent.
 * Mirrors {@link resolveAgentLoginCliCommand}: an agent has a terminal sign-in
 * exactly when a dedicated login command exists for it.
 */
export function agentHasCliOAuthLogin(agentId: string | undefined, cliBin?: string): boolean {
    return resolveAgentLoginCliCommand(agentId, cliBin) !== undefined;
}

/** Preferences sheet query that contains BYOK API-key fields (not AI Configuration / MCP). */
export const QAAP_AI_FEATURES_SETTINGS_QUERY = 'ai-features';

/**
 * True when the agent signs in with a Settings API key rather than a CLI OAuth / device-code
 * flow. Product rule: only QAIQ uses an API key; every other harness gets a sign-in, or a clear
 * message when its CLI has none — never an "Add API key" action.
 */
export function agentNeedsSettingsApiKeyPath(agentId: string | undefined): boolean {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized || normalized === 'shell') {
        return false;
    }
    if (isAgentHiddenOnHostedRuntime(normalized)) {
        return false;
    }
    return SETTINGS_API_KEY_AGENT_IDS.has(normalized);
}

/** Harnesses that sign in with a Settings API key. None: every harness connects through its own login. */
const SETTINGS_API_KEY_AGENT_IDS = new Set<string>();

/** Clear instructions for CLIs whose authentication needs interactive input in the tenant terminal. */
export function localizeAgentTenantTerminalLoginMessage(agentLabel: string, command: string, followUp?: string): string {
    if (command.trim() === 'agy') {
        return nls.localize(
            'qaap/agentLogin/antigravityDesktopOnly',
            'Antigravity CLI offers Google OAuth or Google Cloud project sign-in. Qaap web cannot complete this interactive setup. Connect Antigravity in the Qaap desktop app, then return to Work Hub and refresh the agent list.',
        );
    }
    if (followUp) {
        return nls.localize(
            'qaap/agentLogin/tenantTerminalInstructionsFollowUp',
            'To connect {0}, open a terminal for this workspace, run `{1}` and type `{2}`. Finish the sign-in there, then return to Work Hub and refresh the agent list.',
            agentLabel,
            command,
            followUp,
        );
    }
    return nls.localize(
        'qaap/agentLogin/tenantTerminalInstructions',
        'To connect {0}, open a terminal for this workspace and run `{1}`. Finish the CLI sign-in or API-key setup there, then return to Work Hub and refresh the agent list.',
        agentLabel,
        command,
    );
}

/** Actionable fallback for custom harnesses that do not have a registered connection flow. */
export function localizeAgentConnectionUnsupportedMessage(agentLabel: string): string {
    return nls.localize(
        'qaap/agentLogin/unsupportedInstructions',
        'Qaap has no automatic sign-in flow for {0}. Configure its credentials in a terminal inside this tenant workspace, then refresh the agent list and try again.',
        agentLabel,
    );
}

/**
 * User-facing copy for a harness that cannot be connected from a terminal login: the user connects
 * it in Settings → Harness, never by pasting an API key.
 */
export function localizeAgentSettingsApiKeyLoginMessage(agentLabel?: string): string {
    if (agentLabel) {
        return nls.localize(
            'qaap/agentLogin/settingsApiKeyNamed',
            'Connect {0} in Settings → Harness, then retry.',
            agentLabel,
        );
    }
    return nls.localize(
        'qaap/agentLogin/settingsApiKey',
        'Connect this harness in Settings → Harness, then retry.',
    );
}
