// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    assertQaapDockerControlPlane,
    assertQaapHostedTenantIsolation,
    evaluateQaapDockerControlPlane,
} from './qaap-docker-control-plane';

describe('qaap-docker-control-plane', () => {
    it('allows local Docker Desktop development', () => {
        const result = evaluateQaapDockerControlPlane({
            NODE_ENV: 'development',
            QAAP_CLOUD_MODE: 'local',
            DOCKER_HOST: 'npipe:////./pipe/docker_engine',
        });
        expect(result.ready).to.equal(true);
    });

    it('rejects the default rootful socket in hosted mode', () => {
        const result = evaluateQaapDockerControlPlane({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            DOCKER_HOST: 'unix:///var/run/docker.sock',
        });
        expect(result.ready).to.equal(false);
        expect(result.fatalReason).to.match(/rootless|rootful/i);
        expect(() => assertQaapDockerControlPlane({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            DOCKER_HOST: 'unix:///var/run/docker.sock',
        })).to.throw(/Refusing hosted Docker control-plane access/i);
    });

    it('accepts a rootless user Docker socket in hosted mode', () => {
        const result = evaluateQaapDockerControlPlane({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            DOCKER_HOST: 'unix:///run/user/1000/docker.sock',
        });
        expect(result.ready).to.equal(true);
        expect(result.rootlessSocket).to.equal(true);
    });

    it('does not treat an unwired supervisor flag as a security boundary', () => {
        const result = evaluateQaapDockerControlPlane({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            QAAP_DOCKER_SUPERVISOR: 'true',
        });
        expect(result.ready).to.equal(false);
        expect(result.supervisorConfigured).to.equal(true);
        expect(result.fatalReason).to.match(/no supervisor adapter/i);
    });

    it('rejects a rootful override instead of treating it as a security boundary', () => {
        const result = evaluateQaapDockerControlPlane({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            DOCKER_HOST: 'unix:///var/run/docker.sock',
            QAAP_ALLOW_ROOTFUL_DOCKER_SOCKET_IN_PRODUCTION: '1',
        });
        expect(result.ready).to.equal(false);
        expect(result.fatalReason).to.match(/never accepted|rootless/i);
    });

    it('rejects unencrypted TCP Docker control in hosted mode', () => {
        const result = evaluateQaapDockerControlPlane({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            DOCKER_HOST: 'tcp://docker:2375',
        });
        expect(result.ready).to.equal(false);
        expect(result.fatalReason).to.match(/unencrypted TCP/i);
    });

    it('rejects hosted startup when the tenant worker boundary is disabled', () => {
        expect(() => assertQaapHostedTenantIsolation({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'host',
            DOCKER_HOST: 'unix:///run/user/1000/docker.sock',
        })).to.throw(/container-per-tenant/i);
    });

    it('accepts hosted startup only with container isolation and a rootless control plane', () => {
        expect(() => assertQaapHostedTenantIsolation({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            DOCKER_HOST: 'unix:///run/user/1000/docker.sock',
        })).to.not.throw();
    });
});
