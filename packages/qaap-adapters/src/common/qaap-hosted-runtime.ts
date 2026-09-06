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
