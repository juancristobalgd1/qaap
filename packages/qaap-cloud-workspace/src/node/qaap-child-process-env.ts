// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Backend-only secrets that no child process (agent CLI, research command, preview dev server,
 * deploy CLI, npm install) may inherit. Children run model-generated or repo-controlled code, so
 * anything left in their env can be read with `env` and exfiltrated over the network.
 *
 * QAAP_TASK_TOKEN is deliberately NOT here: it is a per-owner helper token that agents need to
 * fan out sub-tasks, and it is re-seeded per task by applyHelperEnv.
 */
export const QAAP_BACKEND_ONLY_ENV: readonly string[] = [
    // Authenticates the tenant backend to the control plane (SEC: leaked via env in agent tasks).
    'QAAP_TENANT_BACKEND_SECRET',
    // GitHub OAuth app secret: enables app impersonation.
    'QAAP_GITHUB_CLIENT_SECRET',
    // Web Push signing key: lets a tenant forge notifications to other users.
    'QAAP_VAPID_PRIVATE_KEY',
    'QAAP_VAPID_SUBJECT',
];

/** Any future QAAP_* secret or private key is backend-only by default (fail closed). */
const QAAP_BACKEND_SECRET_PATTERN = /^QAAP_[A-Z0-9_]*(?:SECRET|PRIVATE_KEY)(?:_[A-Z0-9_]*)?$/i;

export function isQaapBackendOnlyEnvKey(key: string): boolean {
    return QAAP_BACKEND_ONLY_ENV.includes(key) || QAAP_BACKEND_SECRET_PATTERN.test(key);
}

/** Deletes backend-only secrets from `env` in place. */
export function stripBackendOnlyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    for (const key of Object.keys(env)) {
        if (isQaapBackendOnlyEnvKey(key)) {
            delete env[key];
        }
    }
    return env;
}

/** Returns a copy of `env` (default: process.env) without backend-only secrets. */
export function childProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    return stripBackendOnlyEnv({ ...env });
}
