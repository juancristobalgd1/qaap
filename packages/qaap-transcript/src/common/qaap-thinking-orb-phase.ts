// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Maps agent activity phases / verbs / tool kinds onto `thinking-orbs` states.
 *
 * Orb states (from the package):
 * - `listening` — waveform; idle / setup / waiting
 * - `solving`   — scrambled bands; reasoning / planning / error tension
 * - `searching` — globe scan; read / explore / search
 * - `working`   — tilted orbits; tools / shell / MCP / generic acting
 * - `composing` — sash; writing the user-visible response
 * - `shaping`   — morph outline; editing / writing files
 */

/** Subset of `thinking-orbs` `OrbState` — kept local so `common/` stays React-free. */
export type QaapThinkingOrbState =
    | 'working'
    | 'searching'
    | 'solving'
    | 'listening'
    | 'composing'
    | 'shaping';

/**
 * Product-level activity phases. Prefer these at call sites; resolve to an
 * {@link QaapThinkingOrbState} with {@link resolveThinkingOrbState}.
 */
export type QaapThinkingOrbPhase =
    | 'listening'
    | 'thinking'
    | 'searching'
    | 'working'
    | 'composing'
    | 'shaping'
    | 'stalled'
    | 'error';

export interface ResolveThinkingOrbPhaseOptions {
    /** Codex-style live verb from the process accordion (`Read`, `Run`, …). */
    readonly activityVerb?: string;
    /** Streaming activity / tool bucket (`reading`, `terminal`, `planning`, …). */
    readonly activityKind?: string;
    readonly isWorking?: boolean;
    readonly isError?: boolean;
    readonly isCancelled?: boolean;
    readonly stalled?: boolean;
    readonly timedOut?: boolean;
    /** First-prompt setup / whimsical phrases (no tools yet). */
    readonly setup?: boolean;
}

/** Phase → orb state mapping (documented contract for UI call sites). */
export const THINKING_ORB_PHASE_TO_STATE: Readonly<Record<QaapThinkingOrbPhase, QaapThinkingOrbState>> = {
    listening: 'listening',
    thinking: 'solving',
    searching: 'searching',
    working: 'working',
    composing: 'composing',
    shaping: 'shaping',
    // No dedicated error animation — `solving` reads as tension; callers may pause.
    stalled: 'solving',
    error: 'solving',
};

export function resolveThinkingOrbState(phase: QaapThinkingOrbPhase): QaapThinkingOrbState {
    return THINKING_ORB_PHASE_TO_STATE[phase];
}

/**
 * Derives a product phase from turn flags + activity verb/kind, then maps to
 * an orb state. Cancelled (non-error) turns keep a paused listening cue via
 * {@link resolveThinkingOrbPaused}.
 */
export function resolveThinkingOrbPhase(options: ResolveThinkingOrbPhaseOptions = {}): QaapThinkingOrbPhase {
    if (options.isError || options.timedOut) {
        return 'error';
    }
    if (options.stalled) {
        return 'stalled';
    }
    if (options.isCancelled) {
        return 'listening';
    }
    if (options.setup) {
        return 'listening';
    }

    const kind = normalizeToken(options.activityKind);
    const verb = normalizeToken(options.activityVerb);

    if (kind === 'timeout' || kind === 'error') {
        return 'error';
    }
    if (kind === 'stall') {
        return 'stalled';
    }
    if (kind === 'writing') {
        return 'composing';
    }
    if (kind === 'thinking' || kind === 'planning') {
        return 'thinking';
    }
    if (kind === 'reading' || kind === 'searching' || kind === 'explore' || kind === 'webfetch') {
        return 'searching';
    }
    if (kind === 'editing' || kind === 'file' || kind === 'write' || kind === 'edit' || kind === 'delete') {
        return 'shaping';
    }
    if (
        kind === 'terminal'
        || kind === 'run'
        || kind === 'tool'
        || kind === 'mcp'
        || kind === 'task'
        || kind === 'delegate'
        || kind === 'todo'
        || kind === 'verification'
        || kind === 'other'
    ) {
        return 'working';
    }

    if (matchesAny(verb, ['read', 'search', 'explore', 'grep', 'glob', 'list', 'find'])) {
        return 'searching';
    }
    // Process-accordion "Write" / "Update" = workspace edits (shaping), not response prose.
    if (matchesAny(verb, ['write', 'wrote', 'update', 'edit', 'patch', 'delete', 'remove', 'shaping'])) {
        return 'shaping';
    }
    if (matchesAny(verb, ['compos', 'preparing'])) {
        return 'composing';
    }
    if (matchesAny(verb, ['think', 'plan', 'reason', 'solv'])) {
        return 'thinking';
    }
    if (matchesAny(verb, ['run', 'bash', 'shell', 'use', 'verif', 'task', 'delegat', 'mcp'])) {
        return 'working';
    }

    if (options.isWorking === false) {
        return 'listening';
    }
    // Active turn without a specific verb/kind — generic acting.
    return 'working';
}

export function resolveThinkingOrbStateFromActivity(
    options: ResolveThinkingOrbPhaseOptions = {},
): QaapThinkingOrbState {
    return resolveThinkingOrbState(resolveThinkingOrbPhase(options));
}

/** Pause the orb on cancelled / stalled turns (error keeps motion as tension). */
export function resolveThinkingOrbPaused(options: ResolveThinkingOrbPhaseOptions = {}): boolean {
    return !!options.isCancelled || !!options.stalled;
}

function normalizeToken(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase();
}

function matchesAny(token: string, needles: readonly string[]): boolean {
    if (!token) {
        return false;
    }
    return needles.some(needle => token.includes(needle));
}
