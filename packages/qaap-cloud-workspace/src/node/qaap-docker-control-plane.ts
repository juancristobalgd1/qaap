// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isContainerIsolationEnabled } from './qaap-agent-spawn-identity';

/**
 * The Docker socket is a host control-plane credential, not a normal worker
 * dependency. A process that can write to a rootful Docker socket can usually
 * become host root by creating a privileged container. Hosted Qaap must
 * therefore use a rootless socket or a verified TLS endpoint (or an explicitly configured
 * supervisor once a supervisor adapter exists).
 */

export interface QaapDockerControlPlaneReadiness {
    readonly hostedRuntime: boolean;
    readonly dockerHost: string;
    readonly dockerHosts: readonly string[];
    readonly rootlessSocket: boolean;
    readonly supervisorConfigured: boolean;
    readonly ready: boolean;
    readonly fatalReason?: string;
}

/** A Docker daemon that can host one or more tenant runtimes. */
export interface QaapDockerNodeConfig {
    readonly id: string;
    readonly dockerHost: string;
    /** Address reachable by the control plane for ports published by this daemon. */
    readonly advertiseHost?: string;
    /** Per-node Docker client certificate directory; defaults to DOCKER_CERT_PATH. */
    readonly certPath?: string;
    /** Override DOCKER_TLS_VERIFY for this node. */
    readonly tlsVerify?: boolean;
    /** Host interface on the node where tenant backend ports are published. */
    readonly publishHostIp?: string;
}

const QAAP_DOCKER_NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

function isTruthy(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function isQaapHostedRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
    const cloudMode = env.QAAP_CLOUD_MODE?.trim().toLowerCase();
    return env.NODE_ENV === 'production' || (!!cloudMode && cloudMode !== 'local');
}

export function resolveDockerHost(env: NodeJS.ProcessEnv = process.env): string {
    return env.DOCKER_HOST?.trim() || (process.platform === 'win32'
        ? 'npipe:////./pipe/docker_engine'
        : 'unix:///var/run/docker.sock');
}

/**
 * Resolve the configured Docker node pool. With no pool configured, the legacy single-daemon
 * environment remains the default. Pool entries are deliberately JSON so host, TLS and advertised
 * address cannot become ambiguous when an endpoint contains a port or IPv6 address.
 */
export function resolveQaapDockerNodes(env: NodeJS.ProcessEnv = process.env): readonly QaapDockerNodeConfig[] {
    const raw = env.QAAP_DOCKER_NODES?.trim();
    if (!raw) {
        return [{
            id: 'default',
            dockerHost: resolveDockerHost(env),
            ...(env.DOCKER_CERT_PATH?.trim() ? { certPath: env.DOCKER_CERT_PATH.trim() } : {}),
            ...(env.DOCKER_TLS_VERIFY !== undefined ? { tlsVerify: isTruthy(env.DOCKER_TLS_VERIFY) } : {}),
        }];
    }
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        throw new Error('QAAP_DOCKER_NODES must be a JSON array of {id, dockerHost, advertiseHost?, certPath?, tlsVerify?, publishHostIp?} objects.');
    }
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('QAAP_DOCKER_NODES must contain at least one Docker node.');
    }
    const nodes = value.map((entry, index): QaapDockerNodeConfig => {
        if (!entry || typeof entry !== 'object') {
            throw new Error(`QAAP_DOCKER_NODES[${index}] must be an object.`);
        }
        const candidate = entry as Record<string, unknown>;
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
        const dockerHost = typeof candidate.dockerHost === 'string' ? candidate.dockerHost.trim() : '';
        const advertiseHost = typeof candidate.advertiseHost === 'string' ? candidate.advertiseHost.trim() : undefined;
        const certPath = typeof candidate.certPath === 'string' ? candidate.certPath.trim() : undefined;
        const tlsVerify = candidate.tlsVerify === undefined ? undefined : candidate.tlsVerify === true;
        const publishHostIp = typeof candidate.publishHostIp === 'string' ? candidate.publishHostIp.trim() : undefined;
        if (!QAAP_DOCKER_NODE_ID_PATTERN.test(id)) {
            throw new Error(`QAAP_DOCKER_NODES[${index}].id is invalid.`);
        }
        if (!/^(unix|npipe|tcp|http|https):\/\//i.test(dockerHost)) {
            throw new Error(`QAAP_DOCKER_NODES[${index}].dockerHost must use unix://, npipe://, tcp://, http:// or https://.`);
        }
        if (candidate.tlsVerify !== undefined && typeof candidate.tlsVerify !== 'boolean') {
            throw new Error(`QAAP_DOCKER_NODES[${index}].tlsVerify must be a boolean.`);
        }
        return {
            id,
            dockerHost,
            ...(advertiseHost ? { advertiseHost } : {}),
            ...(certPath ? { certPath } : {}),
            ...(tlsVerify !== undefined ? { tlsVerify } : {}),
            ...(publishHostIp ? { publishHostIp } : {}),
        };
    });
    const ids = new Set<string>();
    for (const node of nodes) {
        if (ids.has(node.id)) {
            throw new Error(`QAAP_DOCKER_NODES contains duplicate node id ${node.id}.`);
        }
        ids.add(node.id);
    }
    return nodes.sort((left, right) => left.id.localeCompare(right.id));
}

