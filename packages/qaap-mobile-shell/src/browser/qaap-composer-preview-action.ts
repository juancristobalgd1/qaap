// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { parseQaapIdentityPreviewRequestPath, type QaapDevPreviewProbeResponse } from '../common/qaap-dev-preview';
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

/** What the composer must probe to verify a preview URL: a process identity or a legacy port. */
export interface ComposerPreviewTarget {
    readonly previewId?: string;
    readonly port?: number;
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Identity or port carried by a preview URL. Identity URLs (`/qaap-preview/<id>/`) have NO port —
 * treating "no port" as "not previewable" silently disabled the whole Open-preview pill for
 * identity-proxied apps.
 */
export function resolveComposerPreviewTarget(url: string | undefined, origin?: string): ComposerPreviewTarget | undefined {
    if (!url) {
        return undefined;
    }
    const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : undefined);
    try {
        const parsed = new URL(url, base);
        const identity = parseQaapIdentityPreviewRequestPath(parsed.pathname);
        if (identity?.previewId) {
            return { previewId: identity.previewId };
        }
    } catch {
        // fall through to the port extraction below
    }
    const port = extractDevPreviewPortFromUrl(url);
    return port !== undefined ? { port } : undefined;
}

function sameComposerPreviewTarget(a: ComposerPreviewTarget | undefined, b: ComposerPreviewTarget | undefined): boolean {
    if (!a || !b) {
        return false;
    }
    if (a.previewId !== undefined || b.previewId !== undefined) {
        return a.previewId !== undefined && a.previewId === b.previewId;
    }
    return a.port !== undefined && a.port === b.port;
}

/** Returns the bootstrap URL only when it belongs to this project and is ready to be health-checked. */
export function resolveComposerPreviewCandidate(runtime: ComposerPreviewRuntime, origin?: string): string | undefined {
    if (!runtime.dependenciesInstalled || runtime.phase !== 'running' || !runtime.previewUrl
        || !runtime.projectCwd || !runtime.bootstrapRoot
        || normalizePath(runtime.projectCwd) !== normalizePath(runtime.bootstrapRoot)) {
        return undefined;
    }
    return resolveComposerPreviewTarget(runtime.previewUrl, origin) === undefined ? undefined : runtime.previewUrl;
}

/** Keeps rendering synchronous while requiring a recent successful backend probe. */
export function resolveVerifiedComposerPreviewUrl(
    runtime: ComposerPreviewRuntime,
    verifiedUrl: string | undefined,
    origin?: string,
): string | undefined {
    const candidate = resolveComposerPreviewCandidate(runtime, origin);
    if (!candidate || !verifiedUrl) {
        return undefined;
    }
    const candidateTarget = resolveComposerPreviewTarget(candidate, origin);
    const verifiedTarget = resolveComposerPreviewTarget(verifiedUrl, origin);
    if (!sameComposerPreviewTarget(candidateTarget, verifiedTarget)) {
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
    probe: (target: ComposerPreviewTarget) => Promise<QaapDevPreviewProbeResponse>,
    open: (previewUrl: string) => Promise<boolean>,
    origin?: string,
): Promise<boolean> {
    const before = resolveRuntime();
    if (!before || before.projectId !== expectedProjectId) {
        return false;
    }
    const candidate = resolveComposerPreviewCandidate(before, origin);
    const target = resolveComposerPreviewTarget(candidate, origin);
    if (!candidate || !target) {
        return false;
    }
    const result = await probe(target);
    if (!result.ready) {
        return false;
    }
    // Note: probing a legacy port legitimately answers with the canonical IDENTITY URL of the
    // record bound to that port — the backend scopes the response to the requested target and to
    // the caller's ownership, so the returned URL is authoritative, not a mismatch.
    const after = resolveRuntime();
    const afterTarget = resolveComposerPreviewTarget(resolveComposerPreviewCandidate(after ?? before, origin), origin);
    const resultTarget = resolveComposerPreviewTarget(result.previewUrl, origin);
    if (!after || after.projectId !== expectedProjectId
        || !(sameComposerPreviewTarget(afterTarget, target) || sameComposerPreviewTarget(afterTarget, resultTarget))) {
        return false;
    }
    return open(result.previewUrl);
}
