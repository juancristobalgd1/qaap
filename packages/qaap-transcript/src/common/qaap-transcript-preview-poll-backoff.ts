// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Consecutive "nothing new" answers of the transcript preview-offer poll, which drive its backoff.
 *
 * A probe that finds the same ready URL the transcript already opened is not progress: it used to
 * reset the poll to its 900 ms base, so for the whole settle window after a turn or Run app the
 * Work Hub swept every port the transcript mentions about once a second. Only a newly ready URL
 * resets the backoff; events (turn end, Run app, a sent message) reset it explicitly.
 */
export function nextTranscriptPreviewPollMisses(
    previousMisses: number,
    readyUrl: string | undefined,
    alreadyOpenedUrl: string | undefined,
): number {
    if (readyUrl && readyUrl !== alreadyOpenedUrl) {
        return 0;
    }
    return previousMisses + 1;
}
