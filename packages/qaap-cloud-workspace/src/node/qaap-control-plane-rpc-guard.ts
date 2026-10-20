// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import { inject, injectable } from '@theia/core/shared/inversify';
import { WsRequestValidatorContribution } from '@theia/core/lib/node/ws-request-validators';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { isQaapHostedRuntime } from './qaap-docker-control-plane';

/** Server-side mark (never settable by a client) on a request the tenant proxy is forwarding. */
const ROUTED_TO_TENANT_BACKEND = Symbol('qaapRoutedToTenantBackend');

/**
 * Keeps Theia's RPC services (terminals, TaskServer, debug, search, ...) off the hosted control
 * plane, which mounts the Docker socket.
 *
 * Those services have no tenant guard of their own: in a hosted runtime they are meant to run only
 * inside a per-tenant backend. With `QAAP_BACKEND_PER_TENANT=1` the tenant proxy forwards every
 * authenticated Socket.IO request (polling and upgrade) to the caller's backend before the control
 * plane's own Socket.IO server sees it, so any handshake that still reaches it is refused. Without
 * the per-tenant backend the control plane would run those services for every signed-in user, so
 * the handshake is refused too. `QaapProductionAuthReadiness` already refuses to boot such a
 * runtime once logins are admitted; this is the request-time backstop.
 *
 * The tenant proxy runs the same validator chain as an outer check before it forwards a request;
 * it marks those requests with {@link QaapControlPlaneRpcGuard.markRoutedToTenantBackend} first.
 *
 * Exception: `QAAP_TENANT_PROXY_EARLY_ROUTING=0` (operator fallback) leaves Socket.IO polling on
 * the control plane, so the guard lets authenticated handshakes through there and warns once.
 * Local mode and tenant backends are unaffected.
 */
@injectable()
export class QaapControlPlaneRpcGuard implements WsRequestValidatorContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    protected earlyRoutingFallbackWarned = false;

    /** Called by the tenant proxy for a request it forwards to the caller's tenant backend. */
    static markRoutedToTenantBackend(request: http.IncomingMessage): void {
        (request as http.IncomingMessage & { [ROUTED_TO_TENANT_BACKEND]?: true })[ROUTED_TO_TENANT_BACKEND] = true;
    }

    allowWsUpgrade(request: http.IncomingMessage): boolean {
        if (!isQaapHostedRuntime(process.env) || isQaapTenantBackendMode(process.env)) {
            return true;
        }
        if ((request as http.IncomingMessage & { [ROUTED_TO_TENANT_BACKEND]?: true })[ROUTED_TO_TENANT_BACKEND]) {
            return true;
        }
        if (!this.isBackendPerTenantEnabled()) {
            return this.deny(request, 'backend_per_tenant_disabled');
        }
        if (!this.isEarlyRequestRoutingEnabled()) {
            if (!this.earlyRoutingFallbackWarned) {
                this.earlyRoutingFallbackWarned = true;
                this.auth.logSecurityEvent('control_plane_rpc_fallback', {
                    reason: 'QAAP_TENANT_PROXY_EARLY_ROUTING=0 keeps Socket.IO polling on the control plane',
                });
            }
            return true;
        }
        return this.deny(request, 'not_routed_to_tenant_backend');
    }

    protected deny(request: http.IncomingMessage, reason: string): false {
        this.auth.logSecurityEvent('control_plane_rpc_denied', {
            reason,
            path: (request.url ?? '/').split('?', 1)[0],
        });
        return false;
    }

    /** Same switch the tenant proxy and the orchestrator route by. */
    protected isBackendPerTenantEnabled(): boolean {
        return /^(1|true)$/i.test(process.env.QAAP_BACKEND_PER_TENANT?.trim() ?? '');
    }

    protected isEarlyRequestRoutingEnabled(): boolean {
        return !/^(0|false|off|no)$/i.test(process.env.QAAP_TENANT_PROXY_EARLY_ROUTING?.trim() ?? '');
    }
}
