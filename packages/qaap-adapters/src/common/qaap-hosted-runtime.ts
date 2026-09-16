// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Process-wide hosted/production flag shared by frontend (from `/qaap/api/auth/config`)
 * and backend (from `NODE_ENV` / `QAAP_CLOUD_MODE`). Default is local/dev.
 */
let hostedRuntime = false;

export function rememberQaapHostedRuntime(hosted: boolean): void {
    hostedRuntime = hosted;
}

export function readQaapHostedRuntime(): boolean {
    return hostedRuntime;
}

/** Backend-side equivalent of the cloud package's hosted admission check for leaf packages. */
export function isQaapHostedEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
    const cloudMode = env.QAAP_CLOUD_MODE?.trim().toLowerCase();
    return env.NODE_ENV === 'production' || (!!cloudMode && cloudMode !== 'local');
}
