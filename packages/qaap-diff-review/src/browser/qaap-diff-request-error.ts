// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** A diff endpoint answered with a non-2xx status; the status drives the user-facing sentence. */
export class QaapDiffRequestError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'QaapDiffRequestError';
    }
}
