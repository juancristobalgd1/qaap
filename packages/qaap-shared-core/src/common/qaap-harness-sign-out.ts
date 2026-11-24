// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Route under `QAAP_AGENT_TASK_API_PATH` that signs the owner out of one harness. */
export const QAAP_HARNESS_SIGN_OUT_ROUTE = 'harness-sign-out';

/**
 * Fired on `window` by the Connect dialog once a harness sign-in is confirmed (and attested, when
 * required). Surfaces that keep their own copy of the agent/harness catalog (the right panel's
 * side chat, Settings → Harness) listen to it and reload; the detail carries only the agent id.
 */
export const QAAP_AGENT_SIGNED_IN_EVENT = 'qaap-agent-signed-in';

export interface QaapAgentSignedInDetail {
    readonly agentId: string;
}

/**
 * Fired on `window` once Settings → Harness signs a harness out. Surfaces that hold their own
 * copy of the agent/model catalog (the main composer, open transcript composers, the side chat,
 * and the tab's sessionStorage cache) listen to it and reload immediately.
 */
export const QAAP_AGENT_SIGNED_OUT_EVENT = 'qaap-agent-signed-out';

export interface QaapAgentSignedOutDetail {
    readonly agentId: string;
}

/**
 * Fired on `window` when the backend pushes a live native model catalog update for a harness
 * (for example, `pi --list-models` finishing after connecting a new provider). Open model pickers
 * and composers listen to it and refetch only that harness without waiting for polling or reload.
 */
export const QAAP_AGENT_MODELS_CHANGED_EVENT = 'qaap-agent-models-changed';

export interface QaapAgentModelsChangedDetail {
    readonly agentId: string;
}

/**
 * Environment variables each harness CLI treats as a ready credential, independently of its own sign-in.
 * Sign out cannot remove an inherited variable, so a harness that still reports a session after signing out
 * names the variable instead of claiming it signed out.
 */
export const QAAP_HARNESS_ENV_CREDENTIALS: Readonly<Record<string, readonly string[]>> = {
    claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
    codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
    cursor: ['CURSOR_API_KEY'],
    copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
    grok: ['XAI_API_KEY', 'GROK_API_KEY'],
    antigravity: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'],
};

/** Names of the {@link QAAP_HARNESS_ENV_CREDENTIALS} set to a non-empty value in `env` (never the values). */
export function findQaapHarnessEnvCredentials(baseId: string, env: Readonly<Record<string, string | undefined>>): string[] {
    const names = QAAP_HARNESS_ENV_CREDENTIALS[baseId.trim().toLowerCase()] ?? [];
    return names.filter(name => (env[name] ?? '').trim().length > 0);
}

/** Allowed environment-variable roots for credential file sign-out. */
export type QaapHarnessCredentialEnvRoot = 'XDG_DATA_HOME' | 'PI_CODING_AGENT_DIR';

/**
 * Where a harness's credential file lives inside the tenant's own HOME / XDG / agent directory.
 * Always rooted at `home` or a named environment variable with a relative fallback under `home`.
 */
export type QaapHarnessCredentialRoot =
    | 'home'
    | { readonly env: QaapHarnessCredentialEnvRoot; readonly fallback: string };

export interface QaapHarnessCredentialPath {
    readonly root: QaapHarnessCredentialRoot;
    /** Relative POSIX path under {@link root}. Must never contain `..`, `.`, empty segments or NUL. */
    readonly relative: string;
}

/** One scripted keystroke step sent to an interactive CLI TUI during programmatic sign-out. */
export interface QaapHarnessTuiSignOutStep {
    /** Raw input written to the PTY stdin (e.g. `'/logout\\r'`, `'\\r'`). */
    readonly text: string;
    /** Case-insensitive regex source to wait for in escape-free output before sending. */
    readonly waitFor?: string;
    /** Maximum ms to wait for {@link waitFor} before sending anyway. */
    readonly fallbackMs?: number;
}

/** A concrete (non-branching) sign-out strategy for one executable. */
export type QaapHarnessConcreteSignOut =
    | {
        readonly kind: 'cli';
        readonly args: readonly string[];
        readonly env?: Readonly<Record<string, string>>;
    }
    | {
        readonly kind: 'tui';
        readonly args?: readonly string[];
        readonly env?: Readonly<Record<string, string>>;
        readonly steps: readonly QaapHarnessTuiSignOutStep[];
        /** Case-insensitive regex sources confirming sign-out completed. */
        readonly successPatterns: readonly string[];
        readonly timeoutMs?: number;
    }
    | {
        readonly kind: 'files';
        readonly removesAllProviders?: boolean;
        readonly paths: readonly QaapHarnessCredentialPath[];
    }
    | {
        readonly kind: 'json-keys';
        readonly removesAllProviders?: boolean;
        readonly path: QaapHarnessCredentialPath;
        readonly keys: readonly string[];
    }
    | {
        readonly kind: 'none';
        readonly reason: string;
    };

