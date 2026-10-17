#!/usr/bin/env node
// Per-task sandbox, production (broker) path end to end (roadmap H2.2, doc/qaap-task-sandbox.md).
//
// Reproduces the production topology on a local Docker daemon:
//   - "control plane": THIS process runs QaapTaskSandboxBroker (compiled lib) with real Docker, and
//     opens the sandbox link to the tenant backend through a published port, as it does through
//     the tenant ingress relay in production.
//   - "tenant backend": a container with NO Docker socket, --cap-drop ALL, no-new-privileges and a
//     read-only rootfs, on a per-tenant INTERNAL network (+ an ingress network for the link). It
//     runs the compiled QaapTaskSandboxService / QaapTaskSandboxBrokerClient / QaapTenantSpawnService
//     from this checkout (bind-mounted read-only) under QAAP_TENANT_BACKEND_MODE=1.
//   - sandboxes: created by the broker on the tenant internal network (plus an enable_icc=false
//     direct-egress network, as in production), with the tenant roots bound
//     at the tenant backend's paths and the exec server from the read-only toolchain volume.
//
// Inside the tenant backend the harness, for TWO worktrees at once:
//   1. acquires a sandbox for each (startup time measured),
//   2. starts through QaapTenantSpawnService.spawn() a dev server that IGNORES its PORT and binds the
//      same hardcoded port (4545) in both sandboxes, with a different preview port per task,
//   3. requires each preview port on the tenant backend's loopback to reach ITS OWN app (preview
//      port detection retargets the expected port to the bound one),
//   4. checks process isolation (each sandbox sees only its own server), uid 1001, no capabilities,
//      no Docker socket, and that the exec token never reaches the command,
//   5. opens a terminal through wrapShellForTenant() under a real pty and requires a remote tty,
//   6. kills one dev server (group SIGTERM) and requires its port to be freed inside the sandbox,
//   7. releases both tasks (QAAP_TASK_SANDBOX_LINGER_MS=0).
// Finally this script requires both sandbox containers to be gone, and cleans up.
//
// Usage: node scripts/qaap-task-sandbox-broker-e2e.mjs [--image node:22-bookworm-slim] [--keep]
//        (needs `npm run compile` of @theia/qaap-cloud-workspace and a Docker daemon)
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LIB = join(ROOT, 'packages/qaap-cloud-workspace/lib/node');
const args = process.argv.slice(2);
const IMAGE = args.includes('--image') ? args[args.indexOf('--image') + 1] : 'node:22-bookworm-slim';
const KEEP = args.includes('--keep');
const TENANT = 'e2e-alice';
const SECRET = randomBytes(32).toString('hex');
const RUN = randomBytes(3).toString('hex');
const NAMESPACE = `qe2e${RUN}`;

process.env.QAAP_TASK_SANDBOX = '1';
process.env.QAAP_DOCKER_NAMESPACE = NAMESPACE;

const require = createRequire(join(ROOT, 'package.json'));
const Docker = require('dockerode');
require('@theia/core/shared/reflect-metadata');
const docker = new Docker();
const { QaapTaskSandboxBroker } = require(join(LIB, 'qaap-task-sandbox-broker.js'));

const docker$ = (...argv) => execFileSync('docker', argv, { encoding: 'utf8' }).trim();
const log = message => console.log(`[broker-e2e] ${message}`);

const work = realpathSync(mkdtempSync(join(tmpdir(), 'qaap-broker-e2e-')));
// mkdtemp makes the directory 0700. A rootless daemon runs as another uid than a root caller (the
// VPS run: the host loopback guard blocks the rootless uid's own 127.0.0.1 connections) and must
// traverse it to bind the tenant roots.
chmodSync(work, 0o755);
const roots = {
    repos: join(work, 'repos', TENANT), worktrees: join(work, 'worktrees', TENANT),
    parallel: join(work, 'parallel', TENANT), config: join(work, 'config', TENANT),
};
for (const dir of Object.values(roots)) {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o777);
}
mkdirSync(join(roots.config, 'agent-home', '.claude'), { recursive: true });
chmodSync(join(roots.config, 'agent-home', '.claude'), 0o777);
writeFileSync(join(roots.config, 'agent-home', '.claude', 'credentials.json'), '{"signed-in":true}\n');