function resolveUnixSocketPath(dockerHost: string): string | undefined {
    if (!dockerHost.startsWith('unix://')) {
        return undefined;
    }
    return dockerHost.slice('unix://'.length).replace(/\/+$/, '') || '/';
}

function isRootlessUnixSocket(dockerHost: string): boolean {
    const socketPath = resolveUnixSocketPath(dockerHost);
    if (!socketPath) {
        return false;
    }
    // Rootless Docker defaults to /run/user/<uid>/docker.sock. Allow an
    // explicitly named non-system socket too, so installations using XDG_RUNTIME_DIR
    // or a supervisor-owned path do not need to mimic one directory layout.
    return socketPath !== '/var/run/docker.sock' && socketPath !== '/run/docker.sock';
}

function isSecureRemoteDockerNode(node: QaapDockerNodeConfig, env: NodeJS.ProcessEnv): boolean {
    const endpoint = node.dockerHost.toLowerCase();
    if (!endpoint.startsWith('tcp://') && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
        return false;
    }
    const tlsVerify = node.tlsVerify ?? isTruthy(env.DOCKER_TLS_VERIFY);
    // Remote Docker must use verified TLS and client certificates. A plaintext daemon is effectively
    // a remote root shell even when the host itself is rootless.
    return (endpoint.startsWith('https://') || tlsVerify) && !!(node.certPath || env.DOCKER_CERT_PATH?.trim());
}

/**
 * Evaluate the Docker control-plane contract without contacting Docker.
 * This is intentionally pure so launch gates and unit tests can use the same
 * policy as the runtime orchestrator.
 */
export function evaluateQaapDockerControlPlane(
    env: NodeJS.ProcessEnv = process.env,
): QaapDockerControlPlaneReadiness {
    const hostedRuntime = isQaapHostedRuntime(env);
    let nodes: readonly QaapDockerNodeConfig[];
    try {
        nodes = resolveQaapDockerNodes(env);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            hostedRuntime,
            dockerHost: resolveDockerHost(env),
            dockerHosts: [],
            rootlessSocket: false,
            supervisorConfigured: isTruthy(env.QAAP_DOCKER_SUPERVISOR),
            ready: false,
            fatalReason: `Refusing Docker control-plane configuration: ${message}`,
        };
    }
    const dockerHost = nodes[0]?.dockerHost ?? resolveDockerHost(env);
    const dockerHosts = nodes.map(node => node.dockerHost);
    const rootlessSocket = nodes.length > 0 && nodes.every(node => isRootlessUnixSocket(node.dockerHost));
    const secureRemoteNodes = nodes.length > 0 && nodes.every(node => isSecureRemoteDockerNode(node, env));
    const allNodesSafe = nodes.length > 0 && nodes.every(node => isRootlessUnixSocket(node.dockerHost) || isSecureRemoteDockerNode(node, env));
    const supervisorConfigured = isTruthy(env.QAAP_DOCKER_SUPERVISOR);

    if (!hostedRuntime) {
        return { hostedRuntime, dockerHost, dockerHosts, rootlessSocket, supervisorConfigured, ready: true };
    }
    if (rootlessSocket || secureRemoteNodes || allNodesSafe) {
        return { hostedRuntime, dockerHost, dockerHosts, rootlessSocket, supervisorConfigured, ready: true };
    }
    const detail = supervisorConfigured
        ? 'QAAP_DOCKER_SUPERVISOR is set but no supervisor adapter is wired into the orchestrator yet'
        : nodes.some(node => /^(tcp|http):\/\//i.test(node.dockerHost))
        ? nodes.length === 1 && /^tcp:\/\//i.test(nodes[0].dockerHost)
            ? 'unencrypted TCP Docker endpoints are not accepted'
            : 'remote Docker endpoints require verified TLS and DOCKER_CERT_PATH (or a per-node certPath)'
        : dockerHost.startsWith('npipe://')
            ? 'Windows named-pipe Docker control is only supported for local development'
            : `Docker host ${dockerHost} is not a rootless Unix socket`;
    return {
        hostedRuntime,
        dockerHost,
        dockerHosts,
        rootlessSocket,
        supervisorConfigured,
        ready: false,
        fatalReason: `Refusing hosted Docker control-plane access: ${detail}. `
            + 'Configure rootless Unix sockets or verified TLS Docker endpoints. Rootful Docker is never accepted in hosted mode.',
    };
}

export function assertQaapDockerControlPlane(
    env: NodeJS.ProcessEnv = process.env,
): void {
    const readiness = evaluateQaapDockerControlPlane(env);
    if (!readiness.ready) {
        throw new Error(readiness.fatalReason);
    }
}

/**
 * Public-host admission policy: a production backend must not silently fall back to host-side
 * process/UID isolation. The worker container is the boundary for tenant code, terminals and jobs.
 */
export function assertQaapHostedTenantIsolation(
    env: NodeJS.ProcessEnv = process.env,
): void {
    if (!isQaapHostedRuntime(env)) {
        return;
    }
    if (!isContainerIsolationEnabled(env)) {
        throw new Error(
            'Refusing hosted Qaap startup without container-per-tenant isolation. '
            + 'Set QAAP_CLOUD_MODE=docker or QAAP_TENANT_CONTAINER_ISOLATION=1; '
            + 'use QAAP_CLOUD_MODE=local only for single-user development.',
        );
    }
    assertQaapDockerControlPlane(env);
}
