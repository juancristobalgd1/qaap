// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

export type VerifyCommitReadinessLevel =
    | 'ready'
    | 'running'
    | 'loading'
    | 'not_configured'
    | 'missing'
    | 'stale'
    | 'failing';

export interface VerifyCommitCheckSnapshot {
    readonly state: 'idle' | 'checking' | 'running' | 'ok' | 'fail';
    workspaceSnapshot?: 'current' | 'changed' | 'unknown';
}

export interface EvaluateVerifyCommitReadinessInput {
    readonly checksLoading: boolean;
    readonly running: boolean;
    readonly results: readonly VerifyCommitCheckSnapshot[];
}

export interface VerifyCommitReadiness {
    readonly level: VerifyCommitReadinessLevel;
    readonly requiresConfirmation: boolean;
    readonly blocksCommit: boolean;
}

/** Conservative: unknown or changed files never count as current evidence. */
export function evaluateVerifyCommitReadiness(
    input: EvaluateVerifyCommitReadinessInput,
): VerifyCommitReadiness {
    if (input.checksLoading) {
        return { level: 'loading', requiresConfirmation: false, blocksCommit: true };
    }
    if (input.running || input.results.some(result => result.state === 'running' || result.state === 'checking')) {
        return { level: 'running', requiresConfirmation: false, blocksCommit: true };
    }
    if (input.results.length === 0) {
        return { level: 'not_configured', requiresConfirmation: false, blocksCommit: false };
    }
    if (input.results.some(result => result.state === 'fail')) {
        return { level: 'failing', requiresConfirmation: true, blocksCommit: false };
    }
    if (input.results.some(result => result.state === 'idle')) {
        return { level: 'missing', requiresConfirmation: true, blocksCommit: false };
    }
    if (input.results.every(result => result.state === 'ok' && result.workspaceSnapshot === 'current')) {
        return { level: 'ready', requiresConfirmation: false, blocksCommit: false };
    }
    return { level: 'stale', requiresConfirmation: true, blocksCommit: false };
}

export function localizeVerifyCommitReadiness(level: VerifyCommitReadinessLevel): string {
    switch (level) {
        case 'ready':
            return nls.localize('qaap/verify/commitReady', 'Checks match the current files');
        case 'running':
            return nls.localize('qaap/verify/commitRunning', 'Checks are still running. Wait for them to finish.');
        case 'loading':
            return nls.localize('qaap/verify/commitLoading', 'Checks are still loading.');
        case 'not_configured':
            return nls.localize('qaap/mobileProjects/checksNotConfigured', 'No automated checks configured');
        case 'missing':
            return nls.localize('qaap/verify/commitMissing', 'Checks have not been run for these changes.');
        case 'stale':
            return nls.localize('qaap/verify/changedFiles', 'Files changed — run checks again');
        case 'failing':
            return nls.localize(
                'qaap/verify/commitFailing',
                'Checks are failing. The result does not support this commit.',
            );
    }
}

export function invalidateVerifyWorkspaceSnapshots(
    results: Array<{ workspaceSnapshot?: 'current' | 'changed' | 'unknown' }>,
): void {
    for (const result of results) {
        result.workspaceSnapshot = 'unknown';
    }
}
