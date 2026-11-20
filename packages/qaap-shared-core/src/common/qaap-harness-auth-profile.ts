// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { migrateQaapProductAgentId } from './qaap-agent-task-client';
import { normalizeAntigravityCliBin } from './qaap-antigravity-cli';
import { QAAP_BUILTIN_AGENT_DEFINITIONS, resolveQaapBuiltinAgentSignOut } from './qaap-builtin-agents';
import type { QaapHarnessSessionDetection } from './qaap-harness-model-availability';
import type { QaapHarnessSignOut } from './qaap-harness-sign-out';

/**
 * Validation characteristic of a harness's login flow. Adding a new harness only requires picking
 * the matching validation kind and declaring its prompts/timeouts in {@link QAAP_HARNESS_AUTH_PROFILES}:
 * - `device-code`: prints a verification URL + short user code and polls until browser approval
 *   (Codex, Copilot, Grok, OpenCode headless, Hermes);
 * - `oauth-paste-code`: prints an authorization URL and waits for the user to paste the code or
 *   redirect URL back into stdin (Claude Code, OpenClaude, Gemini CLI);
 * - `oauth-browser-poll`: prints a browser URL and polls without a user code or paste-back (Cursor);
 * - `tui-driven`: opens an interactive TUI, drives pre-challenge keystrokes via the input driver,
 *   then completes via browser poll or paste-back (`agy`, Pi);
 * - `tenant-terminal`: interactive onboarding that runs in a visible workspace terminal (OpenClaw).
 */
export type QaapHarnessLoginValidationKind =
    | 'device-code'
    | 'oauth-paste-code'
    | 'oauth-browser-poll'
    | 'tui-driven'
    | 'tenant-terminal';

/** Active phases of the Connect dialog while the login CLI is running. */
export type QaapHarnessLoginPhase = 'waiting' | 'challenge' | 'code-submitted';

/**
 * Interactive prompt that a login CLI may emit during or after the auth challenge (for example,
 * Copilot CLI asking to store the token in its plaintext config file on headless Linux where no OS
 * keychain is available). Serializable regex sources keep profiles pure and testable.
 */
export interface QaapHarnessLoginPromptResponder {
    /** Case-insensitive regex source matched against escape-free terminal output. */
    readonly match: string;
    /** Exact text written to the CLI's stdin when matched (e.g. `'y\\r'`). */
    readonly response: string;
    /** Active phases where this responder triggers. Defaults to `['waiting', 'challenge', 'code-submitted']`. */
    readonly phases?: readonly QaapHarnessLoginPhase[];
    /** When true (default), fires at most once per login attempt. */
    readonly once?: boolean;
}

/** Declarative login characteristics shared by the Connect flow, watchdog and prompt responders. */
export interface QaapHarnessLoginProfile {
    readonly validationKind: QaapHarnessLoginValidationKind;
    /** Link deadline override in ms; undefined keeps the dialog's default. */
    readonly challengeTimeoutMs?: number;
    /** True when the dialog's input driver answers the CLI's first-run picker (e.g. `agy`). */
    readonly answersPrompts?: boolean;
    /** True when every URL challenge also accepts a pasted authorization code (e.g. `agy`). */
    readonly alwaysAcceptsCode?: boolean;
    /** Automated stdin responses for prompts emitted during or after the challenge (e.g. keychain fallback). */
    readonly postChallengeResponders?: readonly QaapHarnessLoginPromptResponder[];
    /** Harness-specific regex sources (case-insensitive) confirming sign-in completion. */
    readonly extraSuccessPatterns?: readonly string[];
    /** Harness-specific regex sources (case-insensitive) indicating sign-in failure (checked before success). */
    readonly extraFailurePatterns?: readonly string[];
}

/**
 * Unified declarative authentication lifecycle profile for one harness:
 * - how its login validates ({@link login});
 * - whether its signed-out state can be detected ({@link sessionDetection});
 * - how Settings → Harness signs it out ({@link signOut}).
 *
 * New harnesses register one entry in {@link QAAP_HARNESS_AUTH_PROFILES} and automatically inherit
 * login orchestration, post-challenge prompt handling, model availability rules and sign-out wiring.
 */
export interface QaapHarnessAuthProfile {
    readonly id: string;
    readonly sessionDetection: QaapHarnessSessionDetection;
    readonly login: QaapHarnessLoginProfile;
    readonly signOut: QaapHarnessSignOut | undefined;
}

interface QaapHarnessLoginProfileBlueprint {
    readonly login: QaapHarnessLoginProfile;
    readonly byBin?: Readonly<Record<string, QaapHarnessLoginProfile>>;
    /** Explicit session detection override for retired/non-builtin harnesses. */
    readonly sessionDetection?: QaapHarnessSessionDetection;
}

/**
 * Copilot CLI on headless Linux (no OS keychain / libsecret) completes GitHub device-code approval
 * and then blocks stdin on:
 * `System keychain unavailable. Store token in plaintext config file? (y/N)`
 * Answering `y\r` lets Copilot persist the token into `~/.copilot/config.json` and finish login.
 */
export const COPILOT_PLAINTEXT_KEYCHAIN_RESPONDER: QaapHarnessLoginPromptResponder = {
    match: 'store\\s+token\\s+in\\s+plaintext\\s+config\\s+file\\?',
    response: 'y\r',
    phases: ['waiting', 'challenge', 'code-submitted'],
    once: true,
};

