// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createOpencodeFatalStderrWatcher, detectOpencodeFatalStreamError } from './qaap-opencode-fatal-error';

const BUILD_QUOTA_LINE = 'ERROR 2026-10-24T10:00:00 +5ms service=session.processor level=ERROR run=9e2e9059 message="stream error" providerID=opencode modelID=big-pickle session.id=ses_1 small=false agent=build mode=primary error.error="AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go"';
const TITLE_QUOTA_LINE = 'ERROR 2026-10-24T10:00:02 +1ms service=session.processor level=ERROR run=9e2e9059 message="stream error" providerID=opencode modelID=big-pickle session.id=ses_1 small=true agent=title mode=primary error.error="AI_APICallError: Failed after 3 attempts. Last error: Free usage limit reached."';

describe('detectOpencodeFatalStreamError', () => {

    it('returns the provider error for a main-turn quota stream error', () => {
        expect(detectOpencodeFatalStreamError(BUILD_QUOTA_LINE))
            .to.equal('AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go');
    });

    it('ignores the title request (small=true) even when it hits the same quota', () => {
        expect(detectOpencodeFatalStreamError(TITLE_QUOTA_LINE)).to.be.undefined;
    });

    it('ignores an ERROR stream line with a different provider error', () => {
        const line = BUILD_QUOTA_LINE.replace(/error\.error=".*"$/, 'error.error="TypeError: x"');
        expect(line).to.contain('error.error="TypeError: x"');
        expect(detectOpencodeFatalStreamError(line)).to.be.undefined;
    });

    it('ignores INFO lines and JSON events', () => {
        expect(detectOpencodeFatalStreamError(BUILD_QUOTA_LINE.replace(/^ERROR/, 'INFO').replace('level=ERROR', 'level=INFO'))).to.be.undefined;
        expect(detectOpencodeFatalStreamError('{"type":"error","error":{"name":"APICallError","data":{"message":"Free usage limit reached."}}}'))
            .to.be.undefined;
        expect(detectOpencodeFatalStreamError('')).to.be.undefined;
    });
});

describe('createOpencodeFatalStderrWatcher', () => {

    it('joins a stderr line split across chunks and reports it once', () => {
        const watcher = createOpencodeFatalStderrWatcher();
        const half = Math.floor(BUILD_QUOTA_LINE.length / 2);
        expect(watcher.push(BUILD_QUOTA_LINE.slice(0, half))).to.be.undefined;
        expect(watcher.push(`${BUILD_QUOTA_LINE.slice(half)}\n`))
            .to.equal('AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go');
        expect(watcher.push(`${BUILD_QUOTA_LINE}\n`)).to.be.undefined;
    });

    it('reports nothing for a title-only quota failure', () => {
        const watcher = createOpencodeFatalStderrWatcher();
        expect(watcher.push(`${TITLE_QUOTA_LINE}\n`)).to.be.undefined;
    });
});
