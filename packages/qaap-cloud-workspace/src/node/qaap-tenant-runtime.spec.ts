// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapTenantRuntimeStartupContribution } from './qaap-tenant-runtime-startup';
import { resolveQaapTenantDockerHost, resolveQaapTenantRuntime, validateQaapTenantRuntimeEnv } from './qaap-tenant-runtime';

describe('qaap-tenant-runtime', () => {

    const keys = ['QAAP_TENANT_RUNTIME', 'QAAP_TENANT_DOCKER_HOST', 'QAAP_DOCKER_NODES'] as const;
    let saved: Partial<Record<typeof keys[number], string | undefined>>;

    beforeEach(() => {
        saved = {};
        for (const key of keys) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        for (const key of keys) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });

    it('defaults to runc and resolves the tenant docker host only when set', () => {
        expect(resolveQaapTenantRuntime({})).to.equal('runc');
        expect(resolveQaapTenantDockerHost({})).to.equal(undefined);
        expect(resolveQaapTenantDockerHost({ QAAP_TENANT_DOCKER_HOST: ' unix:///run/g.sock ' })).to.equal('unix:///run/g.sock');
    });

    it('validates the tenant runtime settings without contacting Docker', () => {
        expect(() => validateQaapTenantRuntimeEnv({ QAAP_TENANT_RUNTIME: 'runsc' })).to.not.throw();
        expect(() => validateQaapTenantRuntimeEnv({ QAAP_TENANT_RUNTIME: 'kata' })).to.throw(/Unsupported QAAP_TENANT_RUNTIME/);
        expect(() => validateQaapTenantRuntimeEnv({
            QAAP_TENANT_DOCKER_HOST: 'unix:///run/g.sock',
            QAAP_DOCKER_NODES: '[{"id":"a","dockerHost":"unix:///var/run/docker.sock"}]',
        })).to.throw(/cannot be combined with QAAP_DOCKER_NODES/);
    });

    it('fails the backend start on an unsupported QAAP_TENANT_RUNTIME', () => {
        process.env.QAAP_TENANT_RUNTIME = 'kata';
        expect(() => new QaapTenantRuntimeStartupContribution().onStart()).to.throw(/Unsupported QAAP_TENANT_RUNTIME/);
        process.env.QAAP_TENANT_RUNTIME = 'runsc';
        expect(() => new QaapTenantRuntimeStartupContribution().onStart()).to.not.throw();
    });

});
