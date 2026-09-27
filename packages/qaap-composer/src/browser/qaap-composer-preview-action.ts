// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { parseQaapIdentityPreviewRequestPath, type QaapDevPreviewProbeResponse } from '@theia/qaap-shared-core/lib/common/qaap-dev-preview';
import type { QaapBootstrapPhase } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-types';
import { extractDevPreviewPortFromUrl } from '@theia/qaap-shared-core/lib/browser/qaap-transcript-preview-bootstrap';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    conversationEverRequestedDevPreview,
    conversationHasActiveDevServerRun,
    findTranscriptPreviewUrlFromConversation,
} from '@theia/qaap-shared-core/lib/common/qaap-transcript-preview-offer';

export interface ComposerPreviewRuntime {
    readonly projectId: string;
    readonly projectCwd?: string;
    readonly bootstrapRoot?: string;
    readonly dependenciesInstalled: boolean;
    readonly phase: QaapBootstrapPhase;
    readonly previewUrl?: string;
    /**
     * Previews that exist although the Run flow (bootstrap) never reached `running` — most notably a
     * dev server the agent started from its own shell. In precedence order: the URL the transcript
     * already adopted for this project, then the one the conversation announced
     * (`http://localhost:5173` → `/qaap-dev/5173/`). Only ever shown after a backend probe verified it.
     */
    readonly fallbackPreviewUrls?: readonly string[];
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

/**
 * The preview to health-check for this project: the Run flow's URL when it belongs to this project
 * and is running, otherwise the first previewable {@link ComposerPreviewRuntime.fallbackPreviewUrls}.
 */
export function resolveComposerPreviewCandidate(runtime: ComposerPreviewRuntime, origin?: string): string | undefined {
    if (runtime.dependenciesInstalled && runtime.phase === 'running' && runtime.previewUrl
        && runtime.projectCwd && runtime.bootstrapRoot
        && normalizePath(runtime.projectCwd) === normalizePath(runtime.bootstrapRoot)
        && resolveComposerPreviewTarget(runtime.previewUrl, origin) !== undefined) {
        return runtime.previewUrl;
    }
    for (const fallback of runtime.fallbackPreviewUrls ?? []) {
        if (fallback && resolveComposerPreviewTarget(fallback, origin) !== undefined) {
            return fallback;
        }
    }
    return undefined;
}

/**
 * Keeps rendering synchronous while requiring a recent successful backend probe.
 * `verifiedCandidate` is the candidate that probe was made for: probing a legacy port answers with
 * the canonical identity URL of the claim bound to it, which is still a verification of that port.
 */
export function resolveVerifiedComposerPreviewUrl(
    runtime: ComposerPreviewRuntime,
    verifiedUrl: string | undefined,
    origin?: string,
    verifiedCandidate?: string,
): string | undefined {
    const candidate = resolveComposerPreviewCandidate(runtime, origin);
    if (!candidate || !verifiedUrl) {
        return undefined;
    }
    if (verifiedCandidate !== undefined && verifiedCandidate === candidate) {
        return verifiedUrl;
    }
    const candidateTarget = resolveComposerPreviewTarget(candidate, origin);
    const verifiedTarget = resolveComposerPreviewTarget(verifiedUrl, origin);
    if (!sameComposerPreviewTarget(candidateTarget, verifiedTarget)) {
        return undefined;
    }
    return verifiedUrl;
}

/**
 * Preview URLs a conversation itself vouches for (see {@link ComposerPreviewRuntime.fallbackPreviewUrls}).
 * `adoptedProjectPreviewUrl` is only trusted when the conversation is about running the app, so a
 * stale URL from an older session never resurrects the pill in an unrelated conversation.
 */
export function resolveComposerFallbackPreviewUrls(
    conv: QaapAgentConversationDTO | undefined,
    adoptedProjectPreviewUrl: string | undefined,
    origin?: string,
): string[] {
    if (!composerConversationInvolvesPreview(conv, origin)) {
        return [];
    }
    const urls: string[] = [];
    if (adoptedProjectPreviewUrl) {
        urls.push(adoptedProjectPreviewUrl);
    }
    const announced = conv ? findTranscriptPreviewUrlFromConversation(conv, origin) : undefined;
    if (announced && !urls.includes(announced)) {
        urls.push(announced);
    }
    return urls;
}

/**
 * True when this conversation asked to run/preview the app, is running a dev server, or announced a
 * local dev URL. Such a conversation shows its verified preview even when the agent edited nothing.
 */
export function composerConversationInvolvesPreview(conv: QaapAgentConversationDTO | undefined, origin?: string): boolean {
    if (!conv) {
        return false;
    }
    return conversationEverRequestedDevPreview(conv)
        || conversationHasActiveDevServerRun(conv)
        || findTranscriptPreviewUrlFromConversation(conv, origin) !== undefined;
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