const internalNet = `${NAMESPACE}-tenant`;
const ingressNet = `${NAMESPACE}-ingress`;
// Production's direct-egress bridge: it has enable_icc=false, so containers on it cannot reach each
// other. The tenant backend and every sandbox sit on it AND on the internal network; the exec server
// must be reached on the internal one (Oct 17 2026: by name, Docker DNS answered with the egress IP).
const egressNet = `${NAMESPACE}-egress`;
const tenantName = `${NAMESPACE}-backend`;
const nodeModules = realpathSync(join(ROOT, 'node_modules'));
const mountsForCode = [...new Set([ROOT, dirname(nodeModules)])];

const HARNESS = join(import.meta.dirname, 'qaap-task-sandbox-broker-e2e-harness.cjs');

async function main() {
    docker$('network', 'create', '--internal', '--label', `com.qaap.e2e=${RUN}`, internalNet);
    docker$('network', 'create', '--label', `com.qaap.e2e=${RUN}`, ingressNet);
    docker$('network', 'create', '--label', `com.qaap.e2e=${RUN}`, '-o', 'com.docker.network.bridge.enable_icc=false', egressNet);
    const backend = [
        'run', '-d', '--name', tenantName, '--label', `com.qaap.e2e=${RUN}`,
        '--network', ingressNet, '-p', '127.0.0.1::4873',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--read-only',
        '--tmpfs', '/tmp:rw,exec,nosuid,size=256m', '--user', '1000:1000',
        '-e', 'QAAP_TASK_SANDBOX=1', '-e', 'QAAP_TENANT_BACKEND_MODE=1', '-e', `QAAP_TENANT_BACKEND_SECRET=${SECRET}`,
        '-e', `QAAP_TENANT_LOGIN=${TENANT}`, '-e', 'QAAP_TASK_SANDBOX_LINGER_MS=0', '-e', 'QAAP_TASK_SANDBOX_PORT_WATCH_MS=200',
        '-e', `E2E_LIB=${LIB}`, '-e', 'NODE_ENV=development',
        ...mountsForCode.flatMap(dir => ['-v', `${dir}:${dir}:ro`]),
        '-v', `${HARNESS}:/e2e-harness.cjs:ro`,
        '-v', `${roots.repos}:/workspace/repos/users/${TENANT}`, '-v', `${roots.worktrees}:/tmp/qaap-worktrees/${TENANT}`,
        '-v', `${roots.parallel}:/tmp/qaap-parallel/${TENANT}`, '-v', `${roots.config}:/home/theia/.qaap`,
        '-w', ROOT, IMAGE, 'node', '/e2e-harness.cjs',
    ];
    docker$(...backend);
    docker$('network', 'connect', internalNet, tenantName);
    docker$('network', 'connect', egressNet, tenantName);
    const port = Number(docker$('port', tenantName, '4873/tcp').split(':').pop());
    log(`tenant backend ${tenantName} (no Docker socket, cap-drop ALL, read-only) published on 127.0.0.1:${port}`);

    const orchestrator = {
        isBackendPerTenantEnabled: () => true,
        getTenantBackendAssertionSecret: () => SECRET,
        getTenantBackendConnectionToken: () => undefined,
        listTaskSandboxContainers: async () => (await docker.listContainers({
            all: true, filters: { label: ['com.qaap.task-sandbox.broker=true', `com.qaap.namespace=${NAMESPACE}`] },
        })).map(container => ({
            tenantLogin: container.Labels['com.qaap.tenant-login'], name: container.Names[0].replace(/^\//, ''), running: container.State === 'running',
        })),
        listTenantBackendTargets: () => [{ containerId: tenantName, containerName: tenantName, host: '127.0.0.1', port, tenantLogin: TENANT }],
        taskSandboxPlacement: async () => ({
            docker, image: IMAGE, user: '1001:1001', network: internalNet, directEgressNetwork: egressNet, egressEnv: {},
            roots: [
                { kind: 'repos', backendPath: `/workspace/repos/users/${TENANT}`, hostPath: roots.repos, source: roots.repos },
                { kind: 'worktrees', backendPath: `/tmp/qaap-worktrees/${TENANT}`, hostPath: roots.worktrees, source: roots.worktrees },
                { kind: 'parallel', backendPath: `/tmp/qaap-parallel/${TENANT}`, hostPath: roots.parallel, source: roots.parallel },
                { kind: 'tenant-config', backendPath: '/home/theia/.qaap', hostPath: roots.config, source: roots.config },
            ],
        }),
    };
    const broker = new QaapTaskSandboxBroker();
    broker.orchestrator = orchestrator;
    if (!broker.isEnabled()) {
        throw new Error('broker did not enable');
    }
    broker.onStart();

    const logs = spawn('docker', ['logs', '-f', tenantName], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const onData = chunk => {
        output += chunk;
        process.stdout.write(String(chunk).split('\n').filter(Boolean).map(line => `  tenant| ${line}\n`).join(''));
    };
    logs.stdout.on('data', onData);
    logs.stderr.on('data', onData);
    const deadline = Date.now() + 180_000;
    while (!output.includes('E2E_RESULT') && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 200));
    }
    logs.kill();
    broker.onStop();
    const line = output.split('\n').find(entry => entry.startsWith('E2E_RESULT '));
    if (!line) {
        throw new Error('harness produced no result');
    }
    const result = JSON.parse(line.slice('E2E_RESULT '.length));
    if (result.error) {
        throw new Error(result.error);
    }
    let left = '';
    for (let i = 0; i < 30; i++) {
        left = docker$('ps', '-a', '--filter', `label=com.qaap.task-sandbox.broker=true`, '--filter', `label=com.qaap.tenant-login=${TENANT}`, '--format', '{{.Names}}');
        if (!left) {
            break;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    result.results['sandboxes destroyed after the tasks ended'] = { ok: !left, detail: left || undefined };
    console.log(`PASS? ${!left} sandboxes destroyed after the tasks ended`);
    const failed = Object.entries(result.results).filter(([, value]) => !value.ok);
    log(`startup of two parallel sandboxes: ${result.startupMs} ms (first run includes populating the toolchain volume)`);
    if (failed.length) {
        throw new Error(`failed checks: ${failed.map(([name]) => name).join('; ')}`);
    }
    log(`all ${Object.keys(result.results).length} checks passed`);
}

function cleanup() {
    if (KEEP) {
        log(`--keep: left ${tenantName}, networks and ${work}`);
        return;
    }
    const quiet = (...argv) => { try { execFileSync('docker', argv, { stdio: 'ignore' }); } catch { /* already gone */ } };
    const names = (() => {
        try {
            return docker$('ps', '-aq', '--filter', `label=com.qaap.tenant-login=${TENANT}`).split('\n').filter(Boolean);
        } catch {
            return [];
        }
    })();
    quiet('rm', '-f', tenantName, ...names);
    quiet('network', 'rm', internalNet, ingressNet, egressNet);
    try {
        for (const volume of docker$('volume', 'ls', '-q', '--filter', `label=com.qaap.agent-toolchain=true`).split('\n').filter(name => name.startsWith(NAMESPACE))) {
            quiet('volume', 'rm', volume);
        }
    } catch { /* none */ }
    rmSync(work, { recursive: true, force: true });
}

main().then(() => {
    cleanup();
    process.exit(0);
}, error => {
    console.error(`[broker-e2e] FAILED: ${error.message}`);
    cleanup();
    process.exit(1);
});
