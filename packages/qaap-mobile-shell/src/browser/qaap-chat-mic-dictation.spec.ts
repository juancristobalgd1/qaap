// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    advanceDictationBaseline,
    composeDictationFieldValue,
    normalizeRestartedDictationSession,
    qaapChatMicUnavailableMessage,
    shouldClearInterimOnRecognitionRestart,
    splitSpeechRecognitionTranscript,
    trailingSpaceForDictationBaseline,
} from './qaap-chat-mic-dictation';

describe('qaap-chat-mic-dictation', () => {
    it('splits final vs interim results', () => {
        const split = splitSpeechRecognitionTranscript([
            { isFinal: true, 0: { transcript: 'hello ' } },
            { isFinal: false, 0: { transcript: 'wor' } },
        ]);
        expect(split).to.deep.equal({ finals: 'hello ', interim: 'wor' });
    });

    it('composes replace-style field values from a fixed baseline', () => {
        expect(composeDictationFieldValue('Note:', ' ', 'hello ', 'wor')).to.equal('Note: hello wor');
        expect(composeDictationFieldValue('Note:', ' ', 'hello world', '')).to.equal('Note: hello world');
    });

    it('advances baseline with session finals without re-reading the field', () => {
        const next = advanceDictationBaseline('Note:', ' ', 'hello');
        expect(next.baseline).to.equal('Note: hello');
        expect(next.trailingSpace).to.equal(' ');
        expect(trailingSpaceForDictationBaseline('Note: hello ')).to.equal('');
    });

    it('drops pure re-emits after a mobile recognition restart', () => {
        expect(normalizeRestartedDictationSession('hello', 'hello')).to.equal('');
        expect(normalizeRestartedDictationSession('hello', 'hello ')).to.equal('');
        expect(normalizeRestartedDictationSession('hello world', 'hello')).to.equal('world');
        expect(normalizeRestartedDictationSession('hello world', 'hello ')).to.equal('world');
        expect(normalizeRestartedDictationSession('new phrase', 'hello')).to.equal('new phrase');
    });

    it('prevents the classic hello hello duplication across restart', () => {
        let baseline = '';
        let trailing = '';
        let finals = 'hello';
        const interim = '';
        expect(composeDictationFieldValue(baseline, trailing, finals, interim)).to.equal('hello');

        ({ baseline, trailingSpace: trailing } = advanceDictationBaseline(baseline, trailing, finals));
        finals = '';
        const reemitted = normalizeRestartedDictationSession('hello', 'hello');
        expect(composeDictationFieldValue(baseline, trailing, reemitted, '').trimEnd()).to.equal('hello');

        const continued = normalizeRestartedDictationSession('hello world', 'hello');
        expect(composeDictationFieldValue(baseline, trailing, continued, '')).to.equal('hello world');
    });

    it('keeps interim across mobile restart when no finals were committed', () => {
        expect(shouldClearInterimOnRecognitionRestart('')).to.equal(false);
        expect(shouldClearInterimOnRecognitionRestart('hello')).to.equal(true);

        const baseline = 'Note:';
        const trailing = ' ';
        const interimOnly = 'crea una landing';
        expect(composeDictationFieldValue(baseline, trailing, '', interimOnly)).to.equal('Note: crea una landing');
        // Restart without finals must not paint finals-only (would drop interim).
        if (shouldClearInterimOnRecognitionRestart('')) {
            expect.fail('must not clear interim-only sessions');
        }
    });

    it('explains that dictation needs Chrome or Edge', () => {
        expect(qaapChatMicUnavailableMessage()).to.include('not available in this browser');
    });
});
