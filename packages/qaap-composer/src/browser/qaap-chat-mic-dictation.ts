// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Pure helpers for browser SpeechRecognition → composer draft.
 * Keeps mobile auto-restart from folding interim/final text into the baseline
 * and then re-appending the same phrase (duplicated transcriptions).
 */

import { nls } from '@theia/core/lib/common/nls';

/** Same copy as the preview annotation mic — Chrome / Edge only. */
export function qaapChatMicUnavailableMessage(): string {
    return nls.localize(
        'qaap/preview/annotationMicUnavailable',
        'Voice dictation is not available in this browser.',
    );
}

export interface SpeechRecognitionResultLike {
    readonly isFinal?: boolean;
    readonly length?: number;
    readonly [index: number]: { readonly transcript?: string } | undefined;
}

export function trailingSpaceForDictationBaseline(baseline: string): string {
    return baseline.length > 0 && !/\s$/.test(baseline) ? ' ' : '';
}

export interface SplitSpeechRecognitionOptions {
    /**
     * Android Chrome with `continuous = true` re-sends the whole utterance so far in every new
     * result ("hola", "hola cómo estás") instead of only the new words. Concatenating those
     * results duplicates the transcript ("holahola cómo estás"), so collapse them instead.
     */
    readonly collapseCumulativeResults?: boolean;
}

export function splitSpeechRecognitionTranscript(
    results: ArrayLike<SpeechRecognitionResultLike>,
    options: SplitSpeechRecognitionOptions = {},
): { readonly finals: string; readonly interim: string } {
    if (options.collapseCumulativeResults) {
        return splitCumulativeSpeechRecognitionTranscript(results);
    }
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

function splitCumulativeSpeechRecognitionTranscript(
    results: ArrayLike<SpeechRecognitionResultLike>,
): { readonly finals: string; readonly interim: string } {
    let merged = '';
    let finals = '';
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        merged = mergeCumulativeSpeechSegment(merged, result?.[0]?.transcript ?? '');
        if (result?.isFinal) {
            finals = merged;
        }
    }
    return { finals, interim: merged.slice(finals.length) };
}

function speechComparisonWords(text: string): string[] {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).map(word => word.toLocaleLowerCase().replace(/[.,;:!?¡¿…"'()]+/g, '')) : [];
}

/**
 * Appends one SpeechRecognition result to the text accumulated so far. When the segment repeats
 * the accumulated words as a prefix (Android's cumulative results) only its new tail is added;
 * otherwise the segment is appended as new speech, always separated by a single space. The result
 * always starts with `accumulated`, so final text stays a stable prefix of the interim text.
 */
export function mergeCumulativeSpeechSegment(accumulated: string, segment: string): string {
    const segmentWords = speechComparisonWords(segment);
    if (segmentWords.length === 0) {
        return accumulated;
    }
    const accumulatedWords = speechComparisonWords(accumulated);
    if (accumulatedWords.length === 0) {
        return segment.trim();
    }
    const isCumulative = accumulatedWords.length <= segmentWords.length
        && accumulatedWords.every((word, index) => word === segmentWords[index]);
    if (isCumulative) {
        const tail = segment.trim().split(/\s+/).slice(accumulatedWords.length).join(' ');
        return tail ? `${accumulated.trimEnd()} ${tail}` : accumulated;
    }
    return `${accumulated.trimEnd()} ${segment.trim()}`;
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