const AGY_LOGIN_PROFILE: QaapHarnessLoginProfile = {
    validationKind: 'tui-driven',
    challengeTimeoutMs: 30_000,
    answersPrompts: true,
    alwaysAcceptsCode: true,
};

const GEMINI_LOGIN_PROFILE: QaapHarnessLoginProfile = {
    validationKind: 'oauth-paste-code',
};

const HARNESS_AUTH_BLUEPRINTS: Readonly<Record<string, QaapHarnessLoginProfileBlueprint>> = {
    codex: {
        login: {
            validationKind: 'device-code',
        },
    },
    claude: {
        login: {
            validationKind: 'oauth-paste-code',
        },
    },
    opencode: {
        login: {
            validationKind: 'device-code',
            challengeTimeoutMs: 45_000,
        },
    },
    pi: {
        login: {
            validationKind: 'tui-driven',
            challengeTimeoutMs: 30_000,
        },
    },
    cursor: {
        login: {
            validationKind: 'oauth-browser-poll',
        },
    },
    antigravity: {
        // Until the resolved CLI is known, assume nothing agy-specific: the sign-in dialog only answers
        // prompts and always accepts a code once it has actually resolved `agy`.
        login: GEMINI_LOGIN_PROFILE,
        byBin: {
            agy: AGY_LOGIN_PROFILE,
            gemini: GEMINI_LOGIN_PROFILE,
        },
    },
    copilot: {
        login: {
            validationKind: 'device-code',
            challengeTimeoutMs: 60_000,
            postChallengeResponders: [COPILOT_PLAINTEXT_KEYCHAIN_RESPONDER],
            extraFailurePatterns: ['token\\s+was\\s+not\\s+saved'],
        },
    },
    grok: {
        login: {
            validationKind: 'device-code',
            extraSuccessPatterns: ['signed\\s+in\\s*\\(\\s*user_id\\s*:', 'devbox\\s+login\\s+succeeded'],
        },
    },
    // Retired harnesses kept ready so re-enabling them preserves their validation profile.
    openclaude: {
        sessionDetection: 'detectable',
        login: {
            validationKind: 'oauth-paste-code',
        },
    },
    hermes: {
        sessionDetection: 'detectable',
        login: {
            validationKind: 'device-code',
        },
    },
    openclaw: {
        sessionDetection: 'undetectable',
        login: {
            validationKind: 'tenant-terminal',
        },
    },
};

const BUILTIN_SESSION_CHECK_BY_ID = new Map(
    QAAP_BUILTIN_AGENT_DEFINITIONS.map(definition => [definition.id, definition.sessionCheck]),
);

/**
 * Whether `agentId` can reliably detect a signed-out state:
 * - built-in harnesses with `sessionCheck: 'attestation'` are `'undetectable'` (models stay selectable
 *   and auth refusals on run surface Sign in);
 * - built-in harnesses with `sessionCheck: 'probe'` are `'detectable'`.
 */
export function resolveQaapHarnessSessionDetection(agentId: string | undefined): QaapHarnessSessionDetection {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized) {
        return 'detectable';
    }
    const builtinCheck = BUILTIN_SESSION_CHECK_BY_ID.get(normalized);
    if (builtinCheck !== undefined) {
        return builtinCheck === 'attestation' ? 'undetectable' : 'detectable';
    }
    return HARNESS_AUTH_BLUEPRINTS[normalized]?.sessionDetection ?? 'detectable';
}

/**
 * Resolves the unified declarative {@link QaapHarnessAuthProfile} for a harness id (and optional
 * detected `cliBin`, e.g. `agy` vs `gemini` for Antigravity).
 */
export function resolveQaapHarnessAuthProfile(
    agentId: string | undefined,
    options?: { readonly cliBin?: string },
): QaapHarnessAuthProfile | undefined {
    const normalized = migrateQaapProductAgentId(agentId?.trim());
    if (!normalized) {
        return undefined;
    }
    const blueprint = HARNESS_AUTH_BLUEPRINTS[normalized];
    if (!blueprint) {
        return undefined;
    }
    let login = blueprint.login;
    if (blueprint.byBin) {
        const binKey = normalized === 'antigravity'
            ? (normalizeAntigravityCliBin(options?.cliBin) ?? undefined)
            : options?.cliBin?.trim().split(/[/\\]/).pop()?.toLowerCase();
        if (binKey && Object.prototype.hasOwnProperty.call(blueprint.byBin, binKey)) {
            login = blueprint.byBin[binKey];
        }
    }
    return {
        id: normalized,
        sessionDetection: resolveQaapHarnessSessionDetection(normalized),
        login,
        signOut: resolveQaapBuiltinAgentSignOut(normalized),
    };
}

/** All built-in harness auth profiles, derived from {@link QAAP_BUILTIN_AGENT_DEFINITIONS}. */
export const QAAP_HARNESS_AUTH_PROFILES: readonly QaapHarnessAuthProfile[] = QAAP_BUILTIN_AGENT_DEFINITIONS
    .map(definition => resolveQaapHarnessAuthProfile(definition.id, { cliBin: definition.bin }))
    .filter((profile): profile is QaapHarnessAuthProfile => profile !== undefined);
