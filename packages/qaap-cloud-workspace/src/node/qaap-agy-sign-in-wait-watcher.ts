// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * agy's own lines when it starts an interactive Google sign-in instead of the turn (agy 1.5.9):
 * "Authentication required. Please visit the URL to log in:" and "Waiting for authentication (timeout 60s)...".
 * With the prompt on argv (`agy -p '<text>'`) it then waits up to 60 s for a pasted code, even with a closed stdin.
 */
const AGY_SIGN_IN_WAIT_PATTERNS: readonly RegExp[] = [
    /\bauthentication\s+required\.\s+please\s+visit\s+the\s+url\s+to\s+log\s+in\b/i,
    /\bwaiting\s+for\s+authentication\s+\(timeout\s+\d+s\)/i,
];

/** Output kept between chunks, so a line split across two chunks still matches. */
const AGY_SIGN_IN_WAIT_TAIL_CHARS = 512;

/** Reads agy's output as it streams and reports, once, that agy is waiting for a sign-in. */
export interface QaapAgySignInWaitWatcher {
    /** True exactly once: on the chunk that completes agy's sign-in wait line. */
    push(text: string): boolean;
}

/**
 * The pre-spawn guard only lets agy run with a confirmed session, but a session can expire between the
 * probe and the turn. Then agy would hold the turn for 60 s waiting for a code nobody can paste; the
 * runner stops it on the first sign-in wait line instead, and the turn fails as a sign-in failure
 * (the classifier already reads agy's "Authentication required" lines as auth).
 */
export function createAgySignInWaitWatcher(): QaapAgySignInWaitWatcher {
    let tail = '';
    let fired = false;
    return {
        push(text: string): boolean {
            if (fired) {
                return false;
            }
            const sample = tail + text;
            tail = sample.slice(-AGY_SIGN_IN_WAIT_TAIL_CHARS);
            fired = AGY_SIGN_IN_WAIT_PATTERNS.some(pattern => pattern.test(sample));
            return fired;
        },
    };
}
