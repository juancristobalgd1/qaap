// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import * as os from 'os';
import { isQaapDesktopRuntime } from '@theia/qaap-adapters/lib/common/qaap-desktop-runtime';
import { isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { resolveQaapReposRoot, resolveUserReposRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapTenantSpawnService } from '../qaap-tenant-spawn-service';
import type { QaapUsageAgentIdentity } from './qaap-usage-file-access';
import { QaapUsageRoots } from './qaap-usage-roots';

/** Whose logs one usage scan reads: the agent CLI directories and, when it differs from ours, the agent's identity. */
export interface QaapUsageScanTarget {
    /** Identifies the target; scans with equal keys share one ledger. */
    readonly key: string;
    readonly roots: QaapUsageRoots;
    /** Set when the agents run as another uid: their logs are then read as that uid. */
    readonly identity?: QaapUsageAgentIdentity;
}

export namespace QaapUsageScanTarget {

    /**
     * The target for agents spawned with `homeOverlay` (the HOME/XDG overlay the runner and the terminals add to
     * every agent child) as `spawnIdentity`. With no overlay the agents share this process's home, as on desktop.
     */
    export function fromSpawnEnv(options: {
        readonly env: NodeJS.ProcessEnv;
        readonly backendHome: string;
        readonly homeOverlay: Readonly<Record<string, string | undefined>>;
        readonly spawnIdentity: { readonly uid?: number; readonly gid?: number };
        readonly currentUid: number | undefined;
    }): QaapUsageScanTarget {
        const roots = QaapUsageRoots.resolveForSpawnEnv(options.env, options.homeOverlay, options.backendHome);
        const uid = options.spawnIdentity.uid;
        const identity = uid !== undefined && uid > 0 && uid !== options.currentUid
            ? { uid, gid: options.spawnIdentity.gid ?? uid }
            : undefined;
        return { key: JSON.stringify({ roots, identity }), roots, identity };
    }

    /** The backend's own home, read with its own permissions (desktop and plain local runs). */
    export function ownHome(env: NodeJS.ProcessEnv, backendHome: string): QaapUsageScanTarget {
        const roots = QaapUsageRoots.resolve(env, backendHome);
        return { key: JSON.stringify({ roots }), roots };
    }
}

/**
 * Resolves where the signed-in owner's agents keep their logs, with the same resolution the agent runner and
 * the terminals use for the spawn env (`QaapTenantSpawnService.tenantHomeEnvOverlay` / `resolveSpawnIdentity`
 * for the owner's repos root):
 *
 * - desktop: the user's own home, unchanged;
 * - per-tenant backend: the tenant agent HOME (`/tmp/qaap-home`, whose CLI entries link to the persistent
 *   `<storage root>/home`) and `XDG_DATA_HOME=<storage root>/data`, read as `QAAP_AGENT_UID`;
 * - uid-per-user shared backend: the owner's private tenant HOME, read as the owner's uid;
 * - shared agent uid (`QAAP_AGENT_UID`): the shared agent HOME, read as that uid;
 * - container-routed workers: their HOME is inside the worker, so the backend home is kept.
 */
@injectable()
export class QaapUsageScanTargetResolver {

    @inject(QaapTenantSpawnService) @optional()
    protected readonly tenantSpawn: QaapTenantSpawnService | undefined;

    protected env(): NodeJS.ProcessEnv {
        return process.env;
    }

    protected backendHome(): string {
        return os.homedir();
    }

    protected currentUid(): number | undefined {
        return typeof process.getuid === 'function' ? process.getuid() : undefined;
    }

    protected ownerCwd(ownerLogin: string | undefined): string {
        const reposRoot = resolveQaapReposRoot();
        return ownerLogin?.trim() ? resolveUserReposRoot(reposRoot, ownerLogin) : reposRoot;
    }

    resolve(ownerLogin: string | undefined): QaapUsageScanTarget {
        const env = this.env();
        const backendHome = this.backendHome();
        const tenantSpawn = this.tenantSpawn;
        if (!tenantSpawn || isQaapDesktopRuntime(env)) {
            return QaapUsageScanTarget.ownHome(env, backendHome);
        }
        if (!isQaapTenantBackendMode(env) && tenantSpawn.isContainerIsolationEnabled()) {
            return QaapUsageScanTarget.ownHome(env, backendHome);
        }
        const cwd = this.ownerCwd(ownerLogin);
        try {
            return QaapUsageScanTarget.fromSpawnEnv({
                env,
                backendHome,
                homeOverlay: tenantSpawn.tenantHomeEnvOverlay(cwd),
                spawnIdentity: tenantSpawn.resolveSpawnIdentity(cwd),
                currentUid: this.currentUid(),
            });
        } catch (error) {
            // The runner would refuse to spawn here too (e.g. no non-root agent uid configured): no agent logs exist.
            console.warn('[qaap-usage] could not resolve the agent home; reading the backend home instead:', error instanceof Error ? error.message : error);
            return QaapUsageScanTarget.ownHome(env, backendHome);
        }
    }
}
