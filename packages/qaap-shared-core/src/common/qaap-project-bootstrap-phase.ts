// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type QaapPersistedBootstrapPhase =
    | 'idle'
    | 'detected'
    | 'installing'
    | 'install-failed'
    | 'ready-to-run'
    | 'starting'
    | 'running'
    | 'run-failed'
    | 'dismissed';

/** Maps a persisted bootstrap phase to the phase we should boot into after workspace detection. */
export function normalizePersistedBootstrapPhase(
    phase: QaapPersistedBootstrapPhase,
    nodeModulesPresent: boolean,
): QaapPersistedBootstrapPhase {
    switch (phase) {
        case 'running':
        case 'starting':
        case 'installing':
        case 'detected':
            return nodeModulesPresent ? 'ready-to-run' : 'detected';
        default:
            return phase;
    }
}
