// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type HarnessAvailabilityState = 'loading' | 'ready' | 'unavailable';

export type HarnessConnectionState = 'connected' | 'disconnected' | 'unknown' | 'not-required';

export type HarnessCardStatus =
    | 'loading'
    | 'availability-unknown'
    | 'available'
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
    if (connectionState === 'connected' || connectionState === 'not-required') {
        return 'available';
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
