// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapPreviewFrameHistory } from './qaap-preview-frame-history';

describe('QaapPreviewFrameHistory', () => {
    it('disables back/forward until there is a trail', () => {
        const history = new QaapPreviewFrameHistory();
        expect(history.canGoBack()).to.equal(false);
        expect(history.canGoForward()).to.equal(false);
        history.record('https://a.example/');
        expect(history.canGoBack()).to.equal(false);
        expect(history.canGoForward()).to.equal(false);
    });

    it('supports back and forward across recorded URLs', () => {
        const history = new QaapPreviewFrameHistory();
        history.record('https://a.example/');
        history.record('https://b.example/');
        history.record('https://c.example/');
        expect(history.back()).to.equal('https://b.example/');
        expect(history.canGoBack()).to.equal(true);
        expect(history.canGoForward()).to.equal(true);
        expect(history.forward()).to.equal('https://c.example/');
        expect(history.canGoForward()).to.equal(false);
        history.finishHistoryNav();
    });

    it('truncates the forward branch after a new record from mid-stack', () => {
        const history = new QaapPreviewFrameHistory();
        history.record('https://a.example/');
        history.record('https://b.example/');
        history.record('https://c.example/');
        history.back();
        history.finishHistoryNav();
        history.record('https://d.example/');
        expect(history.canGoForward()).to.equal(false);
        expect(history.current()).to.equal('https://d.example/');
        expect(history.back()).to.equal('https://b.example/');
        history.finishHistoryNav();
    });

    it('ignores duplicate current URLs and blanks', () => {
        const history = new QaapPreviewFrameHistory();
        history.record('https://a.example/');
        history.record('https://a.example/');
        history.record('about:blank');
        history.record('  ');
        expect(history.current()).to.equal('https://a.example/');
        expect(history.canGoBack()).to.equal(false);
    });

    it('does not push while applying history navigation', () => {
        const history = new QaapPreviewFrameHistory();
        history.record('https://a.example/');
        history.record('https://b.example/');
        expect(history.back()).to.equal('https://a.example/');
        history.record('https://should-not-push.example/');
        expect(history.current()).to.equal('https://a.example/');
        history.finishHistoryNav();
        history.record('https://c.example/');
        expect(history.current()).to.equal('https://c.example/');
    });
});
