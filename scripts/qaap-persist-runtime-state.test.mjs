import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrate, migrationPlan, destinations } from './qaap-persist-runtime-state.mjs';

const id = 'a'.repeat(64);
const snapshot = 'sha256:' + 'b'.repeat(64);
function fixture({ running = true, mounted = false, failCopy = false } = {}) {
    const config = { name: 'qaap', services: { theia: { environment: {}, volumes: [] } }, volumes: {} };
    for (const [index, target] of destinations.entries()) {
        const key = `state-${index}`;
        config.services.theia.volumes.push({ target, source: key, type: 'volume' });
        config.volumes[key] = { name: `qaap_${key}` };
    }
    const container = { Id: id, State: { Running: running }, Config: { Env: [] }, Mounts: mounted
        ? destinations.map((Destination, index) => ({ Destination, Name: `qaap_state-${index}`, Type: 'volume', RW: true })) : [] };
    const calls = [];
    const volumes = new Map();
    const docker = args => {
        calls.push(args);
        if (args[0] === 'compose') { return args[1] === 'config' ? JSON.stringify(config) : id; }
        if (args[0] === 'inspect') { return JSON.stringify([container]); }
        if (args[0] === 'stop') { container.State.Running = false; return id; }
        if (args[0] === 'commit') { return snapshot; }
        if (args[0] === 'volume') {
            if (args[1] === 'ls') { return [...volumes.keys()].join('\n'); }
            if (args[1] === 'inspect') { return JSON.stringify([volumes.get(args[2])]); }
            if (args[1] === 'create') {
                volumes.set(args.at(-1), { Labels: { 'qaap.migration.source': id, 'qaap.migration.snapshot': snapshot } });
                return args.at(-1);
            }
        }
        if (args[0] === 'run') {
            if (failCopy) { throw new Error('copy failed'); }
            return '{"verified":true}';
        }
        throw new Error(`Unexpected Docker command: ${args.join(' ')}`);
    };
    return { config, container, calls, volumes, docker, helper: 'helper' };
}

test('default planning is read-only and identifies all ephemeral roots', () => {
    const f = fixture();
    const result = migrate(f);
    assert.equal(result.ready, false);
    assert.equal(result.plan.filter(item => item.required).length, 3);
    assert.ok(f.calls.every(args => ['compose', 'inspect'].includes(args[0])));
});
test('blocks replacement of a running unmigrated container', () => {
    const f = fixture();
    assert.throws(() => migrate({ ...f, mode: 'check' }), /migrate/);
    assert.ok(!f.calls.some(args => args[0] === 'stop'));
});
test('already mounted persistent state needs no copy or downtime', () => {
    const f = fixture({ mounted: true });
    assert.equal(migrate({ ...f, mode: 'check' }).ready, true);
    assert.ok(!f.calls.some(args => args[0] === 'stop'));
});
test('copies from a stopped snapshot, preserves paths and verifies prepared volumes', () => {
    const f = fixture();
    const result = migrate({ ...f, mode: 'apply' });
    assert.equal(result.sourceStopped, true);
    assert.ok(f.calls.findIndex(args => args[0] === 'stop') < f.calls.findIndex(args => args[0] === 'commit'));
    assert.equal(f.calls.filter(args => args[0] === 'run').length, 3);
    assert.equal(migrate({ ...f, mode: 'check' }).ready, true);
    const verifies = f.calls.filter(args => args.at(-1) === 'verify');
    assert.equal(verifies.length, 3);
    assert.ok(verifies.every(args => args.some(value => value.endsWith(',readonly'))));
});
test('does not overwrite existing targets or restart/delete sources on copy failure', () => {
    const existing = fixture();
    existing.volumes.set('qaap_state-0', { Labels: {} });
    assert.throws(() => migrate({ ...existing, mode: 'apply' }), /already exists/);
    assert.ok(!existing.calls.some(args => args[0] === 'stop'));
    const broken = fixture({ failCopy: true });
    assert.throws(() => migrate({ ...broken, mode: 'apply' }), /copy failed/);
    assert.ok(!broken.calls.some(args => ['rm', 'start', 'rmi'].includes(args[0])));
});
test('rejects custom roots, ancestor mounts and unexpected target mounts', () => {
    const f = fixture();
    f.container.Config.Env = ['TMPDIR=/custom'];
    assert.throws(() => migrationPlan(f.config, f.container), /Custom/);
    f.container.Config.Env = [];
    f.container.Mounts = [{ Destination: '/tmp', Type: 'bind' }];
    assert.throws(() => migrationPlan(f.config, f.container), /ancestor/);
    f.container.Mounts = [{ Destination: destinations[0], Name: 'other', Type: 'volume', RW: true }];
    assert.throws(() => migrationPlan(f.config, f.container), /Unexpected/);
});

test('an unreadable existing container is never treated as a fresh installation', () => {
    const f = fixture();
    const docker = args => args[0] === 'inspect' ? '[]' : f.docker(args);
    assert.throws(() => migrate({ ...f, docker, mode: 'apply' }), /fresh-install/);
    assert.ok(!f.calls.some(args => args[0] === 'stop'));
});

test('nested source or proposed mounts block migration before stopping the service', () => {
    for (const proposed of [false, true]) {
        const f = fixture();
        if (proposed) {
            f.config.services.theia.volumes.push({ type: 'volume', source: 'nested', target: destinations[0] + '/tenant' });
        } else {
            f.container.Mounts.push({ Type: 'bind', Destination: destinations[0] + '/tenant' });
        }
        assert.throws(() => migrate({ ...f, mode: 'apply' }), /nested mount/);
        assert.ok(!f.calls.some(args => ['stop', 'commit', 'run'].includes(args[0])));
    }
});
