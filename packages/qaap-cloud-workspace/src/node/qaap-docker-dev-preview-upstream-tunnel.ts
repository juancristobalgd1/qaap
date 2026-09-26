// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { QaapExecDevPreviewUpstreamTunnel } from '@theia/qaap-shared-core/lib/node/qaap-dev-preview-upstream-tunnel';
import type { QaapExecTunnelLaunch } from '@theia/qaap-shared-core/lib/node/qaap-exec-tunnel-socket';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';

/**
 * Reaches dev servers inside a tenant's worker container (`QAAP_CLOUD_MODE=docker`).
 *
 * Agent shells, terminals and preview runs of such a tenant are `docker exec`-ed into its worker,
 * so their servers listen on the WORKER's loopback: another network namespace, on a per-tenant
 * bridge with inter-container traffic disabled. The preview proxy in this process therefore
 * probes and relays through a bridge started with the very same `docker exec` wrapper
 * ({@link QaapDockerOrchestrator.wrapShellForTenantContainer}) the tenant's commands use.
 *
 * Inert where commands run locally (a tenant backend has `QAAP_CLOUD_MODE=local`, local dev).
 */
@injectable()
export class QaapDockerDevPreviewUpstreamTunnel extends QaapExecDevPreviewUpstreamTunnel {

    @inject(QaapDockerOrchestrator)
    protected readonly docker: QaapDockerOrchestrator;

    handles(ownerLogin: string): boolean {
        return ownerLogin.trim().length > 0 && this.docker.isEnabled();
    }

    protected wrapRuntimeCommand(ownerLogin: string, command: readonly string[]): QaapExecTunnelLaunch {
        const root = this.docker.tenantRootForLogin(ownerLogin);
        const [file, ...args] = command;
        // No environment argument: the docker CLI inherits this process' env (DOCKER_HOST, …) and
        // nothing is copied into the worker.
        const wrapped = this.docker.wrapShellForTenantContainer(ownerLogin, root, file, args, root);
        return { file: wrapped.file, args: wrapped.args };
    }
}
