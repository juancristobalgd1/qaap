// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import { expect } from 'chai';
import { ElectronSecurityToken } from '@theia/core/lib/electron-common/electron-token';
import { QaapToolGateElectronTokenValidator } from './qaap-tool-gate-electron-token-validator';

class TestValidator extends QaapToolGateElectronTokenValidator {
    constructor() {
        super();
        this.electronSecurityToken = { value: 'window-token' };
    }
}

function request(method: string, url: string, cookie?: string): http.IncomingMessage {
    return { method, url, headers: cookie ? { cookie } : {} } as unknown as http.IncomingMessage;
}

const WINDOW_COOKIE = `${ElectronSecurityToken}=${encodeURIComponent(JSON.stringify({ value: 'window-token' }))}`;

describe('QaapToolGateElectronTokenValidator', () => {

    it('lets an agent process reach the tool gate without the window cookie (it was a 403 on desktop)', () => {
        const validator = new TestValidator();
        expect(validator.allowRequest(request('POST', '/qaap/api/tool-gate/evaluate'))).to.equal(true);
        expect(validator.allowRequest(request('POST', '/qaap/api/tool-gate/arm'))).to.equal(true);
        expect(validator.allowRequest(request('GET', '/qaap/api/tool-gate/health?x=1'))).to.equal(true);
    });

    it('lets the agent preview shim reach its token-authenticated routes, not the user preview routes', () => {
        // Desktop QA, 26 Nov 2026: every preview_* call from Pi answered 403 before reaching the endpoint.
        const validator = new TestValidator();
        expect(validator.allowRequest(request('POST', '/qaap/api/agent-preview/start'))).to.equal(true);
        expect(validator.allowRequest(request('POST', '/qaap/api/agent-preview/status'))).to.equal(true);
        expect(validator.allowRequest(request('POST', '/qaap/api/agent-preview/snapshot'))).to.equal(true);
        expect(validator.allowRequest(request('POST', '/qaap/api/preview/start'))).to.equal(false);
        expect(validator.allowRequest(request('POST', '/qaap/api/agent-preview/start/../../agent-tasks'))).to.equal(false);
    });

    it('keeps the cookie check for every other route, method or path trick', () => {
        const validator = new TestValidator();
        for (const [method, url] of [
            ['POST', '/qaap/api/agent-tasks'],
            ['GET', '/qaap/api/tool-gate'],
            ['GET', '/qaap/api/tool-gate/'],
            ['POST', '/qaap/api/tool-gate/evaluate/../../agent-tasks'],
            ['POST', '/qaap/api/tool-gate/%65valuate'],
            ['POST', '/qaap/api/tool-gate/evaluatex'],
            ['DELETE', '/qaap/api/tool-gate/evaluate'],
        ]) {
            expect(validator.allowRequest(request(method, url)), `${method} ${url}`).to.equal(false);
        }
        expect(validator.allowRequest(request('POST', '/qaap/api/agent-tasks', WINDOW_COOKIE))).to.equal(true);
    });

    it('never exempts a WebSocket upgrade', () => {
        const validator = new TestValidator();
        expect(validator.allowWsUpgrade(request('GET', '/qaap/api/tool-gate/health'))).to.equal(false);
        expect(validator.allowWsUpgrade(request('GET', '/services', WINDOW_COOKIE))).to.equal(true);
    });
});
