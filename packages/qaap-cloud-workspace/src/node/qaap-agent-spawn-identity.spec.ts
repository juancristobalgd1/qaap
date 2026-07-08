// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveAgentSpawnIdentity, evaluateAgentIsolationPolicy, isQaapProductionRuntime } from './qaap-agent-spawn-identity';

describe('resolveAgentSpawnIdentity', () => {
    it('returns empty when QAAP_AGENT_UID is unset (local dev unchanged)', () => {
        expect(resolveAgentSpawnIdentity({}, true)).to.deep.equal({});
    });

    it('drops to the requested uid when the backend is root', () => {
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: '1000' }, true)).to.deep.equal({ uid: 1000 });
    });

    it('includes gid when QAAP_AGENT_GID is a valid integer', () => {
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: '1000', QAAP_AGENT_GID: '1000' }, true))
            .to.deep.equal({ uid: 1000, gid: 1000 });
    });

    it('flags warnNotRoot (and does not drop) when a uid is requested but the backend is not root', () => {
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: '1000' }, false)).to.deep.equal({ warnNotRoot: true });
    });

    it('ignores an invalid uid', () => {
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: 'nope' }, true)).to.deep.equal({});
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: '-5' }, true)).to.deep.equal({});
    });

    it('ignores an invalid gid but keeps the uid', () => {
        expect(resolveAgentSpawnIdentity({ QAAP_AGENT_UID: '1000', QAAP_AGENT_GID: 'x' }, true))
            .to.deep.equal({ uid: 1000 });
    });
});

describe('isQaapProductionRuntime', () => {
    it('is true when NODE_ENV=production', () => {
        expect(isQaapProductionRuntime({ NODE_ENV: 'production' })).to.equal(true);
    });

    it('is true when QAAP_CLOUD_MODE is a non-local value', () => {
        expect(isQaapProductionRuntime({ QAAP_CLOUD_MODE: 'cloud' })).to.equal(true);
    });

    it('is false for local dev (unset, or QAAP_CLOUD_MODE=local)', () => {
        expect(isQaapProductionRuntime({})).to.equal(false);
        expect(isQaapProductionRuntime({ QAAP_CLOUD_MODE: 'local' })).to.equal(false);
        expect(isQaapProductionRuntime({ NODE_ENV: 'development' })).to.equal(false);
    });
});

describe('evaluateAgentIsolationPolicy', () => {
    it('does not refuse in local dev even as root (not a production runtime)', () => {
        expect(evaluateAgentIsolationPolicy({}, true).refuse).to.equal(false);
    });

    it('does not refuse when the backend is not root (agent inherits a non-root uid)', () => {
        expect(evaluateAgentIsolationPolicy({ NODE_ENV: 'production' }, false).refuse).to.equal(false);
    });

    it('REFUSES a root agent in a production runtime with no privilege drop', () => {
        const decision = evaluateAgentIsolationPolicy({ NODE_ENV: 'production' }, true);
        expect(decision.refuse).to.equal(true);
        expect(decision.reason).to.contain('QAAP_AGENT_UID');
    });

    it('REFUSES a root agent when QAAP_CLOUD_MODE marks a hosted runtime', () => {
        expect(evaluateAgentIsolationPolicy({ QAAP_CLOUD_MODE: 'cloud' }, true).refuse).to.equal(true);
    });

    it('does not refuse when the drop is applied (QAAP_AGENT_UID set and backend root)', () => {
        expect(evaluateAgentIsolationPolicy({ NODE_ENV: 'production', QAAP_AGENT_UID: '1001' }, true).refuse).to.equal(false);
    });

    it('does not refuse when the operator explicitly overrides', () => {
        expect(evaluateAgentIsolationPolicy(
            { NODE_ENV: 'production', QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION: 'true' }, true).refuse).to.equal(false);
        expect(evaluateAgentIsolationPolicy(
            { NODE_ENV: 'production', QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION: '1' }, true).refuse).to.equal(false);
    });
});
