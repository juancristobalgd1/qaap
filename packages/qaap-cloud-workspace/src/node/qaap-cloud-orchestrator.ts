// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type {
    QaapCloudWorkspaceEnsureRequest,
    QaapCloudWorkspaceSummary,
} from '../common/qaap-cloud-api-types';
import { QaapCloudWorkspaceStore } from './qaap-cloud-workspace-store';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { QaapTenantRuntimeStore } from './qaap-tenant-runtime-store';

@injectable()
export class QaapCloudOrchestrator {

    @inject(QaapCloudWorkspaceStore)
    protected readonly store: QaapCloudWorkspaceStore;

    @inject(QaapDockerOrchestrator)
    protected readonly docker: QaapDockerOrchestrator;

    @inject(QaapTenantRuntimeStore)
    protected readonly runtime: QaapTenantRuntimeStore;

    async ensure(request: QaapCloudWorkspaceEnsureRequest, ownerLogin?: string): Promise<QaapCloudWorkspaceSummary> {
        if (!request.workspaceUri) {
            return this.store.ensure(request, ownerLogin);
        }
        if (!this.docker.isEnabled()) {
            return this.store.ensure(request, ownerLogin);
        }
        try {
            // One tenant container owns all repositories/worktrees for the login. Do not create a
            // repo-scoped container here: the agent/terminal runner must target the exact same
            // lifecycle and the mount must stop at the tenant root.
            const tenantTarget = this.docker.tenantTargetForWorkspace(request.workspaceUri);
            const runtimeLogin = ownerLogin || tenantTarget.segment;
            this.runtime.setState(runtimeLogin, 'starting', {
                lastActivityAt: new Date().toISOString(),
                idleSince: undefined,
                stoppedAt: undefined,
                destroyAfter: undefined,
            });
            // The canonical path segment is the tenancy key used by the spawn service as well. This
            // keeps authenticated and skip-auth flows from deriving different container names.
            const dockerResult = await this.docker.ensureTenantContainer(tenantTarget.segment, tenantTarget.root);
            this.runtime.setState(runtimeLogin, 'active', {
                workerContainerId: dockerResult.containerId,
                lastActivityAt: new Date().toISOString(),
                idleSince: undefined,
                stoppedAt: undefined,
                destroyAfter: undefined,
                lastError: undefined,
            });
            return this.store.ensureWithContainer(request, {
                containerRef: dockerResult.containerId,
                status: 'ready',
                provider: 'docker',
            }, ownerLogin);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (ownerLogin) {
                this.runtime.setState(ownerLogin, 'error', { lastError: message });
            }
            return this.store.ensureWithContainer(request, {
                status: 'error',
                provider: 'docker',
                error: message,
            }, ownerLogin);
        }
    }
}
