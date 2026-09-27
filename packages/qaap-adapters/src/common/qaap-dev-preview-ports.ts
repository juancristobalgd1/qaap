// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Dev-server ports the same-origin preview proxy may forward. Privileged ports (< 1024) cannot be
 * bound by an unprivileged workspace dev server, so on a shared host they belong to system
 * services (reverse proxy, Qaap itself) and are never claimable or proxied.
 */
export const QAAP_DEV_PREVIEW_MIN_PORT = 1024;
export const QAAP_DEV_PREVIEW_MAX_PORT = 65535;

export function isAllowedDevPreviewPort(port: number): boolean {
    return Number.isInteger(port) && port >= QAAP_DEV_PREVIEW_MIN_PORT && port <= QAAP_DEV_PREVIEW_MAX_PORT;
}
