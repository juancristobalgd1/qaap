// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Route under `QAAP_AGENT_TASK_API_PATH` that signs the owner out of one harness. */
export const QAAP_HARNESS_SIGN_OUT_ROUTE = 'harness-sign-out';

/**
 * Fired on `window` once Settings → Harness signs a harness out. Surfaces that hold their own
 * copy of the agent/model catalog (the main composer, open transcript composers, the side chat,
 * and the tab's sessionStorage cache) listen to it and reload immediately.
 */
export const QAAP_AGENT_SIGNED_OUT_EVENT = 'qaap-agent-signed-out';

export interface QaapAgentSignedOutDetail {
    readonly agentId: string;
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

/**
 * How the backend signs the owner out of a built-in harness:
 * - `cli`: runs the harness CLI's own non-interactive logout subcommand in the tenant environment;
 * - `files`: deletes an allowlisted set of credential files inside the tenant's allowed roots;
 * - `json-keys`: strips an allowlisted set of top-level keys from one JSON file inside the tenant's allowed roots;
 * - `none`: the CLI has no safe programmatic sign-out (Settings → Harness hides the button, backend refuses).
 */
export type QaapHarnessSignOut =
    | {
        readonly kind: 'cli';
        readonly args: readonly string[];
        readonly env?: Readonly<Record<string, string>>;
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

export type QaapHarnessSignOutFailureReason = 'unsupported' | 'unavailable' | 'failed';

export interface QaapHarnessSignOutResult {
    readonly ok: boolean;
    readonly harnessId: string;
    readonly connectionState: 'connected' | 'disconnected' | 'unknown' | 'not-required';
    readonly reason?: QaapHarnessSignOutFailureReason;
    readonly message?: string;
}

/** True when a harness declares a supported sign-out strategy (fail-closed: `undefined` and `'none'` are false). */
export function isQaapHarnessSignOutSupported(signOut: QaapHarnessSignOut | undefined): boolean {
    return signOut !== undefined && signOut.kind !== 'none';
}

/** True when signing out wipes credentials for every provider saved in that CLI (OpenCode, Pi). */
export function doesQaapHarnessSignOutRemoveAllProviders(signOut: QaapHarnessSignOut | undefined): boolean {
    return signOut !== undefined
        && (signOut.kind === 'files' || signOut.kind === 'json-keys')
        && signOut.removesAllProviders === true;
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
