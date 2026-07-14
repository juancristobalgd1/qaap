// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapDevPreviewProbeResponse } from '../common/qaap-dev-preview';
import type { QaapBootstrapPhase } from './qaap-project-bootstrap-types';
import { extractDevPreviewPortFromUrl } from './qaap-transcript-preview-bootstrap';

export interface ComposerPreviewRuntime {
    readonly projectId: string;
    readonly projectCwd?: string;
    readonly bootstrapRoot?: string;
    readonly dependenciesInstalled: boolean;
    readonly phase: QaapBootstrapPhase;
    readonly previewUrl?: string;
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Returns the bootstrap URL only when it belongs to this project and is ready to be health-checked. */
export function resolveComposerPreviewCandidate(runtime: ComposerPreviewRuntime): string | undefined {
    if (!runtime.dependenciesInstalled || runtime.phase !== 'running' || !runtime.previewUrl
        || !runtime.projectCwd || !runtime.bootstrapRoot
        || normalizePath(runtime.projectCwd) !== normalizePath(runtime.bootstrapRoot)) {
        return undefined;
    }
    return extractDevPreviewPortFromUrl(runtime.previewUrl) === undefined ? undefined : runtime.previewUrl;
}

/** Keeps rendering synchronous while requiring a recent successful backend probe. */
export function resolveVerifiedComposerPreviewUrl(
    runtime: ComposerPreviewRuntime,
    verifiedUrl: string | undefined,
): string | undefined {
    const candidate = resolveComposerPreviewCandidate(runtime);
    if (!candidate || !verifiedUrl
        || extractDevPreviewPortFromUrl(candidate) !== extractDevPreviewPortFromUrl(verifiedUrl)) {
        return undefined;
    }
    return verifiedUrl;
}

/**
 * Re-resolves the active project before and after the backend probe. This prevents a click queued
 * during a project switch from opening another project's server or a URL that just went stale.
 */
export async function openCurrentComposerPreview(
    expectedProjectId: string,
    resolveRuntime: () => ComposerPreviewRuntime | undefined,
    probe: (port: number) => Promise<QaapDevPreviewProbeResponse>,
    open: (previewUrl: string) => Promise<boolean>,
): Promise<boolean> {
    const before = resolveRuntime();
    if (!before || before.projectId !== expectedProjectId) {
        return false;
    }
    const candidate = resolveComposerPreviewCandidate(before);
    const port = extractDevPreviewPortFromUrl(candidate);
    if (!candidate || port === undefined) {
        return false;
    }
    const result = await probe(port);
    if (!result.ready || extractDevPreviewPortFromUrl(result.previewUrl) !== port) {
        return false;
    }
    const after = resolveRuntime();
    if (!after || after.projectId !== expectedProjectId
        || extractDevPreviewPortFromUrl(resolveComposerPreviewCandidate(after)) !== port) {
        return false;
    }
    return open(result.previewUrl);
}
