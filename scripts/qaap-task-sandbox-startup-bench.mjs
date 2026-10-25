#!/usr/bin/env node
// Startup benchmark of broker-mode task sandboxes (doc/qaap-task-sandbox.md, "Startup budget").
//
// Drives the compiled QaapTaskSandboxBroker against a real Docker daemon with a stub orchestrator
// (as the broker e2e does) and times what a task waits for in `create`:
//   - first: the first sandbox after the control plane starts, with an empty toolchain volume
//     (a fresh namespace per run, as after every deploy). With toolchain prewarm, `onStart`
//     populates it before any task arrives, so this run waits for the prewarm first and reports
//     the prewarm time separately (off the task's path).
//   - next:  later sandboxes of the same tenant, each on a new worktree. With the spare sandbox, a
//     `prepare` from the tenant backend (sent when its link comes up) and every create leave one
//     ready sandbox behind, so these adopt it.
// Each iteration waits for the broker's background work (spare replenish) before the next create,
// as a real task arrives seconds after the previous one.
//
// Usage: node scripts/qaap-task-sandbox-startup-bench.mjs [--image node:22-bookworm-slim] [--runs 5] [--label before]
//        (needs `npm run compile` of @theia/qaap-cloud-workspace and a Docker daemon)
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LIB = join(ROOT, 'packages/qaap-cloud-workspace/lib/node');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const IMAGE = option('--image', 'node:22-bookworm-slim');
const RUNS = Number(option('--runs', '5'));
const LABEL = option('--label', 'run');
const TENANT = 'bench-alice';
const RUN = randomBytes(3).toString('hex');
const NAMESPACE = `qbench${RUN}`;

process.env.QAAP_TASK_SANDBOX = '1';
process.env.QAAP_DOCKER_NAMESPACE = NAMESPACE;

const require = createRequire(join(ROOT, 'package.json'));
const Docker = require('dockerode');
require('@theia/core/shared/reflect-metadata');
const docker = new Docker();
const { QaapTaskSandboxBroker } = require(join(LIB, 'qaap-task-sandbox-broker.js'));
const docker$ = (...argv) => execFileSync('docker', argv, { encoding: 'utf8' }).trim();
const quiet = (...argv) => { try { execFileSync('docker', argv, { stdio: 'ignore' }); } catch { /* already gone */ } };

const work = realpathSync(mkdtempSync(join(tmpdir(), 'qaap-sandbox-bench-')));
chmodSync(work, 0o755);
const roots = {
    repos: join(work, 'repos', TENANT), worktrees: join(work, 'worktrees', TENANT),
    parallel: join(work, 'parallel', TENANT), config: join(work, 'config', TENANT),
};
for (const dir of Object.values(roots)) {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o777);
}
const internalNet = `${NAMESPACE}-tenant`;
const egressNet = `${NAMESPACE}-egress`;
const homeLinks = [{ name: '.claude', target: '/home/theia/.qaap/agent-home/.claude' }];

const placement = {
    docker, image: IMAGE, user: '1001:1001', network: internalNet, directEgressNetwork: egressNet, egressEnv: {},
    roots: [
        { kind: 'repos', backendPath: `/workspace/repos/users/${TENANT}`, hostPath: roots.repos, source: roots.repos },
        { kind: 'worktrees', backendPath: `/tmp/qaap-worktrees/${TENANT}`, hostPath: roots.worktrees, source: roots.worktrees },
        { kind: 'parallel', backendPath: `/tmp/qaap-parallel/${TENANT}`, hostPath: roots.parallel, source: roots.parallel },
        { kind: 'tenant-config', backendPath: '/home/theia/.qaap', hostPath: roots.config, source: roots.config },
    ],
};
const orchestrator = {
    isBackendPerTenantEnabled: () => true,
    getTenantBackendAssertionSecret: () => 'x'.repeat(64),
    getTenantBackendConnectionToken: () => undefined,
    listTenantBackendTargets: () => [],
    listTaskSandboxContainers: async () => [],
    taskSandboxPlacement: async () => placement,
    taskSandboxToolchainPlacements: async () => [{ docker, image: IMAGE, nodeId: 'default' }],
};

const percentile = (values, quantile) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(quantile * sorted.length))) - 1];
};

async function main() {
    docker$('network', 'create', '--internal', '--label', `com.qaap.bench=${RUN}`, internalNet);
    docker$('network', 'create', '--label', `com.qaap.bench=${RUN}`, '-o', 'com.docker.network.bridge.enable_icc=false', egressNet);
    const broker = new QaapTaskSandboxBroker();
    broker.orchestrator = orchestrator;
    const bootAt = Date.now();
    // syncLinks/sweep timers are harmless here (no targets); onStart is where the prewarm starts.
    broker.onStart();
    // Absent before the toolchain prewarm existed: the first create then populates the volume itself.
    const prewarmMs = broker.toolchainPrewarm ? (await broker.toolchainPrewarm, Date.now() - bootAt) : undefined;
    // The tenant backend's link-up `prepare` (ignored by a broker that does not know the op).
    await broker.handle(TENANT, { op: 'prepare', args: { homeLinks } }).catch(() => undefined);
    const settle = () => broker.withTenantLock(TENANT, async () => undefined);
    await settle();

    const samples = [];
    for (let index = 0; index < RUNS; index++) {
        const root = `/tmp/qaap-worktrees/${TENANT}/wt-${index}`;
        mkdirSync(join(roots.worktrees, `wt-${index}`), { recursive: true });
        const started = Date.now();
        const sandbox = await broker.create(TENANT, { root, homeLinks });
        samples.push({ ms: Date.now() - started, startupMs: sandbox.startupMs, source: sandbox.source ?? 'cold' });
        await settle();
        // Keep under the per-tenant cap: the task ended (linger 0).
        await broker.destroy(TENANT, { name: sandbox.name });
    }
    broker.onStop();
    const [first, ...next] = samples;
    const nextMs = next.map(sample => sample.ms);
    const report = {
        label: LABEL, image: IMAGE, runs: RUNS,
        prewarmMs,
        firstCreateMs: first.ms, firstSource: first.source,
        nextCreateP50Ms: nextMs.length ? percentile(nextMs, 0.5) : undefined,
        nextCreateMaxMs: nextMs.length ? Math.max(...nextMs) : undefined,
        nextSources: [...new Set(next.map(sample => sample.source))],
        samples: samples.map(sample => sample.ms),
    };
    console.log(`BENCH_RESULT ${JSON.stringify(report)}`);
}

function cleanup() {
    try {
        const names = docker$('ps', '-aq', '--filter', `label=com.qaap.namespace=${NAMESPACE}`).split('\n').filter(Boolean);
        quiet('rm', '-f', ...names);
    } catch { /* none */ }
    quiet('network', 'rm', internalNet, egressNet);
    try {
        for (const volume of docker$('volume', 'ls', '-q', '--filter', 'label=com.qaap.agent-toolchain=true').split('\n').filter(name => name.startsWith(NAMESPACE))) {
            quiet('volume', 'rm', volume);
        }
    } catch { /* none */ }
    rmSync(work, { recursive: true, force: true });
}

main().then(() => {
    cleanup();
    process.exit(0);
}, error => {
    console.error(`[sandbox-bench] FAILED: ${error.stack ?? error.message}`);
    cleanup();
    process.exit(1);
});
