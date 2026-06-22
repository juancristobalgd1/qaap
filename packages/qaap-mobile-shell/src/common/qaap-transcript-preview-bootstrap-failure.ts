// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapBootstrapPhase } from '../browser/qaap-project-bootstrap-types';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';
import {
    formatBootstrapScaffoldDetectedNotice,
    formatMissingBootstrapProjectHint,
} from './qaap-project-bootstrap-scaffold-plan';

/** Minimal bootstrap snapshot for preview failure diagnostics (avoids browser service import). */
export interface TranscriptPreviewBootstrapSnapshot {
    readonly phase: QaapBootstrapPhase;
    readonly previewUrl?: string;
    readonly error?: string;
    readonly missingDescriptorHint?: string;
    readonly previewRoot?: string;
    readonly scaffoldRelativePath?: string;
    readonly descriptor?: { readonly nodeModulesPresent?: boolean };
}

/** Max preview poll misses after settle before we treat bootstrap as failed. */
export const TRANSCRIPT_PREVIEW_BOOTSTRAP_FAILURE_MAX_POLLS = 8;

export function buildTranscriptPreviewBootstrapFailureReason(
    snapshot: TranscriptPreviewBootstrapSnapshot,
    candidatePaths: readonly string[] = [],
): string | undefined {
    const previewRoot = snapshot.previewRoot ?? snapshot.scaffoldRelativePath;
    if (snapshot.previewUrl && snapshot.phase === 'running') {
        return undefined;
    }
    if (snapshot.phase === 'run-failed') {
        const base = snapshot.error?.trim()
            || snapshot.missingDescriptorHint
            || 'Dev preview failed to start.';
        const withRoot = previewRoot && /package\.json|ENOENT|no such file|cannot find module/i.test(base)
            ? `${base} Suggested fix: run preview from ${previewRoot}/ (not the workspace root).`
            : base;
        return `${withRoot} Try Run & Preview again or open the project folder that contains package.json.`;
    }
    if (snapshot.phase === 'install-failed') {
        const base = snapshot.error?.trim() || 'Dependency install failed before preview could start.';
        return `${base} Fix install errors, then retry preview.`;
    }
    if (!snapshot.descriptor) {
        return snapshot.missingDescriptorHint
            ?? formatMissingBootstrapProjectHint(candidatePaths);
    }
    if (snapshot.phase === 'idle' && snapshot.descriptor && !snapshot.descriptor.nodeModulesPresent) {
        return 'Dependencies are not installed yet. Run Install, then retry preview.';
    }
    return undefined;
}

export function shouldReportTranscriptPreviewBootstrapFailure(
    snapshot: TranscriptPreviewBootstrapSnapshot,
    pollMisses: number,
): boolean {
    if (snapshot.previewUrl && snapshot.phase === 'running') {
        return false;
    }
    if (snapshot.phase === 'run-failed' || snapshot.phase === 'install-failed') {
        return true;
    }
    if (!snapshot.descriptor
        && snapshot.phase !== 'installing'
        && snapshot.phase !== 'starting'
        && (snapshot.missingDescriptorHint || pollMisses >= TRANSCRIPT_PREVIEW_BOOTSTRAP_FAILURE_MAX_POLLS)) {
        return true;
    }
    return pollMisses >= TRANSCRIPT_PREVIEW_BOOTSTRAP_FAILURE_MAX_POLLS
        && snapshot.phase !== 'installing'
        && snapshot.phase !== 'starting';
}

export function toTranscriptPreviewBootstrapSnapshot(state: {
    readonly phase: QaapBootstrapPhase;
    readonly previewUrl?: string;
    readonly error?: string;
    readonly missingDescriptorHint?: string;
    readonly selectedApp?: { readonly relativePath: string };
    readonly descriptor?: { readonly scaffoldRelativePath?: string; readonly nodeModulesPresent?: boolean };
}): TranscriptPreviewBootstrapSnapshot {
    const previewRoot = state.selectedApp?.relativePath ?? state.descriptor?.scaffoldRelativePath;
    return {
        phase: state.phase,
        previewUrl: state.previewUrl,
        error: state.error,
        missingDescriptorHint: state.missingDescriptorHint,
        previewRoot,
        scaffoldRelativePath: state.descriptor?.scaffoldRelativePath,
        descriptor: state.descriptor
            ? { nodeModulesPresent: state.descriptor.nodeModulesPresent }
            : undefined,
    };
}

/** Live bootstrap diagnostics for the transcript activity timeline (preview cwd transparency). */
export function resolveTranscriptBootstrapDiagnosticActivityItems(
    snapshot: TranscriptPreviewBootstrapSnapshot | undefined,
): TranscriptActivityNavigationItem[] {
    if (!snapshot) {
        return [];
    }
    const items: TranscriptActivityNavigationItem[] = [];
    const previewRoot = snapshot.previewRoot ?? snapshot.scaffoldRelativePath;
    if (previewRoot) {
        items.push({
            label: formatBootstrapScaffoldDetectedNotice(previewRoot),
            state: 'success',
            verb: 'Preview',
        });
    }
    if (snapshot.missingDescriptorHint) {
        items.push({
            label: snapshot.missingDescriptorHint,
            state: 'error',
        });
        return items;
    }
    if (snapshot.phase === 'run-failed' || snapshot.phase === 'install-failed') {
        const reason = buildTranscriptPreviewBootstrapFailureReason(snapshot);
        if (reason) {
            items.push({
                label: reason,
                state: 'error',
            });
        }
    }
    return items;
}
