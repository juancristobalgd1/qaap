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
    /**
     * The CLI is blocked on a prompt for the code the sign-in page shows after approval
     * (Claude Code `Paste code here if prompted >`, Gemini `Enter the authorization code:`).
     * The dialog must offer an input whose value is written to the CLI's stdin.
     */
    readonly codeEntry?: boolean;
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
    { agents: ['copilot'], hostname: 'login.microsoftonline.com', path: /^\/[^/]+\/oauth2\/(?:v2\.0\/)?authorize(?:\/|$)/i },
];

/** Prompts of CLIs that wait for the user to paste back the code shown after approval. */
const CODE_ENTRY_PROMPT_PATTERNS: readonly RegExp[] = [
    /\bpaste\s+(?:the\s+)?(?:authorization\s+)?code\s+here\b/i,
    /\benter\s+the\s+authori[sz]ation\s+code\b/i,
];

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
    // Only QAIQ runs on a Settings API key: for every other harness a rejected key ("401 Incorrect
    // API key provided") means its own sign-in is missing or stale, so offer the sign-in flow.
    const mode = options?.preferMode
        ?? (detectedMode === 'api_key' && options?.agentId && !agentNeedsSettingsApiKeyPath(options.agentId) ? 'session' : detectedMode);
    if (!mode && !urls.length && !userCode) {
        return undefined;
    }
    const resolvedMode = mode ?? 'session';
    const codeEntry = matchesAny(sample, CODE_ENTRY_PROMPT_PATTERNS);
    return {
        mode: resolvedMode,
        ...(urls[0] ? { url: urls[0] } : {}),
        ...(userCode ? { userCode } : {}),
        ...(codeEntry ? { codeEntry } : {}),
    };
}

/** True when the login CLI reported that the sign-in completed. */
export function isAgentLoginSuccessOutput(output: string | undefined): boolean {
    const sample = (output ?? '').trim();
    return !!sample && matchesAny(sample, LOGIN_SUCCESS_PATTERNS);
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
            return 'copilot login --device-code';
        case 'opencode':
            // The bare `opencode auth login` opens a provider picker nobody can drive from a phone.
            // The headless ChatGPT method prints `auth.openai.com/codex/device` + `Enter code:`.
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
            // The harness runs on Gemini CLI, which has no login subcommand: its interactive start
            // signs in. With "Login with Google" preselected and NO_BROWSER it prints an
            // `accounts.google.com` link and `Enter the authorization code:` instead of a picker.
            return resolveGeminiCliLoginCommand();
        // QAIQ is the only harness that runs on Settings API keys.
        default:
            return undefined;
    }
}

/** Selects Gemini CLI's "Login with Google" in `~/.gemini/settings.json`, keeping other settings. */
const GEMINI_CLI_SELECT_GOOGLE_LOGIN_SCRIPT = 'const fs=require("fs"),path=require("path"),file=path.join(require("os").homedir(),".gemini","settings.json");'
    + 'let settings={};try{settings=JSON.parse(fs.readFileSync(file,"utf8"))}catch{}'
    + 'settings.security={...settings.security,auth:{...(settings.security||{}).auth,selectedType:"oauth-personal"}};'
    + 'fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(settings,null,2))';

function resolveGeminiCliLoginCommand(): string {
    const runtimeProcess = (globalThis as typeof globalThis & {
        process?: { readonly platform?: string };
    }).process;
    return runtimeProcess?.platform === 'win32'
        ? '$env:NO_BROWSER=\'true\'; gemini'
        : `node -e '${GEMINI_CLI_SELECT_GOOGLE_LOGIN_SCRIPT}' && NO_BROWSER=true gemini`;
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

/** Harnesses whose background task runner consumes credentials from the user's BYOK settings. */
const SETTINGS_API_KEY_AGENT_IDS = new Set([
    QAIQ_AGENT_ID,
]);

export function localizeAddApiKeyInSettingsCta(): string {
    return nls.localize(
        'qaap/agentLogin/addApiKeyInSettings',
        'Add API key in Settings',
    );
}

/** Clear instructions for CLIs whose authentication needs interactive input in the tenant terminal. */
export function localizeAgentTenantTerminalLoginMessage(agentLabel: string, command: string): string {
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
