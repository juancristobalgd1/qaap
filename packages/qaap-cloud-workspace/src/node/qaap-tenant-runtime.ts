// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** OCI runtime for containers that run tenant or agent code: the default `runc`, or gVisor `runsc`. */
export type QaapTenantRuntime = 'runc' | 'runsc';

/**
 * Resolves `QAAP_TENANT_RUNTIME`. Unset or blank means `runc`, the current behaviour. Only the exact
 * values `runc` and `runsc` are accepted: any other value throws, so a typo can never silently run
 * tenant code under a weaker runtime than the operator asked for (fail closed).
 * @param env the environment to read, `process.env` by default.
 * @returns the selected runtime.
 */
export function resolveQaapTenantRuntime(env: NodeJS.ProcessEnv = process.env): QaapTenantRuntime {
    const raw = env.QAAP_TENANT_RUNTIME?.trim();
    if (raw === undefined || raw === '') {
        return 'runc';
    }
    if (raw === 'runc' || raw === 'runsc') {
        return raw;
    }
    throw new Error(`Unsupported QAAP_TENANT_RUNTIME=${raw}: use runc (default) or runsc (gVisor).`);
}

/**
 * Startup validation of the tenant runtime settings: an unsupported runtime, or a tenant daemon socket
 * combined with a multi-node QAAP_DOCKER_NODES list, stops the backend before any tenant starts.
 * @param env the environment to read, `process.env` by default.
 */
export function validateQaapTenantRuntimeEnv(env: NodeJS.ProcessEnv = process.env): void {
    resolveQaapTenantRuntime(env);
    if (resolveQaapTenantDockerHost(env) && env.QAAP_DOCKER_NODES?.trim()) {
        throw new Error('QAAP_TENANT_DOCKER_HOST cannot be combined with QAAP_DOCKER_NODES: set dockerHost on the tenant node in QAAP_DOCKER_NODES instead.');
    }
}

/**
 * Optional socket of the Docker daemon that runs tenant containers (`QAAP_TENANT_DOCKER_HOST`), used
 * when the gVisor daemon is separate from the control-plane daemon. Undefined keeps the node's own host.
 * @param env the environment to read, `process.env` by default.
 * @returns the tenant daemon host, or undefined when not configured.
 */
export function resolveQaapTenantDockerHost(env: NodeJS.ProcessEnv = process.env): string | undefined {
    return env.QAAP_TENANT_DOCKER_HOST?.trim() || undefined;
}
