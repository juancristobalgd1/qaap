// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveAgentSpawnIdentity,
    buildAgentSpawnInvocation,
    evaluateAgentIsolationPolicy,
    isQaapProductionRuntime,
    isTenantUidPerUserEnabled,
    resolvePerTenantSpawnIdentity,
} from './qaap-agent-spawn-identity';

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

    it('does not refuse when the drop is applied AND uid-per-user is on', () => {
        expect(evaluateAgentIsolationPolicy(
            { NODE_ENV: 'production', QAAP_AGENT_UID: '1001', QAAP_AGENT_UID_PER_USER: '1' }, true).refuse).to.equal(false);
    });

    it('does not refuse when the operator explicitly overrides the root refusal', () => {
        expect(evaluateAgentIsolationPolicy(
            { NODE_ENV: 'production', QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION: 'true' }, true).refuse).to.equal(false);
        expect(evaluateAgentIsolationPolicy(
            { NODE_ENV: 'production', QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION: '1' }, true).refuse).to.equal(false);
    });

    it('REFUSES a shared-uid agent in production when uid-per-user is off (SEC-1 fail-closed)', () => {
        const decision = evaluateAgentIsolationPolicy({ NODE_ENV: 'production', QAAP_AGENT_UID: '1001' }, true);
        expect(decision.refuse).to.equal(true);
        expect(decision.reason).to.contain('QAAP_AGENT_UID_PER_USER');
    });

    it('does not refuse a shared uid when the operator explicitly accepts it (single-user box)', () => {
        expect(evaluateAgentIsolationPolicy(
            { NODE_ENV: 'production', QAAP_AGENT_UID: '1001', QAAP_ALLOW_SHARED_AGENT_UID_IN_PRODUCTION: 'true' },
            true).refuse).to.equal(false);
    });

    it('does not refuse a shared uid outside production (local dev container)', () => {
        expect(evaluateAgentIsolationPolicy({ QAAP_AGENT_UID: '1001' }, true).refuse).to.equal(false);
    });
});

describe('buildAgentSpawnInvocation', () => {
    it('keeps the plain shell spawn when no uid drop applies (local dev unchanged)', () => {
        expect(buildAgentSpawnInvocation('qaiq -p "hi"', {}, true)).to.deep.equal({
            file: 'qaiq -p "hi"',
            options: { shell: true },
        });
    });

    it('wraps in setpriv --clear-groups when a drop applies and setpriv exists', () => {
        expect(buildAgentSpawnInvocation('qaiq -p "hi"', { uid: 20005, gid: 20005 }, true)).to.deep.equal({
            file: 'setpriv',
            args: ['--reuid', '20005', '--regid', '20005', '--clear-groups', '--', '/bin/sh', '-c', 'qaiq -p "hi"'],
            options: { shell: false },
        });
    });

    it('passes the command as ONE argv element — no re-quoting of shell syntax', () => {
        const command = 'echo "a b" && printf \'%s\' "$HOME" | wc -c';
        const invocation = buildAgentSpawnInvocation(command, { uid: 1001 }, true);
        expect(invocation.args?.[invocation.args.length - 1]).to.equal(command);
    });

    it('defaults the regid to the uid when no gid resolved', () => {
        const invocation = buildAgentSpawnInvocation('true', { uid: 1001 }, true);
        expect(invocation.args?.slice(0, 4)).to.deep.equal(['--reuid', '1001', '--regid', '1001']);
    });

    it('falls back to the Node-level uid/gid drop when setpriv is unavailable', () => {
        expect(buildAgentSpawnInvocation('true', { uid: 1001, gid: 1001 }, false)).to.deep.equal({
            file: 'true',
            options: { shell: true, uid: 1001, gid: 1001 },
        });
    });
});

describe('isTenantUidPerUserEnabled', () => {
    it('is true only for 1/true (default off)', () => {
        expect(isTenantUidPerUserEnabled({ QAAP_AGENT_UID_PER_USER: '1' })).to.equal(true);
        expect(isTenantUidPerUserEnabled({ QAAP_AGENT_UID_PER_USER: 'true' })).to.equal(true);
        expect(isTenantUidPerUserEnabled({ QAAP_AGENT_UID_PER_USER: '0' })).to.equal(false);
        expect(isTenantUidPerUserEnabled({ QAAP_AGENT_UID_PER_USER: '' })).to.equal(false);
        expect(isTenantUidPerUserEnabled({})).to.equal(false);
    });
});

describe('resolvePerTenantSpawnIdentity', () => {
    const lookup = (segment: string): { uid: number; gid: number } => ({ uid: 20000 + segment.length, gid: 20000 + segment.length });

    it('returns the tenant uid/gid when enabled, root, and a segment resolved', () => {
        expect(resolvePerTenantSpawnIdentity({ enabled: true, isRoot: true, segment: 'alice', lookup }))
            .to.deep.equal({ uid: 20005, gid: 20005 });
    });

    it('falls back (undefined) when disabled, not root, or no segment', () => {
        expect(resolvePerTenantSpawnIdentity({ enabled: false, isRoot: true, segment: 'alice', lookup })).to.equal(undefined);
        expect(resolvePerTenantSpawnIdentity({ enabled: true, isRoot: false, segment: 'alice', lookup })).to.equal(undefined);
        expect(resolvePerTenantSpawnIdentity({ enabled: true, isRoot: true, segment: undefined, lookup })).to.equal(undefined);
    });

    it('propagates a registry failure so the caller fails closed', () => {
        const throwing = (): { uid: number; gid: number } => { throw new Error('range exhausted'); };
        expect(() => resolvePerTenantSpawnIdentity({ enabled: true, isRoot: true, segment: 'alice', lookup: throwing }))
            .to.throw(/range exhausted/);
    });
});
