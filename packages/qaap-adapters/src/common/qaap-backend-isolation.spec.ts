// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isQaapBackendIsolationReady,
    isQaapPublicMultiTenantRuntime,
    QAAP_BACKEND_ISOLATION_MODE,
} from './qaap-backend-isolation';

describe('Qaap backend isolation policy', () => {

    it('keeps local development available without a public tenant list', () => {
        expect(isQaapPublicMultiTenantRuntime({ NODE_ENV: 'development', QAAP_CLOUD_MODE: 'local' })).to.equal(false);
        expect(isQaapBackendIsolationReady({ NODE_ENV: 'development', QAAP_CLOUD_MODE: 'local' })).to.equal(true);
    });

    it('blocks invited hosted tenants until the per-tenant deployment wiring is enabled', () => {
        const env = {
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            QAAP_BETA_ALLOWED_LOGINS: 'alice,bob',
        };
        expect(QAAP_BACKEND_ISOLATION_MODE).to.equal('per-tenant');
        expect(isQaapPublicMultiTenantRuntime(env)).to.equal(true);
        expect(isQaapBackendIsolationReady(env)).to.equal(false);
    });

    it('accepts the real backend-per-tenant wiring only with its deployment secret', () => {
        expect(isQaapBackendIsolationReady({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            QAAP_BETA_ALLOWED_LOGINS: 'alice',
            QAAP_BACKEND_PER_TENANT: '1',
            QAAP_TENANT_BACKEND_MASTER_SECRET: 'a'.repeat(32),
        })).to.equal(true);
    });

    it('does not let an environment variable self-assert per-tenant isolation', () => {
        expect(isQaapBackendIsolationReady({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            QAAP_BETA_ALLOWED_LOGINS: 'alice',
            QAAP_BACKEND_ISOLATION_MODE: 'per-tenant',
        })).to.equal(false);
    });
});
