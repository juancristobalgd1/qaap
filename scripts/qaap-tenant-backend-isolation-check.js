#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
/* eslint-disable no-console */
'use strict';

// qaap-tenant-backend-isolation-check.js — backend-per-tenant evidence check for the VPS launch gate.
//
// Reads `docker inspect <backend-A> <backend-B>` JSON on stdin and verifies, for two DISTINCT tenants,
// the isolation contract the orchestrator creates (qaap-docker-orchestrator.ts
// createOrValidateTenantBackend): Qaap-managed labels bound to the tenant login, non-root user, no
// privileges/capabilities, read-only rootfs, no host namespaces, only the tenant's own five mounts
// (never the Docker socket), no control-plane secrets in the environment, per-tenant HMAC secret,
// and no storage or network shared between the two tenants.
//
//   docker inspect A B | node scripts/qaap-tenant-backend-isolation-check.js <login-A> <login-B> [rootless]
//
// Secret values are compared but never printed. Exit 0 only when every check passes.

// The launch gate runs this inside the Theia container via `node -e <source> A B`, where argv has
// no script entry; as a file (`node check.js A B`) the arguments start one slot later.
const [loginA, loginB, daemonMode] = process.argv.slice(require.main === module ? 2 : 1).map(value => String(value || '').trim().toLowerCase());
// Container uid 0 is only acceptable on a verified rootless daemon, where it maps to the unprivileged
// daemon owner (the orchestrator's QAAP_DOCKER_ROOTLESS + QAAP_TENANT_CONTAINER_UID=0 policy).
const rootlessDaemon = daemonMode === 'rootless';

const CONTROL_PLANE_ENV = [
    'QAAP_TENANT_BACKEND_MASTER_SECRET', 'DOCKER_HOST', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'DOCKER_CONTEXT',
    'QAAP_DOCKER_NODES', 'QAAP_DOCKER_SOCKET_SOURCE', 'QAAP_GITHUB_CLIENT_SECRET', 'QAAP_SESSION_SECRET',
    'QAAP_COOKIE_SECRET', 'QAAP_JWT_SECRET', 'QAAP_VAPID_PRIVATE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'QAAP_TENANT_UID_REGISTRY_PATH', 'QAAP_DATABASE_URL', 'QAAP_REDIS_URL',
];

let failures = 0;
const ok = message => console.log(`  OK   ${message}`);
const bad = message => {
    console.error(`  FAIL ${message}`);
    failures++;
};

/** Mirror of safeUserIdSegment(login).toLowerCase() used for the tenant mount destinations. */
const segment = login => (login.replace(/[^A-Za-z0-9_.-]/g, '_') || '_unknown').toLowerCase();

const envMap = container => {
    const map = new Map();
    for (const entry of container.Config?.Env ?? []) {
        const index = entry.indexOf('=');
        if (index > 0) {
            map.set(entry.slice(0, index), entry.slice(index + 1));
        }
    }
    return map;
};

