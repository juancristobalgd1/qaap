// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { childProcessEnv, isQaapBackendOnlyEnvKey, stripBackendOnlyEnv } from './qaap-child-process-env';

describe('qaap-child-process-env', () => {
    it('flags backend-only secrets, including future QAAP_*SECRET keys', () => {
        expect(isQaapBackendOnlyEnvKey('QAAP_TENANT_BACKEND_SECRET')).to.equal(true);
        expect(isQaapBackendOnlyEnvKey('QAAP_GITHUB_CLIENT_SECRET')).to.equal(true);
        expect(isQaapBackendOnlyEnvKey('QAAP_VAPID_PRIVATE_KEY')).to.equal(true);
        expect(isQaapBackendOnlyEnvKey('QAAP_VAPID_SUBJECT')).to.equal(true);
        expect(isQaapBackendOnlyEnvKey('QAAP_SOME_NEW_SECRET')).to.equal(true);
    });

    it('keeps what agents legitimately need', () => {
        expect(isQaapBackendOnlyEnvKey('QAAP_TASK_TOKEN')).to.equal(false);
        expect(isQaapBackendOnlyEnvKey('QAAP_TASK_API_URL')).to.equal(false);
        expect(isQaapBackendOnlyEnvKey('QAAP_TENANT_LOGIN')).to.equal(false);
        expect(isQaapBackendOnlyEnvKey('QAAP_TENANT_BACKEND_MODE')).to.equal(false);
        expect(isQaapBackendOnlyEnvKey('PATH')).to.equal(false);
        expect(isQaapBackendOnlyEnvKey('OPENROUTER_API_KEY')).to.equal(false);
    });

    it('strips in place and copies without touching the source', () => {
        const source: NodeJS.ProcessEnv = { PATH: '/usr/bin', QAAP_TENANT_BACKEND_SECRET: 's', QAAP_TASK_TOKEN: 't' };
        const copy = childProcessEnv(source);
        expect(copy).to.deep.equal({ PATH: '/usr/bin', QAAP_TASK_TOKEN: 't' });
        expect(source.QAAP_TENANT_BACKEND_SECRET).to.equal('s');
        stripBackendOnlyEnv(source);
        expect(source).to.deep.equal({ PATH: '/usr/bin', QAAP_TASK_TOKEN: 't' });
    });
});
