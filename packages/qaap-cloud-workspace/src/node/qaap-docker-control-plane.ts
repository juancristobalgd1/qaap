// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isContainerIsolationEnabled } from './qaap-agent-spawn-identity';

/**
 * The Docker socket is a host control-plane credential, not a normal worker
 * dependency. A process that can write to a rootful Docker socket can usually
 * become host root by creating a privileged container. Hosted Qaap must
 * therefore use a rootless socket (or an explicitly configured supervisor).
 */

export interface QaapDockerControlPlaneReadiness {
    readonly hostedRuntime: boolean;
    readonly dockerHost: string;
    readonly rootlessSocket: boolean;
    readonly supervisorConfigured: boolean;
    readonly ready: boolean;
    readonly fatalReason?: string;
}

function isTruthy(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function isQaapHostedRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
    const cloudMode = env.QAAP_CLOUD_MODE?.trim().toLowerCase();
    return env.NODE_ENV === 'production' || (!!cloudMode && cloudMode !== 'local');
}

function resolveDockerHost(env: NodeJS.ProcessEnv): string {
    return env.DOCKER_HOST?.trim() || (process.platform === 'win32'
        ? 'npipe:////./pipe/docker_engine'
        : 'unix:///var/run/docker.sock');
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

/**
 * Evaluate the Docker control-plane contract without contacting Docker.
 * This is intentionally pure so launch gates and unit tests can use the same
 * policy as the runtime orchestrator.
 */
export function evaluateQaapDockerControlPlane(
    env: NodeJS.ProcessEnv = process.env,
): QaapDockerControlPlaneReadiness {
    const hostedRuntime = isQaapHostedRuntime(env);
    const dockerHost = resolveDockerHost(env);
    const rootlessSocket = isRootlessUnixSocket(dockerHost);
    const supervisorConfigured = isTruthy(env.QAAP_DOCKER_SUPERVISOR);

    if (!hostedRuntime) {
        return { hostedRuntime, dockerHost, rootlessSocket, supervisorConfigured, ready: true };
    }
    if (rootlessSocket) {
        return { hostedRuntime, dockerHost, rootlessSocket, supervisorConfigured, ready: true };
    }
    const detail = supervisorConfigured
        ? 'QAAP_DOCKER_SUPERVISOR is set but no supervisor adapter is wired into the orchestrator yet'
        : dockerHost.startsWith('tcp://')
        ? 'unencrypted TCP Docker endpoints are not accepted'
        : dockerHost.startsWith('npipe://')
            ? 'Windows named-pipe Docker control is only supported for local development'
            : `Docker host ${dockerHost} is not a rootless Unix socket`;
    return {
        hostedRuntime,
        dockerHost,
        rootlessSocket,
        supervisorConfigured,
        ready: false,
        fatalReason: `Refusing hosted Docker control-plane access: ${detail}. `
            + 'Configure DOCKER_HOST to a rootless socket. Rootful Docker is never accepted in hosted mode.',
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
