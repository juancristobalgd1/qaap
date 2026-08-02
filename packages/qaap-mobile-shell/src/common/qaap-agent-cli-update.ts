// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Pure helpers for agent CLI update notifications (version parse/compare + dismiss policy).
 * Keep the HTTP path in sync with `@theia/qaap-cloud-workspace` agent-task endpoint.
 */

import { QAAP_AGENT_TASK_API_PATH } from './qaap-agent-task-client';

/** GET list / POST update under the agent-tasks API. */
export const QAAP_AGENT_CLI_UPDATES_PATH = `${QAAP_AGENT_TASK_API_PATH}/cli-updates`;

/** localStorage key for per-agent dismissals of a specific latest version. */
export const QAAP_AGENT_CLI_UPDATE_DISMISS_KEY = 'qaap.agentCliUpdate.dismissed';

/**
 * Display priority when several CLIs are outdated — show one toast at a time.
 * Product focus first (Codex / Claude / QAIQ), then other npm-backed CLIs.
 */
export const QAAP_AGENT_CLI_UPDATE_PRIORITY: readonly string[] = [
    'codex',
    'claude',
    'qaiq',
    'opencode',
    'copilot',
    'antigravity',
    'grok',
];

/** One outdated (or updatable) agent CLI reported by the backend. */
export interface QaapAgentCliUpdateInfo {
    readonly id: string;
    readonly label: string;
    /** Absolute or PATH binary name used for the probe. */
    readonly bin: string;
    /** Parsed installed semver when `--version` succeeded. */
    readonly installedVersion?: string;
    /** Target / latest semver the backend compared against. */
    readonly latestVersion: string;
    readonly updateAvailable: boolean;
    /** npm package name when in-place `npm install -g` is supported. */
    readonly npmPackage?: string;
    /** True when the backend can attempt an in-place update for this agent. */
    readonly updateSupported: boolean;
}

export interface QaapAgentCliUpdatesResponse {
    readonly updates: readonly QaapAgentCliUpdateInfo[];
}

export interface QaapAgentCliUpdateResult {
    readonly ok: boolean;
    readonly id: string;
    readonly installedVersion?: string;
    readonly message?: string;
}

/** Map of agentId → dismissed latestVersion (persists across reloads; a newer version re-prompts). */
export type QaapAgentCliUpdateDismissMap = Readonly<Record<string, string>>;

/**
 * Extract the first semver-like token from CLI `--version` output.
 * Handles forms like `codex-cli 0.145.0`, `0.2.1 (Claude Code)`, `qaiq 1.0.0-beta.1`.
 */
export function parseCliVersion(raw: string | undefined): string | undefined {
    if (!raw) {
        return undefined;
    }
    const match = raw.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
    return match?.[1];
}

function parseSemverParts(version: string): { readonly core: number[]; readonly pre: string } | undefined {
    const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match) {
        return undefined;
    }
    return {
        core: [Number(match[1]), Number(match[2]), Number(match[3])],
        pre: match[4] ?? '',
    };
}

/**
 * Compare two semver strings (core + optional prerelease).
 * @returns negative when `a < b`, 0 when equal, positive when `a > b`.
 * Non-parseable inputs sort as equal (0) so callers can treat them as "unknown / not outdated".
 */
export function compareSemver(a: string, b: string): number {
    const left = parseSemverParts(a);
    const right = parseSemverParts(b);
    if (!left || !right) {
        return 0;
    }
    for (let i = 0; i < 3; i++) {
        const diff = left.core[i]! - right.core[i]!;
        if (diff !== 0) {
            return diff;
        }
    }
    if (left.pre === right.pre) {
        return 0;
    }
    // A release without prerelease is newer than one with (1.0.0 > 1.0.0-beta).
    if (!left.pre) {
        return 1;
    }
    if (!right.pre) {
        return -1;
    }
    return left.pre < right.pre ? -1 : left.pre > right.pre ? 1 : 0;
}

/** True when installed is strictly older than latest (both must parse as semver). */
export function isVersionOutdated(installed: string | undefined, latest: string | undefined): boolean {
    if (!installed || !latest) {
        return false;
    }
    return compareSemver(installed, latest) < 0;
}

/**
 * Whether the boot toast should surface this update given session dismissals.
 * Dismiss is scoped to a specific `latestVersion` so a newer release re-prompts.
 */
