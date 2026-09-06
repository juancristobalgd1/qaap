// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const destinations = ['/tmp/qaap-worktrees', '/tmp/qaap-parallel', '/home/qaap-tenants'];

export function migrationPlan(config, container) {
    if (!config.name || !config.services?.theia || !Array.isArray(config.services.theia.volumes) || !config.volumes) {
        throw new Error('Invalid Compose configuration for persistence migration');
    }
    const service = config.services.theia;
    const env = service.environment ?? {};
    const oldEnv = Object.fromEntries((container?.Config?.Env ?? []).map(value => {
        const at = value.indexOf('=');
        return [value.slice(0, at), value.slice(at + 1)];
    }));
    for (const settings of [env, oldEnv]) {
        for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
            if (settings[key] && settings[key] !== '/tmp') { throw new Error('Custom temporary roots require a reviewed migration'); }
        }
        if (settings.QAAP_TENANT_HOME_ROOT && settings.QAAP_TENANT_HOME_ROOT !== '/home/qaap-tenants') {
            throw new Error('Custom tenant HOME requires a reviewed migration');
        }
    }
    return destinations.map(destination => {
        const desired = service.volumes.find(volume => volume.target === destination);
        if (desired?.type !== 'volume' || !config.volumes[desired.source]?.name) {
            throw new Error(`Expected a named persistent volume for ${destination}`);
        }
        const volume = config.volumes[desired.source].name;
        const mounted = container?.Mounts?.find(mount => mount.Destination === destination);
        if (container?.Mounts?.some(mount => mount.Destination.startsWith(destination + '/')) ||
            service.volumes.some(mount => mount.target?.startsWith(destination + '/'))) {
            throw new Error(`A nested mount overlaps ${destination}; a reviewed migration is required to preserve all data`);
        }
        if (container?.Mounts?.some(mount => destination.startsWith(mount.Destination.replace(/\/$/, '') + '/'))) {
            throw new Error(`An ancestor mount contains ${destination}; snapshot migration cannot copy it safely`);
        }
        if (mounted && (mounted.Type !== 'volume' || mounted.Name !== volume || !mounted.RW)) {
            throw new Error(`Unexpected existing mount at ${destination}; refusing to replace it`);
        }
        return { destination, volume, key: desired.source, required: !!container && !mounted };
    });
}

export function migrate({ mode = 'plan', docker, helper }) {
    const config = JSON.parse(docker(['compose', 'config', '--format', 'json']));
    const id = docker(['compose', 'ps', '-aq', 'theia']).trim();
    if (id && !/^[0-9a-f]{12,64}$/.test(id)) { throw new Error('Expected exactly one Theia container'); }
    const container = id ? JSON.parse(docker(['inspect', id]))[0] : undefined;
    if (id && (!container || !/^[0-9a-f]{64}$/.test(container.Id) || typeof container.State?.Running !== 'boolean' || !Array.isArray(container.Mounts))) {
        throw new Error('Cannot validate the existing container; refusing a fresh-install assumption');
    }
    const plan = migrationPlan(config, container);
    const pending = plan.filter(item => item.required);
    if (mode === 'plan' || !pending.length) { return { mode, plan, ready: !pending.length }; }
    const inspectVolume = volume => {
        // A successful listing distinguishes absence from a Docker failure.
        const names = docker(['volume', 'ls', '--format', '{{.Name}}']).trim().split('\n');
        if (!names.includes(volume)) { return undefined; }
        const existing = JSON.parse(docker(['volume', 'inspect', volume]))[0];
        if (!existing) { throw new Error('Cannot inspect an existing target volume'); }
        return existing;
    };
    const verify = (item, volume) => {
        const labels = volume.Labels ?? {};
        if (labels['qaap.migration.source'] !== container.Id || !/^sha256:[0-9a-f]{64}$/.test(labels['qaap.migration.snapshot'] ?? '')) {
            throw new Error('Target volume is not a verified migration of this source container');
        }
        const result = JSON.parse(docker(['run', '--rm', '--network', 'none', '--user', '0', '--entrypoint', 'node', '-i',
            '--mount', `type=volume,source=${item.volume},target=/qaap-migration-target,readonly`,
            labels['qaap.migration.snapshot'], '-', item.destination, '/qaap-migration-target', 'verify'], helper));
        if (result.verified !== true) { throw new Error('Migration verification did not confirm matching data'); }
    };
    if (mode === 'check') {
        if (container.State.Running) { throw new Error('Stop and migrate runtime state before recreating this container: use --apply'); }
        for (const item of pending) {
            const volume = inspectVolume(item.volume);
            if (!volume) { throw new Error('Persistent runtime volume missing: run --apply before deployment'); }
            verify(item, volume);
        }
        return { mode, ready: true, plan };
    }
    if (mode !== 'apply') { throw new Error('Unknown migration mode'); }
    // Do not stop the service if any target already exists: inspect/verify it first.
    for (const item of pending) {
        if (inspectVolume(item.volume)) { throw new Error('Target volume already exists. Use --check; never overwrite it automatically'); }
    }
    if (container.State.Running) { docker(['stop', '--time', '60', container.Id]); }
    // Never auto-restart after copying: new writes would invalidate the prepared volumes.
    const snapshot = docker(['commit', container.Id]).trim();
    if (!/^sha256:[0-9a-f]{64}$/.test(snapshot)) { throw new Error('Could not create source snapshot'); }
    for (const item of pending) {
        docker(['volume', 'create', '--label', `com.docker.compose.project=${config.name}`,
            '--label', `com.docker.compose.volume=${item.key}`,
            '--label', `qaap.migration.source=${container.Id}`, '--label', `qaap.migration.snapshot=${snapshot}`, item.volume]);
        const result = JSON.parse(docker(['run', '--rm', '--network', 'none', '--user', '0', '--entrypoint', 'node', '-i',
            '--mount', `type=volume,source=${item.volume},target=/qaap-migration-target`,
            snapshot, '-', item.destination, '/qaap-migration-target', 'copy'], helper));
        if (result.verified !== true) { throw new Error('Migration copy did not confirm matching data'); }
    }
    return { mode, ready: true, plan, snapshot, sourceStopped: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const mode = process.argv[2]?.replace(/^--/, '') ?? 'plan';
    if (!['plan', 'check', 'apply'].includes(mode) || process.argv.length > 3) {
        console.error('Usage: node scripts/qaap-persist-runtime-state.mjs [--plan|--check|--apply]');
        process.exit(2);
    }
    try {
        const cwd = fileURLToPath(new URL('../', import.meta.url));
        const docker = (args, input) => execFileSync('docker', args, { cwd, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        const helper = readFileSync(new URL('./qaap-runtime-state-copy.js', import.meta.url), 'utf8');
        console.log(JSON.stringify(migrate({ mode, docker, helper }), undefined, 2));
    } catch (error) {
        console.error(`Runtime state migration blocked: ${error.message}`);
        console.error('No source data was deleted. After --apply, keep the source stopped until verified deployment; do not prune migration snapshots.');
        process.exitCode = 1;
    }
}