/**
 * How the backend signs the owner out of a built-in harness:
 * - `cli`: runs the harness CLI's own non-interactive logout subcommand in the tenant environment;
 * - `tui`: launches the interactive CLI in a bounded PTY and drives its logout command (e.g. `agy` `/logout`);
 * - `files`: deletes an allowlisted set of credential files inside the tenant's allowed roots;
 * - `json-keys`: strips an allowlisted set of top-level keys from one JSON file inside the tenant's allowed roots;
 * - `by-bin`: selects a concrete strategy based on the detected CLI executable basename (e.g. `agy` vs `gemini`);
 * - `none`: the CLI has no safe programmatic sign-out (Settings → Harness hides the button, backend refuses).
 */
export type QaapHarnessSignOut =
    | QaapHarnessConcreteSignOut
    | {
        readonly kind: 'by-bin';
        readonly byBin: Readonly<Record<string, QaapHarnessConcreteSignOut>>;
        readonly fallback?: QaapHarnessConcreteSignOut;
    };

export type QaapHarnessSignOutFailureReason = 'unsupported' | 'unavailable' | 'failed';

export interface QaapHarnessSignOutResult {
    readonly ok: boolean;
    readonly harnessId: string;
    readonly connectionState: 'connected' | 'disconnected' | 'unknown' | 'not-required';
    readonly reason?: QaapHarnessSignOutFailureReason;
    readonly message?: string;
}

/** Resolves a `by-bin` sign-out declaration against a detected executable name or path. */
export function resolveQaapHarnessSignOutForBin(
    signOut: QaapHarnessSignOut | undefined,
    bin: string | undefined,
): QaapHarnessConcreteSignOut | undefined {
    if (!signOut) {
        return undefined;
    }
    if (signOut.kind !== 'by-bin') {
        return signOut;
    }
    const baseName = bin?.trim().split(/[/\\]/).pop()?.toLowerCase();
    if (baseName && Object.prototype.hasOwnProperty.call(signOut.byBin, baseName)) {
        return signOut.byBin[baseName];
    }
    return signOut.fallback;
}

/** True when a harness declares a supported sign-out strategy (fail-closed: `undefined` and `'none'` are false). */
export function isQaapHarnessSignOutSupported(signOut: QaapHarnessSignOut | undefined, bin?: string): boolean {
    if (!signOut) {
        return false;
    }
    if (signOut.kind === 'by-bin') {
        if (bin !== undefined) {
            const concrete = resolveQaapHarnessSignOutForBin(signOut, bin);
            return concrete !== undefined && concrete.kind !== 'none';
        }
        return Object.values(signOut.byBin).some(entry => entry.kind !== 'none')
            || (signOut.fallback !== undefined && signOut.fallback.kind !== 'none');
    }
    return signOut.kind !== 'none';
}

/**
 * True when an extra harness instance (`codex#2`, `claude#2`, …) can be signed out safely without
 * touching the base harness's credentials: only `cli` and `tui` strategies run inside the instance's
 * own launch environment (`homeDir` / `binaryPath`).
 */
export function isQaapHarnessInstanceSignOutSupported(signOut: QaapHarnessSignOut | undefined, bin?: string): boolean {
    if (!signOut) {
        return false;
    }
    const concrete = signOut.kind === 'by-bin'
        ? (bin !== undefined
            ? resolveQaapHarnessSignOutForBin(signOut, bin)
            : Object.values(signOut.byBin).find(entry => entry.kind === 'cli' || entry.kind === 'tui') ?? signOut.fallback)
        : signOut;
    return concrete !== undefined && (concrete.kind === 'cli' || concrete.kind === 'tui');
}

/** True when signing out wipes credentials for every provider saved in that CLI (OpenCode, Pi). */
export function doesQaapHarnessSignOutRemoveAllProviders(signOut: QaapHarnessSignOut | undefined, bin?: string): boolean {
    if (!signOut) {
        return false;
    }
    const concrete = signOut.kind === 'by-bin' ? resolveQaapHarnessSignOutForBin(signOut, bin) : signOut;
    return concrete !== undefined
        && (concrete.kind === 'files' || concrete.kind === 'json-keys')
        && concrete.removesAllProviders === true;
}

/** Static path shape check for allowlisted relative credential paths (no traversal, absolute prefixes or NUL). */
export function isSafeRelativeCredentialPath(relative: string): boolean {
    if (!relative || relative.includes('\0')) {
        return false;
    }
    if (relative.startsWith('/') || relative.startsWith('\\') || /^[a-zA-Z]:/.test(relative)) {
        return false;
    }
    const segments = relative.split(/[/\\]/);
    return segments.length > 0 && segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}
