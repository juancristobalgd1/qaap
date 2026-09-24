// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Marks terminals whose process tree is owned by the Qaap preview lifecycle. */
export const QAAP_PREVIEW_TERMINAL_KIND = 'qaap-preview';

export interface QaapPreviewTerminalDescriptor {
    readonly kind: string;
    readonly title: string;
    readonly cwd: string;
    readonly disposed: boolean;
}

const QAAP_PREVIEW_PORT_ARGUMENT = /(?:^|[\s\0])QAAP_PREVIEW_PORT=(?:['"])?(\d{2,5})(?:['"])?(?=$|[\s\0])/;

function normalizeCwd(cwd: string): string {
    return cwd.trim().replace(/\/+$/, '');
}

/**
 * Identifies a restored preview terminal for one exact project/app.
 *
 * New terminals carry a dedicated kind. The title fallback is intentionally restricted to the
 * exact historical `Dev (<app>)` title so one upgrade can clean terminals created by older builds.
 * A cwd match is always required: neither a port nor an active workspace is sufficient identity.
 */
export function isQaapRestoredPreviewTerminal(
    terminal: QaapPreviewTerminalDescriptor,
    expectedTitle: string,
    expectedCwd: string,
): boolean {
    if (terminal.disposed || !terminal.cwd || normalizeCwd(terminal.cwd) !== normalizeCwd(expectedCwd)) {
        return false;
    }
    return terminal.kind === QAAP_PREVIEW_TERMINAL_KIND
        || (terminal.kind === 'user' && terminal.title === expectedTitle);
}

/** Legacy restored preview terminals use the historical `Dev (<app>)` title. */
export const QAAP_LEGACY_DEV_TERMINAL_TITLE_PATTERN = /^Dev \(.+\)$/;

/**
 * Identifies preview terminals Theia may restore after a container restart, scoped to workspace roots.
 * Broader than {@link isQaapRestoredPreviewTerminal}: any `Dev (...)` title or marked kind counts.
 */
export function isQaapBootRestoredPreviewTerminal(
    terminal: QaapPreviewTerminalDescriptor,
    workspaceRoots: readonly string[],
): boolean {
    if (terminal.disposed || !terminal.cwd || workspaceRoots.length === 0) {
        return false;
    }
    const normalized = normalizeCwd(terminal.cwd);
    const inWorkspace = workspaceRoots.some(root => {
        const normalizedRoot = normalizeCwd(root);
        return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
    });
    if (!inWorkspace) {
        return false;
    }
    return terminal.kind === QAAP_PREVIEW_TERMINAL_KIND
        || (terminal.kind === 'user' && QAAP_LEGACY_DEV_TERMINAL_TITLE_PATTERN.test(terminal.title));
}

export interface ShouldDisposeRestoredPreviewTerminalInput {
    readonly hasPortMarker: boolean;
    readonly probeReady: boolean;
    readonly probeOwned: boolean;
}

/** Fail closed on unmarked restored preview terminals or ports without a live registry claim. */
export function shouldDisposeRestoredPreviewTerminal(input: ShouldDisposeRestoredPreviewTerminalInput): boolean {
    if (!input.hasPortMarker) {
        return true;
    }
    return !input.probeReady || !input.probeOwned;
}

/** True when the backend probe reports a durable preview identity for the port. */
export function isRestoredPreviewProbeOwned(probe: {
    readonly ready: boolean;
    readonly previewId?: string;
    readonly projectId?: string;
}): boolean {
    return probe.ready && Boolean(probe.previewId || probe.projectId);
}

/** Reads the allocator-owned port from the persisted terminal shell command. */
export function extractQaapPreviewTerminalPort(args: readonly string[]): number | undefined {
    const match = QAAP_PREVIEW_PORT_ARGUMENT.exec(args.join('\0'));
    if (!match) {
        return undefined;
    }
    const port = Number(match[1]);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}
