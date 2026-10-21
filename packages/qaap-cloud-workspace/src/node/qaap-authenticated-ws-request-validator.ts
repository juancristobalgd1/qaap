// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { WsRequestValidatorContribution } from '@theia/core/lib/node/ws-request-validators';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { isQaapHostedOrTenantBackendRuntime } from './qaap-docker-control-plane';
import { QaapSecurityLogRateLimiter } from './qaap-security-log-rate-limiter';

/**
 * Refuses the Theia Socket.IO handshake (both the polling request and the WebSocket upgrade) of
 * an unauthenticated caller in a hosted runtime.
 *
 * Theia's own validators only check the Origin header and the `theia-connection-token` cookie,
 * which the backend hands to anyone who loads `/`. Without this check an anonymous visitor reaches
 * every RPC service (tasks, search, debug, terminals) of the control plane. A tenant backend counts
 * as hosted even though the orchestrator starts it with `NODE_ENV=development` and
 * `QAAP_CLOUD_MODE=local`: there `authenticate` only accepts the control-plane proxy's signed
 * assertion (sent on both the polling requests and the WebSocket upgrade), so only proxied traffic
 * gets through.
 *
 * Local mode keeps Theia's single-user behaviour (with or without `QAAP_SKIP_AUTH`), so the e2e
 * suites and `npm run start:browser` are unchanged. Public previews never use this Socket.IO
 * server: the tenant proxy routes them before any of the original upgrade listeners run.
 */
@injectable()
export class QaapAuthenticatedWsRequestValidator implements WsRequestValidatorContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    /** Expired sessions and scanners retry every few seconds: log one refusal per client and minute. */
    @inject(QaapSecurityLogRateLimiter) @optional()
    protected readonly logLimiter: QaapSecurityLogRateLimiter | undefined;

    allowWsUpgrade(request: http.IncomingMessage): boolean {
        if (!this.isHostedRuntime()) {
            return true;
        }
        const context = this.auth.authenticate(request);
        if (context.kind === 'authenticated' || context.kind === 'skip') {
            return true;
        }
        const sampled = this.logLimiter ? this.logLimiter.admit('websocket_denied', request) : {};
        if (sampled) {
            this.auth.logSecurityEvent('websocket_denied', {
                reason: 'unauthenticated',
                path: (request.url ?? '/').split('?', 1)[0],
                ...sampled,
            });
        }
        return false;
    }

    protected isHostedRuntime(): boolean {
        return isQaapHostedOrTenantBackendRuntime(process.env);
    }
}