const normalizePath = value => String(value || '').replace(/\/+$/, '') || '/';
const nested = (left, right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

function checkBackend(container, login) {
    const label = `backend ${String(container.Name || '').replace(/^\//, '') || '?'} (${login})`;
    const labels = container.Config?.Labels ?? {};
    const hostConfig = container.HostConfig ?? {};
    const env = envMap(container);
    const user = String(container.Config?.User ?? '').trim();
    const mounts = container.Mounts ?? [];
    const seg = segment(login);
    const expectedDestinations = [
        `/workspace/repos/users/${seg}`, `/tmp/qaap-worktrees/${seg}`, `/tmp/qaap-parallel/${seg}`,
        '/home/theia/.qaap', '/home/theia/.theia',
    ];
    const problems = [];
    if (labels['com.qaap.managed'] !== 'true' || labels['com.qaap.tenant-backend'] !== 'true') {
        problems.push('not a Qaap-managed tenant backend');
    }
    if (labels['com.qaap.tenant-login'] !== login || String(env.get('QAAP_TENANT_LOGIN') ?? '').toLowerCase() !== login) {
        problems.push('tenant label/QAAP_TENANT_LOGIN does not match the tenant');
    }
    if (env.get('QAAP_TENANT_BACKEND_MODE') !== '1' || !env.get('QAAP_TENANT_BACKEND_SECRET')) {
        problems.push('not running in tenant-backend mode with a tenant secret');
    }
    if (!user || (/^(0|root)(:|$)/.test(user) && !rootlessDaemon)) {
        problems.push(`runs as root on a daemon not verified as rootless (User='${user}')`);
    }
    if (hostConfig.Privileged === true) {
        problems.push('privileged');
    }
    if (!(hostConfig.CapDrop ?? []).some(cap => String(cap).toUpperCase() === 'ALL') || (hostConfig.CapAdd ?? []).length > 0) {
        problems.push('capabilities not fully dropped');
    }
    if (!(hostConfig.SecurityOpt ?? []).some(opt => opt === 'no-new-privileges:true' || opt === 'no-new-privileges')) {
        problems.push('no-new-privileges missing');
    }
    if (hostConfig.ReadonlyRootfs !== true) {
        problems.push('root filesystem is writable');
    }
    for (const key of ['NetworkMode', 'PidMode', 'IpcMode', 'UTSMode', 'UsernsMode']) {
        if (hostConfig[key] === 'host') {
            problems.push(`${key}=host`);
        }
    }
    if (mounts.some(mount => /docker\.sock/.test(`${mount.Source ?? ''} ${mount.Destination ?? ''}`))) {
        problems.push('Docker socket is mounted');
    }
    const destinations = mounts.map(mount => normalizePath(mount.Destination));
    if (mounts.length !== expectedDestinations.length || !expectedDestinations.every(dest => destinations.includes(dest))) {
        problems.push(`unexpected mounts (${destinations.join(', ') || 'none'})`);
    }
    const leaked = CONTROL_PLANE_ENV.filter(key => env.has(key));
    if (leaked.length) {
        problems.push(`control-plane environment leaked: ${leaked.join(', ')}`);
    }
    if (problems.length) {
        bad(`${label}: ${problems.join('; ')}`);
    } else {
        ok(`${label}: ${/^(0|root)(:|$)/.test(user) ? 'rootless-mapped uid 0' : 'non-root'}, no privileges, read-only rootfs, only its own mounts, no control-plane secrets`);
    }
}

let containers;
try {
    containers = JSON.parse(require('fs').readFileSync(0, 'utf8'));
} catch (error) {
    bad(`could not parse docker inspect output (${error.message})`);
    process.exit(1);
}

if (!loginA || !loginB || loginA === loginB) {
    bad('two distinct tenant logins are required');
} else if (!Array.isArray(containers) || containers.length !== 2) {
    bad(`expected exactly two tenant backend containers, got ${Array.isArray(containers) ? containers.length : 'none'}`);
} else {
    const [a, b] = containers;
    checkBackend(a, loginA);
    checkBackend(b, loginB);

    const sourcesA = (a.Mounts ?? []).map(mount => normalizePath(mount.Source));
    const sourcesB = (b.Mounts ?? []).map(mount => normalizePath(mount.Source));
    const shared = sourcesA.filter(left => sourcesB.some(right => nested(left, right)));
    if (shared.length) {
        bad(`tenants share host storage: ${shared.join(', ')}`);
    } else {
        ok('tenant backends share no host storage');
    }

    const networkA = a.HostConfig?.NetworkMode;
    const networkB = b.HostConfig?.NetworkMode;
    if (networkA && networkA !== 'none' && networkA === networkB) {
        bad(`tenant backends share Docker network ${networkA}`);
    } else {
        ok('tenant backends do not share a Docker network');
    }

    const secretA = envMap(a).get('QAAP_TENANT_BACKEND_SECRET');
    if (secretA && secretA === envMap(b).get('QAAP_TENANT_BACKEND_SECRET')) {
        bad('tenant backends share the same tenant secret');
    } else {
        ok('tenant backend secrets are distinct');
    }
}

process.exit(failures > 0 ? 1 : 0);
