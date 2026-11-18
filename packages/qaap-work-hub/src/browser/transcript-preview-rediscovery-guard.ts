// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Rediscoveries a project may run back to back before the backed-off tab probe takes over. */
export const TRANSCRIPT_PREVIEW_REDISCOVERY_MAX = 3;
export const TRANSCRIPT_PREVIEW_REDISCOVERY_WINDOW_MS = 10_000;

/**
 * Bounds the "preview does not match → forget it → rediscover" cycle. A stale port the agent
 * mentioned in the transcript (e.g. a test server on :3099) is rediscovered every time, fails the
 * match again and loops with no delay: hundreds of requests a second until the renderer ran out of
 * memory and the window died.
 */
export class TranscriptPreviewRediscoveryGuard {
    protected readonly attemptsByProject = new Map<string, number[]>();

    allow(projectId: string, now: number): boolean {
        const recent = (this.attemptsByProject.get(projectId) ?? [])
            .filter(at => now - at < TRANSCRIPT_PREVIEW_REDISCOVERY_WINDOW_MS);
        if (recent.length >= TRANSCRIPT_PREVIEW_REDISCOVERY_MAX) {
            this.attemptsByProject.set(projectId, recent);
            return false;
        }
        recent.push(now);
        this.attemptsByProject.set(projectId, recent);
        return true;
    }

    /** A preview mounted for the project: the next mismatch starts a fresh budget. */
    reset(projectId: string): void {
        this.attemptsByProject.delete(projectId);
    }
}

const guards = new WeakMap<object, TranscriptPreviewRediscoveryGuard>();

/** The guard of one Work Hub transcript host (each window / test host gets its own budget). */
export function transcriptPreviewRediscoveryGuardFor(owner: object): TranscriptPreviewRediscoveryGuard {
    let guard = guards.get(owner);
    if (!guard) {
        guard = new TranscriptPreviewRediscoveryGuard();
        guards.set(owner, guard);
    }
    return guard;
}
