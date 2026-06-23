// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Same-tab skip — tutorial must not re-open after Skip until a new browser tab. */
export const MOBILE_ONBOARDING_SESSION_SKIP_KEY = 'qaap.mobile.tutorial.skippedSession';

export function isMobileOnboardingSessionSkipped(): boolean {
    if (typeof sessionStorage === 'undefined') {
        return false;
    }
    try {
        return sessionStorage.getItem(MOBILE_ONBOARDING_SESSION_SKIP_KEY) === '1';
    } catch {
        return false;
    }
}

export function markMobileOnboardingSessionSkipped(): void {
    if (typeof sessionStorage === 'undefined') {
        return;
    }
    try {
        sessionStorage.setItem(MOBILE_ONBOARDING_SESSION_SKIP_KEY, '1');
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
    const transcriptSurface = root.querySelector(
        '.theia-mobile-agent-transcript-root.theia-mod-visible, .theia-mobile-projects.theia-mod-agents-hub-inline-active.theia-mod-visible',
    );
    if (!transcriptSurface) {
        return false;
    }
    if (root.querySelector('.theia-mod-turn-failure, .theia-mobile-agent-turn-failure-message')) {
        return true;
    }
    if (root.querySelector('.theia-mobile-projects-active-chat-chip.theia-mod-failed')) {
        return true;
    }
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
    if (root.querySelector('.theia-mobile-projects-row-glyph.theia-mod-running, .theia-mobile-projects-row-glyph.theia-mod-failed')) {
        return true;
    }
    return false;
}

/** True when any workspace has a streaming or failed agent conversation (API snapshot). */
export async function hasBlockingAgentConversationWork(): Promise<boolean> {
    if (typeof fetch === 'undefined') {
        return false;
    }
    try {
        const response = await fetch('/qaap/api/agent-conversations/all', {
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
                if (conversation.status === 'streaming' || conversation.status === 'failed') {
                    return true;
                }
            }
        }
        return false;
    } catch {
        return false;
    }
}
