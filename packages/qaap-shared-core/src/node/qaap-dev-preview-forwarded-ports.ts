// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Loopback ports this backend listens on itself to forward a preview into an isolated runtime
 * (a task sandbox). The dev-preview endpoint asks who a busy port belongs to before it skips it
 * as "held by something else": a forwarder that already serves the claiming owner's own sandbox
 * is the preview's port, not a conflict. Optional: absent where nothing forwards ports.
 */
export const QaapDevPreviewForwardedPorts = Symbol('QaapDevPreviewForwardedPorts');
export interface QaapDevPreviewForwardedPorts {
    /**
     * Login (lower case) whose runtime the forwarder on `port` serves, or undefined when no
     * forwarder holds the port or its owner is unknown. With `root`, the forwarder must also
     * belong to the runtime of the worktree that contains `root`; otherwise undefined.
     */
    ownerOf(port: number, root?: string): string | undefined;
    /**
     * The preview on `port` of `owner` was terminated: close the forwarder that was opened for it,
     * unless it belongs to another owner or something else (an open terminal) still uses it.
     */
    releasePreviewPort(port: number, owner: string): void;
}

/** Lower-cased, trimmed login; undefined for an empty one. */
export function normalizeQaapForwardedPortOwner(login: string | undefined): string | undefined {
    const normalized = login?.trim().toLowerCase();
    return normalized ? normalized : undefined;
}