export function shouldShowAgentUpdateNotification(
    info: Pick<QaapAgentCliUpdateInfo, 'id' | 'latestVersion' | 'updateAvailable'>,
    dismissed: QaapAgentCliUpdateDismissMap | undefined,
): boolean {
    if (!info.updateAvailable || !info.latestVersion) {
        return false;
    }
    const dismissedVersion = dismissed?.[info.id];
    return dismissedVersion !== info.latestVersion;
}

/** Pick the highest-priority update that still passes {@link shouldShowAgentUpdateNotification}. */
export function pickNextAgentUpdateToShow(
    updates: readonly QaapAgentCliUpdateInfo[],
    dismissed: QaapAgentCliUpdateDismissMap | undefined,
): QaapAgentCliUpdateInfo | undefined {
    const eligible = updates.filter(info => shouldShowAgentUpdateNotification(info, dismissed));
    if (eligible.length === 0) {
        return undefined;
    }
    const priorityIndex = (id: string): number => {
        const idx = QAAP_AGENT_CLI_UPDATE_PRIORITY.indexOf(id);
        return idx >= 0 ? idx : QAAP_AGENT_CLI_UPDATE_PRIORITY.length + 1;
    };
    return [...eligible].sort((a, b) => {
        const byPriority = priorityIndex(a.id) - priorityIndex(b.id);
        if (byPriority !== 0) {
            return byPriority;
        }
        return a.id.localeCompare(b.id);
    })[0];
}

export function readAgentCliUpdateDismissMap(
    storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): QaapAgentCliUpdateDismissMap {
    if (!storage) {
        return {};
    }
    try {
        const raw = storage.getItem(QAAP_AGENT_CLI_UPDATE_DISMISS_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === 'string' && value.trim()) {
                out[key] = value.trim();
            }
        }
        return out;
    } catch {
        return {};
    }
}

export function rememberAgentCliUpdateDismiss(
    agentId: string,
    latestVersion: string,
    storage: Pick<Storage, 'getItem' | 'setItem'> | undefined =
        typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
    if (!storage || !agentId || !latestVersion) {
        return;
    }
    const next = { ...readAgentCliUpdateDismissMap(storage), [agentId]: latestVersion };
    try {
        storage.setItem(QAAP_AGENT_CLI_UPDATE_DISMISS_KEY, JSON.stringify(next));
    } catch {
        /* localStorage may be unavailable (private mode / quota) — ignore */
    }
}

/** Fetch outdated agent CLIs from the backend (auth cookie required). */
export async function fetchAgentCliUpdates(
    fetchImpl: typeof fetch = fetch,
): Promise<QaapAgentCliUpdatesResponse> {
    const response = await fetchImpl(QAAP_AGENT_CLI_UPDATES_PATH, { credentials: 'include' });
    if (!response.ok) {
        throw new Error(`Agent CLI updates request failed (${response.status})`);
    }
    const body = await response.json() as Partial<QaapAgentCliUpdatesResponse>;
    const updates = Array.isArray(body.updates) ? body.updates.filter(isAgentCliUpdateInfo) : [];
    return { updates };
}

/** Ask the backend to install the latest package for one agent (best-effort). */
export async function requestAgentCliUpdate(
    agentId: string,
    fetchImpl: typeof fetch = fetch,
): Promise<QaapAgentCliUpdateResult> {
    const response = await fetchImpl(
        `${QAAP_AGENT_CLI_UPDATES_PATH}/${encodeURIComponent(agentId)}`,
        { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    const body = await response.json().catch(() => ({})) as Partial<QaapAgentCliUpdateResult> & { error?: string };
    if (!response.ok) {
        return {
            ok: false,
            id: agentId,
            message: typeof body.error === 'string' ? body.error
                : typeof body.message === 'string' ? body.message
                    : `Update failed (${response.status})`,
        };
    }
    return {
        ok: !!body.ok,
        id: typeof body.id === 'string' ? body.id : agentId,
        installedVersion: typeof body.installedVersion === 'string' ? body.installedVersion : undefined,
        message: typeof body.message === 'string' ? body.message : undefined,
    };
}

function isAgentCliUpdateInfo(value: unknown): value is QaapAgentCliUpdateInfo {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const row = value as Record<string, unknown>;
    return typeof row.id === 'string'
        && typeof row.label === 'string'
        && typeof row.bin === 'string'
        && typeof row.latestVersion === 'string'
        && typeof row.updateAvailable === 'boolean'
        && typeof row.updateSupported === 'boolean';
}
