// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Inputs every JSONL session parser needs besides the lines themselves. */
export interface QaapExternalJsonlParseOptions {
    /** The file name without extension; used when the log carries no session id. */
    readonly fallbackSessionId: string;
    /** The file's modification time; used when the log carries no usable timestamp. */
    readonly fallbackTimestampMs: number;
    /** Listing: build the header only and skip the messages (`messages: []`). */
    readonly headerOnly?: boolean;
}
