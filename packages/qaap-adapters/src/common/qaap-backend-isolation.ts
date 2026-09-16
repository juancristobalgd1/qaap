// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isQaapHostedEnvironment } from './qaap-hosted-runtime';

/**
 * The product now contains the complete backend-per-tenant router. The mode is compiled into the
 * product; the environment may only enable that implemented path after supplying its required
 * deployment secret. An environment variable can never claim a stronger boundary than the code
 * actually implements.
 */
export type QaapBackendIsolationMode = 'shared-control-plane' | 'per-tenant';

export const QAAP_BACKEND_ISOLATION_MODE: QaapBackendIsolationMode = 'per-tenant';

export function isQaapPerTenantBackendConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    const enabled = /^(1|true)$/i.test(env.QAAP_BACKEND_PER_TENANT?.trim() ?? '');
    const secret = env.QAAP_TENANT_BACKEND_MASTER_SECRET?.trim();
    return enabled && !!secret && secret.length >= 32;
}

export function isQaapPublicMultiTenantRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
    if (!isQaapHostedEnvironment(env)) {
        return false;
    }
    return (env.QAAP_BETA_ALLOWED_LOGINS ?? '')
        .split(',')
        .some(login => login.trim().length > 0);
}

/**
 * Whether this build may serve invited third parties safely. Public multi-tenancy requires both
 * the compiled per-tenant implementation and its explicit deployment wiring/secret.
 */
export function isQaapBackendIsolationReady(env: NodeJS.ProcessEnv = process.env): boolean {
    return !isQaapPublicMultiTenantRuntime(env)
        || (QAAP_BACKEND_ISOLATION_MODE === 'per-tenant' && isQaapPerTenantBackendConfigured(env));
}
