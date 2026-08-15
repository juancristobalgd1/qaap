// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Pure helpers for browser SpeechRecognition → composer draft.
 * Keeps mobile auto-restart from folding interim/final text into the baseline
 * and then re-appending the same phrase (duplicated transcriptions).
 */

export interface SpeechRecognitionResultLike {
    readonly isFinal?: boolean;
    readonly length?: number;
    readonly [index: number]: { readonly transcript?: string } | undefined;
}

export function trailingSpaceForDictationBaseline(baseline: string): string {
    return baseline.length > 0 && !/\s$/.test(baseline) ? ' ' : '';
}

export function splitSpeechRecognitionTranscript(
    results: ArrayLike<SpeechRecognitionResultLike>,
): { readonly finals: string; readonly interim: string } {
    let finals = '';
    let interim = '';
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const text = result?.[0]?.transcript ?? '';
        if (result?.isFinal) {
            finals += text;
        } else {
            interim += text;
        }
    }
    return { finals, interim };
}

export function advanceDictationBaseline(
    baseline: string,
    trailingSpace: string,
    sessionFinals: string,
): { readonly baseline: string; readonly trailingSpace: string } {
    if (!sessionFinals) {
        return { baseline, trailingSpace };
    }
    const nextBaseline = baseline + trailingSpace + sessionFinals;
    return {
        baseline: nextBaseline,
        trailingSpace: trailingSpaceForDictationBaseline(nextBaseline),
    };
}

export function composeDictationFieldValue(
    baseline: string,
    trailingSpace: string,
    sessionFinals: string,
    sessionInterim: string,
): string {
    return baseline + trailingSpace + sessionFinals + sessionInterim;
}

/**
 * Mobile SpeechRecognition often ends mid-utterance with only interim text.
 * Repainting finals-only then would wipe that interim and make dictation look dead
 * until the next result. Only clear interim when finals were actually committed.
 */
export function shouldClearInterimOnRecognitionRestart(sessionFinals: string): boolean {
    return sessionFinals.length > 0;
}

/**
 * After a mobile onend restart, Chrome/WebKit sometimes re-emits the phrase that
 * was just committed into the baseline. Drop that pure re-emit (and strip it when
 * it is only a prefix of new speech).
 */
export function normalizeRestartedDictationSession(
    sessionText: string,
    lastCommittedFinals: string,
): string {
    if (!lastCommittedFinals || !sessionText) {
        return sessionText;
    }
    const last = lastCommittedFinals.trim();
    const sessionTrimmed = sessionText.trim();
    if (!last) {
        return sessionText;
    }
    if (sessionTrimmed === last) {
        return '';
    }
    if (sessionText.startsWith(lastCommittedFinals)) {
        return sessionText.slice(lastCommittedFinals.length).replace(/^\s+/, '');
    }
    if (sessionTrimmed.startsWith(last)) {
        return sessionTrimmed.slice(last.length).replace(/^\s+/, '');
    }
    return sessionText;
}
