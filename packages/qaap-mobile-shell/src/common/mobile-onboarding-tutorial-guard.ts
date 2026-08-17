// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** The two mobile onboarding tours: the Work Hub / Agents surface and the classic IDE surface. */
export type MobileOnboardingSurface = 'work-hub' | 'ide';

/** Same-tab skip — tutorial must not re-open after Skip until a new browser tab. */
export const MOBILE_ONBOARDING_SESSION_SKIP_KEY = 'qaap.mobile.tutorial.skippedSession';

function sessionSkipKey(surface: MobileOnboardingSurface): string {
    // Work Hub keeps the pre-split key so an already-skipped session stays skipped.
    return surface === 'ide' ? `${MOBILE_ONBOARDING_SESSION_SKIP_KEY}.ide` : MOBILE_ONBOARDING_SESSION_SKIP_KEY;
}

export function isMobileOnboardingSessionSkipped(surface: MobileOnboardingSurface = 'work-hub'): boolean {
    if (typeof sessionStorage === 'undefined') {
        return false;
    }
    try {
        return sessionStorage.getItem(sessionSkipKey(surface)) === '1';
    } catch {
        return false;
    }
}

export function markMobileOnboardingSessionSkipped(surface: MobileOnboardingSurface = 'work-hub'): void {
    if (typeof sessionStorage === 'undefined') {
        return;
    }
    try {
        sessionStorage.setItem(sessionSkipKey(surface), '1');
    } catch {
        /* ignore quota / private mode */
    }
}

/**
 * True while an active agent transcript (streaming or failed) should block the first-run tutorial.
 * DOM-only so the tutorial module does not depend on the projects panel DI graph.
 */
export function shouldDeferMobileOnboardingTutorial(root: ParentNode = document): boolean {
    if (typeof document === 'undefined') {
        return false;
    }
    // An open transcript is never first-run onboarding (QA-006): coach-marks must not cover
    // a failed or in-progress task.
    if (root.querySelector('.theia-mobile-agent-transcript-root.theia-mod-visible')) {
        return true;
    }
    const transcriptSurface = root.querySelector(
        '.theia-mobile-projects.theia-mod-agents-hub-inline-active.theia-mod-visible',
    );
    if (!transcriptSurface) {
        return false;
    }
    // In-view failure banner: the user is actively looking at a failed turn.
    if (root.querySelector('.theia-mod-turn-failure, .theia-mobile-agent-turn-failure-message')) {
        return true;
    }
    // NOTE: persistent "failed" state markers (failed chat chips / failed session row glyphs) are
    // deliberately NOT blocking — old failed sessions live in the hub indefinitely and would
    // otherwise defer the tutorial forever. Only transient RUNNING/streaming markers defer.
    if (root.querySelector('.theia-mobile-projects-active-chat-chip.theia-mod-running')) {
        return true;
    }
    if (root.querySelector('.theia-mobile-agent-transcript-msg.theia-mod-streaming')) {
        return true;
    }
    if (root.querySelector('.theia-mobile-projects-sticky-composer-send.theia-mod-stop')) {
        return true;
    }
    if (root.querySelector('.theia-mobile-sticky-composer-activity-section.theia-mod-streaming')) {
        return true;
    }
    if (root.querySelector('.theia-mobile-projects-row-glyph.theia-mod-running')) {
        return true;
    }
    return false;
}

/**
 * True when the user has ANY agent conversation on record (any status, any workspace).
 *
 * The first-run tutorial is product onboarding: if the user already has agent conversation
 * history, they are not new and the coach-marks should not appear. Used to both suppress the
 * tutorial before it opens and to dismiss it if a conversation is created while it is open —
 * a race-free signal (a conversation, once created, keeps existing), unlike the transient
 * `streaming` state which a fast turn can slip through between polls.
 */
export async function hasAnyAgentConversationWork(): Promise<boolean> {
    if (typeof fetch === 'undefined') {
        return false;
    }
    try {
        const response = await fetch('/qaap/api/agent-conversations/all?peek=1', {
            credentials: 'include',
            cache: 'no-store',
        });
        if (!response.ok) {
            return false;
        }
        const body = await response.json() as {
            readonly groups?: ReadonlyArray<{
                readonly streamingCount?: number;
                /** Peek mode: count without payloads. */
                readonly conversationCount?: number;
                /** Full payload fallback (older servers / tests). */
                readonly conversations?: ReadonlyArray<unknown>;
            }>;
        };
        for (const group of body.groups ?? []) {
            const count = group.conversationCount ?? group.conversations?.length ?? 0;
            if (count > 0 || (group.streamingCount ?? 0) > 0) {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * True when any workspace has a STREAMING agent conversation (API snapshot).
 *
 * Deliberately ignores `failed` conversations: they persist indefinitely, and treating them as
 * blocking meant a workspace with any old failed session could never show (or kept flashing)
 * the tutorial. Visible failure banners are still deferred via the DOM check above.
 */
export async function hasBlockingAgentConversationWork(): Promise<boolean> {
    if (typeof fetch === 'undefined') {
        return false;
    }
    try {
        const response = await fetch('/qaap/api/agent-conversations/all?peek=1', {
            credentials: 'include',
            cache: 'no-store',
        });
        if (!response.ok) {
            return false;
        }
        const body = await response.json() as {
            readonly groups?: ReadonlyArray<{
                readonly streamingCount?: number;
                readonly conversations?: ReadonlyArray<{ readonly status?: string }>;
            }>;
        };
        for (const group of body.groups ?? []) {
            if ((group.streamingCount ?? 0) > 0) {
                return true;
            }
            for (const conversation of group.conversations ?? []) {
                if (conversation.status === 'streaming') {
                    return true;
                }
            }
        }
        return false;
    } catch {
        return false;
    }
}
