// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapPreviewFailureHtml,
    escapeQaapHtml,
    pruneRestartHistory,
    QaapStderrRing,
    QAAP_PREVIEW_AUTO_RESTART_MAX,
    QAAP_PREVIEW_RESTART_PATH,
    shouldAutoRestartPreview,
} from './qaap-preview-supervisor-types';

describe('qaap-preview-supervisor-types', () => {

    describe('QaapStderrRing', () => {
        it('retains only the last N complete lines', () => {
            const ring = new QaapStderrRing(3);
            ring.push('a\nb\nc\nd\n');
            expect(ring.snapshot()).to.deep.equal(['b', 'c', 'd']);
        });

        it('reassembles lines split across chunks', () => {
            const ring = new QaapStderrRing(10);
            ring.push('Error: some');
            ring.push('thing broke\nnext line\n');
            expect(ring.snapshot()).to.deep.equal(['Error: something broke', 'next line']);
        });

        it('includes an unterminated trailing line', () => {
            const ring = new QaapStderrRing(10);
            ring.push('line1\npartial');
            expect(ring.snapshot()).to.deep.equal(['line1', 'partial']);
        });

        it('strips carriage returns', () => {
            const ring = new QaapStderrRing(10);
            ring.push('windows\r\nline\r\n');
            expect(ring.snapshot()).to.deep.equal(['windows', 'line']);
        });

        it('ignores empty chunks', () => {
            const ring = new QaapStderrRing(10);
            ring.push('');
            expect(ring.snapshot()).to.deep.equal([]);
        });
    });

    describe('shouldAutoRestartPreview', () => {
        const now = 1_000_000;
        const windowMs = 10 * 60 * 1000;

        it('allows a restart when history is empty', () => {
            expect(shouldAutoRestartPreview([], now, windowMs, 2)).to.equal(true);
        });

        it('allows up to max restarts inside the window', () => {
            expect(shouldAutoRestartPreview([now - 1000], now, windowMs, 2)).to.equal(true);
        });

        it('blocks once the cap is reached inside the window', () => {
            expect(shouldAutoRestartPreview([now - 1000, now - 2000], now, windowMs, 2)).to.equal(false);
        });

        it('ignores restarts that fell outside the window', () => {
            const old = now - windowMs - 1;
            expect(shouldAutoRestartPreview([old, old], now, windowMs, 2)).to.equal(true);
        });

        it('uses default window and cap', () => {
            const many = Array.from({ length: QAAP_PREVIEW_AUTO_RESTART_MAX }, (_, i) => now - i * 1000);
            expect(shouldAutoRestartPreview(many, now)).to.equal(false);
        });
    });

    describe('pruneRestartHistory', () => {
        it('drops timestamps older than the window', () => {
            const now = 1_000_000;
            const windowMs = 10 * 60 * 1000;
            const kept = pruneRestartHistory([now - windowMs - 1, now - 5000], now, windowMs);
            expect(kept).to.deep.equal([now - 5000]);
        });
    });

    describe('escapeQaapHtml', () => {
        it('escapes HTML-significant characters', () => {
            expect(escapeQaapHtml(`<script>"&'`)).to.equal('&lt;script&gt;&quot;&amp;&#39;');
        });
    });

    describe('buildQaapPreviewFailureHtml', () => {
        it('renders exit code, signal, and escaped stderr with a Restart button', () => {
            const html = buildQaapPreviewFailureHtml({
                port: 5173,
                cwd: '/home/user/app',
                exitCode: 1,
                signal: 'SIGTERM',
                stderrTail: ['Error: <boom>', 'stack line'],
                everStarted: true,
            });
            expect(html).to.contain('exit code 1');
            expect(html).to.contain('signal SIGTERM');
            expect(html).to.contain('Error: &lt;boom&gt;');
            expect(html).to.contain('Restart dev server');
            expect(html).to.contain(QAAP_PREVIEW_RESTART_PATH);
            expect(html).to.contain('"port":5173');
            expect(html).to.contain('"cwd":"/home/user/app"');
        });

        it('disables restart when no cwd is known', () => {
            const html = buildQaapPreviewFailureHtml({ port: 5173, everStarted: false });
            expect(html).to.not.contain('Restart dev server');
            expect(html).to.contain('No dev server is running on port 5173');
        });

        it('does not leak raw script tags from stderr into the page', () => {
            const html = buildQaapPreviewFailureHtml({
                port: 3001,
                cwd: '/w',
                stderrTail: ['</script><img src=x onerror=alert(1)>'],
            });
            expect(html).to.not.contain('<img src=x onerror=alert(1)>');
            expect(html).to.contain('&lt;/script&gt;');
        });
    });
});
