// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    advanceDictationBaseline,
    composeDictationFieldValue,
    mergeCumulativeSpeechSegment,
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

    it('collapses Android cumulative results instead of duplicating them', () => {
        const split = splitSpeechRecognitionTranscript([
            { isFinal: true, 0: { transcript: 'hola' } },
            { isFinal: true, 0: { transcript: 'hola cómo estás' } },
        ], { collapseCumulativeResults: true });
        expect(split).to.deep.equal({ finals: 'hola cómo estás', interim: '' });
    });

    it('keeps finals a prefix of cumulative interim text', () => {
        const split = splitSpeechRecognitionTranscript([
            { isFinal: true, 0: { transcript: 'hola' } },
            { isFinal: false, 0: { transcript: 'Hola cómo' } },
        ], { collapseCumulativeResults: true });
        expect(split).to.deep.equal({ finals: 'hola', interim: ' cómo' });
    });

    it('appends non-cumulative Android segments with a separating space', () => {
        const split = splitSpeechRecognitionTranscript([
            { isFinal: true, 0: { transcript: 'hola' } },
            { isFinal: true, 0: { transcript: 'cómo estás' } },
        ], { collapseCumulativeResults: true });
        expect(split).to.deep.equal({ finals: 'hola cómo estás', interim: '' });
    });

    it('merges cumulative segments by words, ignoring case and punctuation', () => {
        expect(mergeCumulativeSpeechSegment('', ' hola ')).to.equal('hola');
        expect(mergeCumulativeSpeechSegment('hola', 'Hola, qué tal')).to.equal('hola qué tal');
        expect(mergeCumulativeSpeechSegment('hola qué tal', 'hola qué tal')).to.equal('hola qué tal');
        expect(mergeCumulativeSpeechSegment('no', 'no no')).to.equal('no no');
        expect(mergeCumulativeSpeechSegment('hola', '   ')).to.equal('hola');
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
