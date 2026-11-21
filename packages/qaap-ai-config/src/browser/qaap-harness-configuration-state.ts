// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type HarnessAvailabilityState = 'loading' | 'ready' | 'unavailable';

export type HarnessConnectionState = 'connected' | 'disconnected' | 'unknown' | 'not-required';

export type HarnessCardStatus =
    | 'loading'
    | 'availability-unknown'
    /** Installed and its sign-in is confirmed. */
    | 'signed-in'
    /** Installed and it needs no sign-in (or runs on a key Qaap holds). */
    | 'ready'
    | 'installed-disconnected'
    | 'installed-connection-unknown'
    | 'not-installed';

export type HarnessCardAction =
    | 'loading'
    | 'toggle'
    | 'install'
    | 'install-unavailable'
    | 'install-no-package'
    | 'availability-unknown';

export function resolveHarnessCardAction(
    installed: boolean,
    availabilityState: HarnessAvailabilityState,
    installSupported: boolean,
    installPackageAvailable: boolean = true,
): HarnessCardAction {
    if (availabilityState === 'loading') {
        return 'loading';
    }
    if (installed) {
        return 'toggle';
    }
    if (availabilityState === 'unavailable') {
        return 'availability-unknown';
    }
    if (installSupported) {
        return 'install';
    }
    // Packageless harnesses must not read like a server policy that an administrator could lift.
    return installPackageAvailable ? 'install-unavailable' : 'install-no-package';
}

export function resolveHarnessCardStatus(
    installed: boolean,
    availabilityState: HarnessAvailabilityState,
    connectionState: HarnessConnectionState,
): HarnessCardStatus {
    if (availabilityState === 'loading') {
        return 'loading';
    }
    if (availabilityState === 'unavailable') {
        return 'availability-unknown';
    }
    if (!installed) {
        return 'not-installed';
    }
    if (connectionState === 'connected') {
        return 'signed-in';
    }
    if (connectionState === 'not-required') {
        return 'ready';
    }
    return connectionState === 'disconnected' ? 'installed-disconnected' : 'installed-connection-unknown';
}

/** Why the user's last turn with a harness failed (mirrors the backend's QaapAgentLastTurnFailureKind). */
export type HarnessLastTurnFailureKind =
    | 'auth'
    | 'quota'
    | 'rate_limit'
    | 'model_unavailable'
    | 'tool_unsupported'
    | 'cli_missing'
    | 'timeout'
    | 'network'
    | 'exit_code';

const HARNESS_LAST_TURN_FAILURE_KINDS: ReadonlySet<string> = new Set<HarnessLastTurnFailureKind>([
    'auth', 'quota', 'rate_limit', 'model_unavailable', 'tool_unsupported', 'cli_missing', 'timeout', 'network', 'exit_code',
]);

/** The user's last finished turn with a harness, as served by /qaap/api/agent-tasks/harness-status. */
export interface HarnessLastTurn {
    readonly outcome: 'ok' | 'failed';
    /** Unknown kinds from a newer backend read as `exit_code` (a generic failure). */
    readonly kind?: HarnessLastTurnFailureKind;
    readonly at: number;
}

/** Validates the untyped JSON field; anything malformed means "no last turn". */
export function parseHarnessLastTurn(value: unknown): HarnessLastTurn | undefined {
    const candidate = value as { outcome?: unknown; kind?: unknown; at?: unknown } | undefined;
    if (!candidate || (candidate.outcome !== 'ok' && candidate.outcome !== 'failed')
        || typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) {
        return undefined;
    }
    if (candidate.outcome === 'ok') {
        return { outcome: 'ok', at: candidate.at };
    }
    const kind = typeof candidate.kind === 'string' && HARNESS_LAST_TURN_FAILURE_KINDS.has(candidate.kind)
        ? candidate.kind as HarnessLastTurnFailureKind
        : 'exit_code';
    return { outcome: 'failed', kind, at: candidate.at };
}

export interface HarnessLastTurnAge {
    readonly unit: 'now' | 'minutes' | 'hours' | 'days';
    readonly value: number;
}

/** Coarse age for "2 h ago"; a clock skew into the future reads as now. */
export function resolveHarnessLastTurnAge(at: number, now: number): HarnessLastTurnAge {
    const minutes = Math.floor(Math.max(0, now - at) / 60_000);
    if (minutes < 1) {
        return { unit: 'now', value: 0 };
    }
    if (minutes < 60) {
        return { unit: 'minutes', value: minutes };
    }
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? { unit: 'hours', value: hours } : { unit: 'days', value: Math.floor(hours / 24) };
}

/** One row of Settings → Harness: a built-in harness or an instance added with "Add harness". */
export interface HarnessSettingsRow {
    readonly id: string;
    readonly baseId: string;
    readonly baseLabel: string;
    readonly bin: string;
    readonly label: string;
    readonly isInstance: boolean;
}

/**
 * Built-in harnesses in catalog order, each followed by its instances. Instances whose base harness is not
 * in the catalog (retired) are left out; the display name comes from the harness settings.
 */
export function resolveHarnessSettingsRows(
    definitions: readonly { readonly id: string; readonly label: string; readonly bin: string }[],
    instances: readonly { readonly id: string; readonly baseId: string }[],
    labelFor: (harnessId: string, baseLabel: string) => string,
): HarnessSettingsRow[] {
    const rows: HarnessSettingsRow[] = [];
    for (const definition of definitions) {
        rows.push({
            id: definition.id,
            baseId: definition.id,
            baseLabel: definition.label,
            bin: definition.bin,
            label: labelFor(definition.id, definition.label),
            isInstance: false,
        });
        for (const instance of instances) {
            if (instance.baseId === definition.id) {
                rows.push({
                    id: instance.id,
                    baseId: definition.id,
                    baseLabel: definition.label,
                    bin: definition.bin,
                    label: labelFor(instance.id, definition.label),
                    isInstance: true,
                });
            }
        }
    }
    return rows;
}
