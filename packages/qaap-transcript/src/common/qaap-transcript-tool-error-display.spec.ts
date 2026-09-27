// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    normalizeTranscriptToolErrorRaw,
    resolveTranscriptToolErrorDisplay,
} from './qaap-transcript-tool-error-display';

describe('qaap-transcript-tool-error-display', () => {

    it('strips tool_use_error wrappers and parses validation errors', () => {
        const raw = '<tool_use_error>InputValidationError: TodoWrite failed due to the following issue:\nThe `merge` field is required.';
        expect(normalizeTranscriptToolErrorRaw(raw)).to.equal(
            'InputValidationError: TodoWrite failed due to the following issue:\nThe `merge` field is required.',
        );
        const display = resolveTranscriptToolErrorDisplay(raw);
        expect(display?.code).to.equal('InputValidationError');
        expect(display?.preview).to.equal('TodoWrite failed due to the following issue:');
        expect(display?.message).to.include('merge');
        expect(display?.fixHint).to.include('merge');
    });

    it('returns undefined for empty payloads', () => {
        expect(resolveTranscriptToolErrorDisplay(undefined)).to.equal(undefined);
        expect(resolveTranscriptToolErrorDisplay('   ')).to.equal(undefined);
    });
});
